/**
 * The server-side merge.
 *
 * This is the piece with the most ways to be quietly wrong, because every one
 * of its failures looks like the app working: a record that never arrives, a
 * delete that comes back, two histories that drift apart over months. So the
 * properties are asserted directly rather than through a scenario that happens
 * to exercise them.
 *
 * The two that matter more than the rest, and the reason the merge is
 * commutative by construction rather than by care:
 *
 *   **Order cannot matter.** Two devices pushing in either order have to leave
 *   the bundle in the same state, or the loser of every race is whichever one
 *   happened to sync second and the two never converge.
 *
 *   **Repeating cannot matter.** A device that pushes, loses the answer to a
 *   dropped connection and pushes again must not have changed anything the
 *   first push did not. That is what makes a retry safe, and a sync loop is
 *   mostly retries.
 */

import { mergeIntoBundle, readBundle } from '../bundle';
import { BUNDLE_VERSION, emptyChangeSet, type Bundle } from '../protocol';
import type { ChangeSet } from '../../data/repository';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const NOW = T0 + 10 * HOUR;

type Rec = Record<string, unknown>;

const changeSet = (parts: Partial<Record<keyof ChangeSet, unknown[]>>): unknown => ({
  ...emptyChangeSet(),
  ...parts,
});

const venue = (id: string, updatedAt = T0, over: Rec = {}) => ({
  record: { id, name: id, isHomeGame: false, sessionCount: 0, createdAt: T0, updatedAt, ...over },
  deletedAt: null,
});

const session = (id: string, updatedAt = T0, over: Rec = {}) => ({
  record: {
    id, venueId: 'v1', format: 'cash', gameType: 'NLHE',
    stakes: { smallBlind: 100, bigBlind: 200 }, currency: 'USD', buyIn: 30_000,
    fee: null, cashOut: null, entrants: null, finishPosition: null,
    startedAt: T0, endedAt: T0 + HOUR, notes: null, importKey: null,
    createdAt: T0, updatedAt, ...over,
  },
  deletedAt: null,
});

const hand = (id: string, sessionId: string, updatedAt = T0, over: Rec = {}) => ({
  record: { id, sessionId, holeCards: null, position: null, note: null, tags: [],
            amount: null, at: T0, createdAt: T0, updatedAt, ...over },
  deletedAt: null,
});

/** The bundle after a list of pushes, applied in the order given. */
const after = (...pushes: unknown[]): Bundle => {
  let bundle: unknown = null;
  for (const push of pushes) bundle = mergeIntoBundle(bundle, push, 0, NOW).bundle;
  return bundle as Bundle;
};

describe('taking what a device sent', () => {
  it('stores a record it has never seen', () => {
    const { bundle } = mergeIntoBundle(null, changeSet({ venues: [venue('v1')] }), 0, NOW);
    expect(bundle.records.venues.v1.record.name).toBe('v1');
    expect(bundle.version).toBe(BUNDLE_VERSION);
  });

  it('keeps the later of two versions of one record', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1', T0, { name: 'phone' })] }),
      changeSet({ venues: [venue('v1', T0 + HOUR, { name: 'laptop' })] }),
    );
    expect(bundle.records.venues.v1.record.name).toBe('laptop');
  });

  it('and does so whichever order they arrive in', () => {
    const forwards = after(
      changeSet({ venues: [venue('v1', T0, { name: 'phone' })] }),
      changeSet({ venues: [venue('v1', T0 + HOUR, { name: 'laptop' })] }),
    );
    const backwards = after(
      changeSet({ venues: [venue('v1', T0 + HOUR, { name: 'laptop' })] }),
      changeSet({ venues: [venue('v1', T0, { name: 'phone' })] }),
    );
    expect(forwards).toEqual(backwards);
  });

  it('changes nothing the second time the same push arrives', () => {
    // A dropped connection means the device never saw the answer and sends
    // again. A sync loop is mostly retries.
    const push = changeSet({ venues: [venue('v1')], sessions: [session('s1')] });
    expect(after(push, push)).toEqual(after(push));
  });

  it('keeps a tombstone, and hands it back rather than hiding it', () => {
    const dead = { ...session('s1', T0 + HOUR), deletedAt: T0 + HOUR };
    const { bundle, changes } = mergeIntoBundle(
      after(changeSet({ venues: [venue('v1')], sessions: [session('s1')] })),
      changeSet({ sessions: [dead] }),
      0,
      NOW,
    );
    expect(bundle.records.sessions.s1.deletedAt).toBe(T0 + HOUR);
    expect(changes.sessions.map((c) => c.deletedAt)).toEqual([T0 + HOUR]);
  });

  it('lets a delete beat an edit made in the same millisecond', () => {
    const edited = session('s1', T0 + HOUR, { notes: 'still here' });
    const deleted = { ...session('s1', T0 + HOUR), deletedAt: T0 + HOUR };
    const one = after(changeSet({ venues: [venue('v1')] }), changeSet({ sessions: [edited] }),
      changeSet({ sessions: [deleted] }));
    const other = after(changeSet({ venues: [venue('v1')] }), changeSet({ sessions: [deleted] }),
      changeSet({ sessions: [edited] }));
    expect(one.records.sessions.s1.deletedAt).toBe(T0 + HOUR);
    expect(other.records.sessions.s1.deletedAt).toBe(T0 + HOUR);
  });
});

describe('a device whose clock is wrong', () => {
  it('cannot stamp a record into the future and win every merge', () => {
    const nextYear = NOW + 365 * 24 * HOUR;
    const { bundle } = mergeIntoBundle(null, changeSet({ venues: [venue('v1', nextYear)] }), 0, NOW);
    expect(bundle.records.venues.v1.record.updatedAt).toBe(NOW);
  });

  it('and cannot do it with a tombstone either', () => {
    const dead = { ...venue('v1', NOW + 400 * 24 * HOUR), deletedAt: NOW + 400 * 24 * HOUR };
    const { bundle } = mergeIntoBundle(null, changeSet({ venues: [dead] }), 0, NOW);
    expect(bundle.records.venues.v1.deletedAt).toBe(NOW);
  });

  it('but an ordinary past stamp is believed', () => {
    const { bundle } = mergeIntoBundle(null, changeSet({ venues: [venue('v1', T0)] }), 0, NOW);
    expect(bundle.records.venues.v1.record.updatedAt).toBe(T0);
  });
});

describe('what it refuses to store', () => {
  it('drops a record with no id or no stamp', () => {
    const { bundle } = mergeIntoBundle(
      null,
      changeSet({ venues: [{ record: { name: 'nameless' }, deletedAt: null },
                           { record: { id: 'v1' }, deletedAt: null }] }),
      0,
      NOW,
    );
    expect(Object.keys(bundle.records.venues)).toEqual([]);
  });

  it('drops junk without dropping the good records beside it', () => {
    const { bundle } = mergeIntoBundle(
      null,
      changeSet({ venues: [null, 'nope', 42, venue('v1')] }),
      0,
      NOW,
    );
    expect(Object.keys(bundle.records.venues)).toEqual(['v1']);
  });

  it('ignores a table that is not a list', () => {
    const { bundle } = mergeIntoBundle(null, { venues: { not: 'a list' } }, 0, NOW);
    expect(Object.keys(bundle.records.venues)).toEqual([]);
  });

  it('survives a stored bundle that is not one', () => {
    for (const rubbish of [null, 'text', 42, [], { records: 'no' }]) {
      expect(readBundle(rubbish).records.sessions).toEqual({});
    }
  });

  it('will not have its prototype rewritten by a stored key', () => {
    // `__proto__` is an ordinary string in JSON and a setter on a plain object.
    const poisoned = {
      version: 1,
      records: { venues: { __proto__: { record: { id: 'x', updatedAt: T0 } } } },
    };
    const bundle = readBundle(JSON.parse(JSON.stringify(poisoned)));
    expect(Object.keys(bundle.records.venues)).toEqual([]);
    expect(({} as Record<string, unknown>).record).toBeUndefined();
  });

  it('drops a stored record filed under the wrong id', () => {
    const bundle = readBundle({
      version: 1,
      records: { venues: { v1: { record: { id: 'v2', updatedAt: T0 }, deletedAt: null } } },
    });
    expect(Object.keys(bundle.records.venues)).toEqual([]);
  });
});

describe('what it hands back', () => {
  it('returns everything at or after the cursor, not only after it', () => {
    // `>` would make a record written in the very millisecond a device last
    // synced invisible to it forever. Re-sending one millisecond is free,
    // because applying a record twice is a no-op.
    const stored = after(changeSet({ venues: [venue('v1', T0)] }));
    const { changes } = mergeIntoBundle(stored, changeSet({}), T0, NOW);
    expect(changes.venues.map((c) => c.record.id)).toEqual(['v1']);
  });

  it('leaves out what the device has already seen', () => {
    const stored = after(changeSet({ venues: [venue('v1', T0)] }));
    const { changes } = mergeIntoBundle(stored, changeSet({}), T0 + 1, NOW);
    expect(changes.venues).toEqual([]);
  });

  it('moves the cursor to the newest record it holds', () => {
    const stored = after(changeSet({ venues: [venue('v1', T0), venue('v2', T0 + 5 * HOUR)] }));
    const { cursor } = mergeIntoBundle(stored, changeSet({}), 0, NOW);
    expect(cursor).toBe(T0 + 5 * HOUR);
  });

  it('tells a device about its own record coming back changed', () => {
    // The answer is computed from the merged bundle rather than from what
    // arrived, which is how a session the merge closed reaches the device that
    // opened it.
    const stored = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('s1', T0, { endedAt: null, startedAt: T0 })] }),
    );
    const { changes } = mergeIntoBundle(
      stored,
      changeSet({ sessions: [session('s2', T0, { endedAt: null, startedAt: T0 + HOUR })] }),
      0,
      NOW,
    );
    const closed = changes.sessions.find((c) => c.record.id === 's1');
    expect(closed?.record.endedAt).not.toBeNull();
  });
});

describe('the three constraints, applied where the whole picture is', () => {
  it('closes the older of two running sessions and leaves it needing a cash-out', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('a', T0, { startedAt: T0, endedAt: null })] }),
      changeSet({ sessions: [session('b', T0, { startedAt: T0 + HOUR, endedAt: null })] }),
    );
    expect(bundle.records.sessions.b.record.endedAt).toBeNull();
    expect(bundle.records.sessions.a.record.endedAt).not.toBeNull();
    // Not cashed out at zero: that would be a loss they did not take.
    expect(bundle.records.sessions.a.record.cashOut).toBeNull();
  });

  it('ends it at its last recorded activity rather than at the merge', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({
        sessions: [session('a', T0, { startedAt: T0, endedAt: null })],
        hands: [hand('h1', 'a', T0, { at: T0 + 2 * HOUR })],
      }),
      changeSet({ sessions: [session('b', T0, { startedAt: T0 + 5 * HOUR, endedAt: null })] }),
    );
    expect(bundle.records.sessions.a.record.endedAt).toBe(T0 + 2 * HOUR);
  });

  it('leaves one running session alone', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('a', T0, { startedAt: T0, endedAt: null })] }),
    );
    expect(bundle.records.sessions.a.record.endedAt).toBeNull();
  });

  it('folds two imports of the same row into one session', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('a', T0, { importKey: 'stars:1', createdAt: T0 })] }),
      changeSet({ sessions: [session('b', T0, { importKey: 'stars:1', createdAt: T0 + HOUR })] }),
    );
    expect(bundle.records.sessions.a.deletedAt).toBeNull();
    expect(bundle.records.sessions.b.deletedAt).not.toBeNull();
    // And the key goes with the loser, or it would block the next honest import.
    expect(bundle.records.sessions.b.record.importKey).toBeNull();
  });

  it('moves the loser’s hands onto the survivor rather than losing them', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('a', T0, { importKey: 'k', createdAt: T0 })] }),
      changeSet({
        sessions: [session('b', T0, { importKey: 'k', createdAt: T0 + HOUR })],
        hands: [hand('h1', 'b')],
      }),
    );
    expect(bundle.records.hands.h1.record.sessionId).toBe('a');
    expect(bundle.records.hands.h1.deletedAt).toBeNull();
  });

  it('refuses a venue tombstone while a live session points at it', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('s1')] }),
      changeSet({ venues: [{ ...venue('v1', T0 + HOUR), deletedAt: T0 + HOUR }] }),
    );
    expect(bundle.records.venues.v1.deletedAt).toBeNull();
  });

  it('but applies one nothing points at', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ venues: [{ ...venue('v1', T0 + HOUR), deletedAt: T0 + HOUR }] }),
    );
    expect(bundle.records.venues.v1.deletedAt).not.toBeNull();
  });
});

describe('two devices, from nothing', () => {
  it('end up with the same bundle whichever synced first', () => {
    const phone = changeSet({
      venues: [venue('v1')],
      sessions: [session('s1', T0)],
      hands: [hand('h1', 's1', T0)],
    });
    const laptop = changeSet({
      venues: [venue('v2', T0 + HOUR)],
      sessions: [session('s2', T0 + HOUR, { venueId: 'v2' })],
    });
    expect(after(phone, laptop)).toEqual(after(laptop, phone));
  });
});
