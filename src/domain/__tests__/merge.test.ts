/**
 * The merge rules, tested as the three arguments they are.
 *
 * Every case here is one where both devices were right locally and the pair is
 * wrong, which is why the rules exist at all. The property that matters most is
 * asserted directly rather than implied: **the answer cannot depend on which
 * device the merge happened to look at first.** Two phones that disagree about
 * that produce two histories that never converge.
 */

import {
  CLOCK_ALLOWANCE_MS,
  MERGE_ORDER,
  clampStamp,
  resolve,
  resolveActiveSessions,
  resolveImportCollisions,
  venueTombstoneApplies,
  type ActiveSession,
  type Versioned,
} from '../merge';
import type { Session } from '../types';
import { HOUR, STAKES_1_2, T0 } from './support';

const plain = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  venueId: 'venue-1',
  format: 'cash',
  gameType: 'NLHE',
  stakes: STAKES_1_2,
  currency: 'USD',
  buyIn: 30_000,
  fee: null,
  cashOut: null,
  entrants: null,
  finishPosition: null,
  startedAt: T0,
  endedAt: null,
  notes: null,
  importKey: null,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

const live = (session: Session): Versioned<Session> => ({ record: session, deletedAt: null });
const dead = (session: Session, at: number): Versioned<Session> => ({
  record: session,
  deletedAt: at,
});

const active = (overrides: Partial<Session>, lastActivityAt: number | null = null): ActiveSession => ({
  session: plain(overrides),
  lastActivityAt,
});

describe('last write wins', () => {
  it('takes the later stamp', () => {
    const older = live(plain({ notes: 'phone' }));
    const newer = live(plain({ notes: 'laptop', updatedAt: T0 + HOUR }));
    expect(resolve(older, newer).record.notes).toBe('laptop');
    expect(resolve(newer, older).record.notes).toBe('laptop');
  });

  it('lets a tombstone beat an edit made in the same millisecond', () => {
    // Of the two ways to be wrong here, only one is visible to the player: a
    // row that comes back rejoins the bankroll without saying anything.
    const edited = live(plain({ notes: 'still here' }));
    const deleted = dead(plain({ notes: 'gone' }), T0);
    expect(resolve(edited, deleted).deletedAt).toBe(T0);
    expect(resolve(deleted, edited).deletedAt).toBe(T0);
  });

  it('settles two same-millisecond edits the same way from either side', () => {
    const a = live(plain({ notes: 'aces' }));
    const b = live(plain({ notes: 'kings' }));
    expect(resolve(a, b)).toEqual(resolve(b, a));
  });

  it('is idempotent, so merging twice changes nothing', () => {
    const mine = live(plain({ notes: 'mine' }));
    const theirs = live(plain({ notes: 'theirs', updatedAt: T0 + 1 }));
    const once = resolve(mine, theirs);
    expect(resolve(once, theirs)).toEqual(once);
    expect(resolve(once, mine)).toEqual(once);
  });

  it('hands back one of the two it was given, never a third object', () => {
    // Load-bearing outside this file. The server decides whether a push
    // changed anything by comparing what came out of this against what it
    // already held, by reference (`heard` in `src/sync/bundle.ts`). Build a new
    // object here and every retry restamps the record, which re-sends it to
    // every device and restarts the retention clock on any tombstone it
    // carries. Cheap to keep true, and silent when it stops being.
    const mine = live(plain({ notes: 'mine' }));
    const cases: [ReturnType<typeof live>, ReturnType<typeof live>][] = [
      [mine, live(plain({ notes: 'later', updatedAt: T0 + 1 }))],
      [live(plain({ notes: 'later', updatedAt: T0 + 1 })), mine],
      [mine, live(plain({ notes: 'same millisecond' }))],
      [mine, dead(plain({ notes: 'mine' }), T0)],
      [mine, mine],
    ];
    for (const [left, right] of cases) {
      const held = resolve(left, right);
      expect(held === left || held === right).toBe(true);
    }
  });
});

describe('clock skew', () => {
  it('believes a stamp inside the allowance', () => {
    const soon = T0 + CLOCK_ALLOWANCE_MS - 1;
    expect(clampStamp(soon, T0)).toBe(soon);
  });

  it('clamps a device that thinks it is next year', () => {
    const nextYear = T0 + 365 * 24 * HOUR;
    expect(clampStamp(nextYear, T0)).toBe(T0);
  });

  it('leaves an ordinary past stamp alone', () => {
    expect(clampStamp(T0 - HOUR, T0)).toBe(T0 - HOUR);
  });

  it('keeps the change rather than the stamp', () => {
    // Clamping and not rejecting: the player's edit is real even when their
    // clock is not.
    expect(clampStamp(T0 + 10 * HOUR, T0)).toBe(T0);
  });
});

describe('two devices, two active sessions', () => {
  it('keeps the one started later', () => {
    const early = active({ id: 'a', startedAt: T0 });
    const late = active({ id: 'b', startedAt: T0 + HOUR });
    expect(resolveActiveSessions([early, late]).keep?.id).toBe('b');
    expect(resolveActiveSessions([late, early]).keep?.id).toBe('b');
  });

  it('ends the other at its last recorded activity', () => {
    const early = active({ id: 'a', startedAt: T0 }, T0 + 2 * HOUR);
    const late = active({ id: 'b', startedAt: T0 + 3 * HOUR });
    const { close } = resolveActiveSessions([early, late]);
    expect(close).toHaveLength(1);
    expect(close[0].session.id).toBe('a');
    expect(close[0].endedAt).toBe(T0 + 2 * HOUR);
  });

  it('falls back to the start when nothing was ever logged', () => {
    const empty = active({ id: 'a', startedAt: T0 });
    const late = active({ id: 'b', startedAt: T0 + HOUR });
    expect(resolveActiveSessions([empty, late]).close[0].endedAt).toBe(T0);
  });

  it('never ends a session before it started', () => {
    // A child stamped earlier than its parent should not be able to invert the
    // one thing every session screen assumes.
    const odd = active({ id: 'a', startedAt: T0 + HOUR }, T0);
    const late = active({ id: 'b', startedAt: T0 + 2 * HOUR });
    expect(resolveActiveSessions([odd, late]).close[0].endedAt).toBe(T0 + HOUR);
  });

  it('leaves the closed session needing a cash-out rather than guessing one', () => {
    const early = active({ id: 'a', startedAt: T0 }, T0 + HOUR);
    const late = active({ id: 'b', startedAt: T0 + 2 * HOUR });
    const [closed] = resolveActiveSessions([early, late]).close;
    // Neither active nor complete: out of every total until somebody says what
    // came off the table. Zero would be a loss they did not take.
    expect(closed.session.cashOut).toBeNull();
  });

  it('settles a tie on startedAt without asking either device', () => {
    const a = active({ id: 'a', startedAt: T0, createdAt: T0 });
    const b = active({ id: 'b', startedAt: T0, createdAt: T0 + 1 });
    expect(resolveActiveSessions([a, b]).keep?.id).toBe('b');
    expect(resolveActiveSessions([b, a]).keep?.id).toBe('b');
  });

  it('settles a tie on startedAt and createdAt too', () => {
    const a = active({ id: 'a', startedAt: T0, createdAt: T0 });
    const b = active({ id: 'b', startedAt: T0, createdAt: T0 });
    expect(resolveActiveSessions([a, b]).keep).toEqual(resolveActiveSessions([b, a]).keep);
  });

  it('closes all but one when three devices manage it', () => {
    const result = resolveActiveSessions([
      active({ id: 'a', startedAt: T0 }),
      active({ id: 'b', startedAt: T0 + HOUR }),
      active({ id: 'c', startedAt: T0 + 2 * HOUR }),
    ]);
    expect(result.keep?.id).toBe('c');
    expect(result.close.map((closed) => closed.session.id).sort()).toEqual(['a', 'b']);
  });

  it('has nothing to say about one session, or none', () => {
    const only = active({ id: 'a' });
    expect(resolveActiveSessions([only])).toEqual({ keep: only.session, close: [] });
    expect(resolveActiveSessions([])).toEqual({ keep: null, close: [] });
  });
});

describe('the same file imported on two devices', () => {
  const imported = (id: string, key: string, createdAt: number): Session =>
    plain({ id, importKey: key, createdAt, updatedAt: createdAt });

  it('treats one key as one session and keeps the earlier row', () => {
    const first = imported('a', 'stars:2026-03-01:1', T0);
    const second = imported('b', 'stars:2026-03-01:1', T0 + HOUR);
    const [collision] = resolveImportCollisions([second, first]);
    expect(collision.keep.id).toBe('a');
    expect(collision.tombstone.map((session) => session.id)).toEqual(['b']);
  });

  it('moves the hands off the loser rather than losing them with it', () => {
    // The row is a duplicate. A hand somebody wrote a note on is not.
    const [collision] = resolveImportCollisions([
      imported('a', 'key', T0),
      imported('b', 'key', T0 + HOUR),
    ]);
    expect(collision.reparent).toEqual([{ from: 'b', to: 'a' }]);
  });

  it('does not treat a missing or empty import key as a real one', () => {
    // The server calls this on records it deliberately does not validate field
    // by field, so a session can arrive with no key at all. Grouped on that,
    // every hand-logged session in somebody's history collides with every
    // other, and all but one is tombstoned with its hands moved onto the
    // survivor. Only `null` was excluded, and `undefined` is not `null`.
    const { importKey: _absent, ...none } = plain({ id: 'a' });
    const alsoNone = { ...none, id: 'b' };
    expect(resolveImportCollisions([none as Session, alsoNone as Session])).toEqual([]);
    expect(
      resolveImportCollisions([plain({ id: 'c', importKey: '' }), plain({ id: 'd', importKey: '' })]),
    ).toEqual([]);
  });

  it('does not depend on the order the merge saw them in', () => {
    const a = imported('a', 'key', T0);
    const b = imported('b', 'key', T0 + HOUR);
    const c = imported('c', 'key', T0 + 2 * HOUR);
    expect(resolveImportCollisions([a, b, c])).toEqual(resolveImportCollisions([c, a, b]));
  });

  it('settles a tie on createdAt by id, so both devices pick the same row', () => {
    const a = imported('a', 'key', T0);
    const b = imported('b', 'key', T0);
    expect(resolveImportCollisions([a, b])[0].keep.id).toBe('a');
    expect(resolveImportCollisions([b, a])[0].keep.id).toBe('a');
  });

  it('reports nothing for keys that appear once', () => {
    expect(
      resolveImportCollisions([imported('a', 'one', T0), imported('b', 'two', T0)]),
    ).toEqual([]);
  });

  it('ignores sessions logged in the app, which all have no key', () => {
    // Null is not a value they collide on: two hand-logged sessions are two
    // sessions, and treating them as one would merge away a real night.
    expect(resolveImportCollisions([plain({ id: 'a' }), plain({ id: 'b' })])).toEqual([]);
  });

  it('handles more than one colliding key at once', () => {
    const collisions = resolveImportCollisions([
      imported('a', 'one', T0),
      imported('b', 'one', T0 + HOUR),
      imported('c', 'two', T0),
      imported('d', 'two', T0 + HOUR),
    ]);
    expect(collisions.map((collision) => collision.keep.id).sort()).toEqual(['a', 'c']);
  });
});

describe('merge order', () => {
  it('puts parents before children', () => {
    // Venues before sessions is the one that throws rather than arriving late:
    // foreign keys are on, so a session naming an unseen venue is an insert
    // that fails in the middle of a merge.
    expect(MERGE_ORDER.indexOf('venues')).toBeLessThan(MERGE_ORDER.indexOf('sessions'));
    for (const child of ['rebuys', 'hands', 'moodEntries'] as const) {
      expect(MERGE_ORDER.indexOf('sessions')).toBeLessThan(MERGE_ORDER.indexOf(child));
    }
  });

  it('covers every table that syncs', () => {
    expect([...MERGE_ORDER].sort()).toEqual(
      ['hands', 'moodEntries', 'rebuys', 'sessions', 'venues'].sort(),
    );
  });
});

describe('a venue deleted on one device and used on the other', () => {
  it('refuses the tombstone while a live session points at it', () => {
    expect(venueTombstoneApplies('venue-1', [{ venueId: 'venue-1' }])).toBe(false);
  });

  it('applies it when nothing does', () => {
    expect(venueTombstoneApplies('venue-1', [{ venueId: 'venue-2' }])).toBe(true);
    expect(venueTombstoneApplies('venue-1', [])).toBe(true);
  });
});

describe('the last tiebreak', () => {
  it('does not depend on the order a device happened to build its fields in', () => {
    // It was `JSON.stringify`, whose key order is insertion order. The two
    // engines agree on that today, so nothing was broken yet -- but a column
    // added in a different place in one of them would serialize the same
    // record two ways, and the two devices would pick opposite winners and
    // never converge.
    const fields = { id: 'v1', updatedAt: T0, name: 'The Vic', isHomeGame: false };
    const oneOrder = { record: { ...fields }, deletedAt: null };
    const another = {
      record: { isHomeGame: false, name: 'The Vic', updatedAt: T0, id: 'v1' },
      deletedAt: null,
    };
    expect(resolve(oneOrder, another).record).toEqual(oneOrder.record);
    expect(resolve(another, oneOrder).record).toEqual(another.record);
  });

  it('still separates two records that really differ, the same way both ways round', () => {
    const mine = { record: { id: 'v1', updatedAt: T0, name: 'Aces' }, deletedAt: null };
    const theirs = { record: { id: 'v1', updatedAt: T0, name: 'Binions' }, deletedAt: null };
    expect(resolve(mine, theirs).record.name).toBe(resolve(theirs, mine).record.name);
  });
});
