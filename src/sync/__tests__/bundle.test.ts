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

/**
 * The bundle as a device sees it, with the server's own bookkeeping removed.
 *
 * `heardAt` and `heardThrough` record *when this server was told* each thing,
 * and two devices pushing in opposite orders genuinely told it in opposite
 * orders. They are the delivery ledger, not the log. What has to converge is
 * everything a device is ever handed, which is what this compares.
 */
const asSeen = (bundle: Bundle): unknown => ({
  ...bundle,
  heardThrough: 0,
  records: Object.fromEntries(
    Object.entries(bundle.records).map(([table, held]) => [
      table,
      Object.fromEntries(
        Object.entries(held).map(([id, change]) => [
          id,
          { record: change.record, deletedAt: change.deletedAt },
        ]),
      ),
    ]),
  ),
});

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
    expect(asSeen(forwards)).toEqual(asSeen(backwards));
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

describe('a device whose clock was wrong once', () => {
  it('does not win every merge forever by being re-clamped each time', () => {
    // A row above the device's own clock stays above its push mark, so it is
    // re-sent on every sync. Clamping it to a fresh `now` each time made it
    // later than anything anybody else had written, so it beat every real edit,
    // was broadcast to everyone, and could not be corrected: the device holding
    // it refuses the corrected copy coming back, because its own stamp is still
    // a year larger.
    const YEAR = 365 * 24 * HOUR;
    const wrong = changeSet({ venues: [venue('v1', NOW + YEAR, { name: 'Aria' })] });

    const first = mergeIntoBundle(null, wrong, 0, NOW);
    expect(first.bundle.records.venues.v1.record.updatedAt).toBe(NOW);

    // Somebody else renames it two hours later.
    const renamed = mergeIntoBundle(
      first.bundle,
      changeSet({ venues: [venue('v1', NOW + 2 * HOUR, { name: 'Bellagio' })] }),
      0, NOW + 2 * HOUR,
    );
    expect(renamed.bundle.records.venues.v1.record.name).toBe('Bellagio');

    // The wrong-clocked device syncs again, having typed nothing.
    const again = mergeIntoBundle(renamed.bundle, wrong, 0, NOW + 3 * HOUR);
    expect(again.bundle.records.venues.v1.record.name).toBe('Bellagio');
    // And nothing moved, so nobody is told about it either.
    expect(again.bundle.records.venues.v1.heardAt)
      .toBe(renamed.bundle.records.venues.v1.heardAt);
  });

  it('but a real edit from that device still lands', () => {
    // Not a blanket refusal of a device with a bad clock: what is refused is
    // re-sending the same row, not changing it.
    const YEAR = 365 * 24 * HOUR;
    const first = mergeIntoBundle(
      null, changeSet({ venues: [venue('v1', NOW + YEAR, { name: 'Aria' })] }), 0, NOW,
    );
    // A wrong clock still advances, so a later write carries a later stamp.
    const edited = mergeIntoBundle(
      first.bundle,
      changeSet({ venues: [venue('v1', NOW + YEAR + HOUR, { name: 'Aria Poker Room' })] }),
      0, NOW + HOUR,
    );
    expect(edited.bundle.records.venues.v1.record.name).toBe('Aria Poker Room');
  });
});

describe('what it refuses to store', () => {
  it('refuses a record whose parent it does not have', () => {
    // The backstop can refuse an old venue while accepting the session that
    // points at it, and the bundle then holds a row that resolves to nothing:
    // served to every device, skipped by every device, forever, with each
    // cursor moving past it. The pager already refuses to hand a child over
    // without its parent; this is the same rule on the way in.
    const { bundle } = mergeIntoBundle(
      null,
      changeSet({
        sessions: [session('s1', T0, { venueId: 'never-sent' })],
        hands: [hand('h1', 's1', T0)],
      }),
      0, NOW,
    );
    expect(bundle.records.sessions.s1).toBeUndefined();
    expect(bundle.records.hands.h1).toBeUndefined();
  });

  it('but takes one whose parent is in the same push', () => {
    const { bundle } = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('s1', T0)],
        hands: [hand('h1', 's1', T0)],
      }),
      0, NOW,
    );
    expect(bundle.records.hands.h1).toBeDefined();
  });

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

  it('keeps each record’s own heardAt across a version change', () => {
    // The finding. Restamping every entry with `now` gave the whole bundle one
    // stamp, and the cursor *is* a stamp: everything sharing one is handed over
    // together or not at all, so `answerFrom`'s budget stopped applying to any
    // of it. A migration is when a bundle is largest, so paging broke at
    // precisely the moment it existed for.
    const stored = {
      version: BUNDLE_VERSION - 1,
      heardThrough: T0 + 5,
      records: {
        venues: {
          v1: { record: { id: 'v1', updatedAt: T0 }, deletedAt: null, heardAt: T0 + 1 },
          v2: { record: { id: 'v2', updatedAt: T0 }, deletedAt: null, heardAt: T0 + 5 },
        },
      },
    };
    const bundle = readBundle(JSON.parse(JSON.stringify(stored)), NOW);
    expect(bundle.records.venues.v1.heardAt).toBe(T0 + 1);
    expect(bundle.records.venues.v2.heardAt).toBe(T0 + 5);
  });

  it('still stamps an entry that has no heardAt of its own', () => {
    const bundle = readBundle(
      { version: BUNDLE_VERSION, records: { venues: { v1: { record: { id: 'v1', updatedAt: T0 }, deletedAt: null } } } },
      NOW,
    );
    expect(bundle.records.venues.v1.heardAt).toBe(NOW);
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
    const first = mergeIntoBundle(null, changeSet({ venues: [venue('v1', T0)] }), 0, NOW);
    const second = mergeIntoBundle(
      first.bundle, changeSet({ venues: [venue('v2', T0)] }), 0, NOW + HOUR,
    );
    // v1 was heard before the cursor and is left out. v2 was heard *at* it and
    // comes back, which is the one stamp of overlap `>=` costs on every sync.
    const { changes } = mergeIntoBundle(second.bundle, changeSet({}), second.cursor, NOW + 2 * HOUR);
    expect(changes.venues.map((c) => c.record.id)).toEqual(['v2']);
  });

  it('hands over a record whose own stamp is behind the asking cursor', () => {
    // The reason the cursor is the server's stamp rather than the record's.
    // A delete made with no signal carries the moment it was made, so if the
    // other device has synced since, this record is older than the cursor it
    // is asking with. Cut on `updatedAt` it is never delivered to that device
    // at all: not collected, not refused, simply never sent.
    const first = mergeIntoBundle(null, changeSet({ venues: [venue('v1', NOW)] }), 0, NOW);
    const late = mergeIntoBundle(
      first.bundle,
      changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }),
      0,
      NOW + HOUR,
    );
    const { changes } = mergeIntoBundle(late.bundle, changeSet({}), first.cursor, NOW + 2 * HOUR);
    expect(changes.sessions.map((c) => c.record.id)).toEqual(['s1']);
  });

  it('moves the cursor past everything it has just handed over', () => {
    const stored = after(changeSet({ venues: [venue('v1', T0), venue('v2', T0 + 5 * HOUR)] }));
    const { cursor, bundle } = mergeIntoBundle(stored, changeSet({}), 0, NOW);
    for (const change of Object.values(bundle.records.venues)) {
      expect(change.heardAt).toBeLessThanOrEqual(cursor);
    }
    // And asking again with it hands back only what was heard in that very
    // stamp, never anything older.
    const again = mergeIntoBundle(bundle, changeSet({}), cursor, NOW + HOUR);
    for (const change of again.changes.venues) {
      expect(bundle.records.venues[change.record.id].heardAt).toBe(cursor);
    }
  });

  it('never issues a stamp behind one it has already handed out', () => {
    // Functions run on many machines and their clocks agree to within
    // milliseconds rather than exactly. A stamp that went backwards would put
    // a record behind a cursor already given to a device, and that record
    // would then never reach it.
    const first = mergeIntoBundle(null, changeSet({ venues: [venue('v1', T0)] }), 0, NOW);
    const behind = mergeIntoBundle(
      first.bundle,
      changeSet({ venues: [venue('v2', T0)] }),
      0,
      NOW - 5000,
    );
    expect(behind.cursor).toBeGreaterThan(first.cursor);
    expect(behind.bundle.records.venues.v2.heardAt).toBeGreaterThan(first.cursor);
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

  it('does not let a session started on a wrong clock close every real one', () => {
    // The rule ranks on `startedAt`, and `sanitize` validates an id and a
    // stamp and nothing else. A phone with next year's date starts a session,
    // and from then on every session anybody really sits down to is closed the
    // moment it syncs, for a year.
    const YEAR = 365 * 24 * HOUR;
    const runaway = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('wrong', T0, { endedAt: null, startedAt: NOW + YEAR })],
      }),
      0, NOW,
    ).bundle;

    // Started an hour ago, which is what sitting down at a table looks like.
    // Clamped, the runaway ranks at the merge's own clock and so beats it.
    const real = mergeIntoBundle(
      runaway,
      changeSet({
        sessions: [session('real', NOW + 10 * HOUR, {
          endedAt: null, startedAt: NOW + 9 * HOUR, createdAt: NOW + 9 * HOUR,
        })],
      }),
      0, NOW + 10 * HOUR,
    ).bundle;

    // The real one is still running, which is the whole point. The runaway is
    // left alone rather than closed: the server cannot place it in time, so it
    // neither wins the contest nor loses it.
    expect(real.records.sessions.real.record.endedAt).toBeNull();
    expect(real.records.sessions.wrong.record.startedAt).toBe(NOW + YEAR);
  });

  it('and stops rewriting a session it cannot place, request after request', () => {
    // A stamp beyond the allowance used to be clamped to `now`, and `now`
    // moves: the rule compared what it stored last time against a later number
    // every second, wrote the session again, and re-sent it to every device.
    // Forever, on a bundle nobody was touching.
    const first = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('s1', T0, { endedAt: T0 + HOUR, cashOut: null })],
        hands: [hand('h1', 's1', T0, { at: NOW + 365 * 24 * HOUR })],
      }),
      0, NOW,
    );
    const endedAt = first.bundle.records.sessions.s1.record.endedAt;

    const later = mergeIntoBundle(first.bundle, changeSet({}), 0, NOW + 5 * HOUR);
    expect(later.bundle.records.sessions.s1.record.endedAt).toBe(endedAt);
    // The stamp standing still is what says the rule did not fire again, and
    // so that nothing was re-sent to anybody.
    expect(later.bundle.records.sessions.s1.heardAt)
      .toBe(first.bundle.records.sessions.s1.heardAt);
    expect(later.bundle.heardThrough).toBe(first.bundle.heardThrough);
  });

  it('will not close a session it cannot place in time, however many are running', () => {
    // `Math.max` over a missing stamp is NaN, JSON writes NaN as null, and a
    // null `endedAt` is a running session. So the rule would close it again on
    // every request for the life of the bundle, re-sending it to every device
    // each time. Two sessions left running is a visible oddity; that is a loop.
    const { record: whole } = session('broken', T0, { endedAt: null });
    const { startedAt: _gone, ...missing } = whole;
    const first = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [{ record: missing, deletedAt: null }, session('real', T0, { endedAt: null })],
      }),
      0, NOW,
    );
    expect(first.bundle.records.sessions.broken.record.endedAt).toBeNull();
    expect(first.bundle.records.sessions.real.record.endedAt).toBeNull();

    // And the next request rewrites nothing, through a real store round trip:
    // the stamps stand still, which is what says the rule is not re-firing.
    const stored: unknown = JSON.parse(JSON.stringify(first.bundle));
    const again = mergeIntoBundle(stored, changeSet({}), first.cursor, NOW + HOUR);
    for (const id of ['broken', 'real']) {
      expect(again.bundle.records.sessions[id].heardAt)
        .toBe(first.bundle.records.sessions[id].heardAt);
    }
  });

  it('does not close a real session for a duplicate it is about to delete', () => {
    // The rules run in a fixed order, and the collision rule removes sessions.
    // Running the contest first let a duplicate that exists only until the end
    // of this merge close the session the player was actually sitting in, on
    // the word of a row that no longer exists -- and which of the two happened
    // depended on which push carried the duplicate, so the merge was not even
    // commutative.
    const first = changeSet({
      venues: [venue('v1')],
      sessions: [session('mine', T0, { endedAt: null, startedAt: T0 + HOUR })],
    });
    const second = changeSet({
      sessions: [
        session('kept', T0, { importKey: 'k', createdAt: T0, endedAt: T0 + HOUR }),
        session('dupe', T0, {
          importKey: 'k', createdAt: T0 + HOUR, endedAt: null, startedAt: T0 + 2 * HOUR,
        }),
      ],
    });

    const both = mergeIntoBundle(mergeIntoBundle(null, first, 0, NOW).bundle, second, 0, NOW).bundle;
    expect(both.records.sessions.dupe.deletedAt).not.toBeNull();
    expect(both.records.sessions.mine.record.endedAt).toBeNull();

    // And the other way round gives the same answer, which is the property the
    // ordering is really there for.
    const other = mergeIntoBundle(mergeIntoBundle(null, second, 0, NOW).bundle, first, 0, NOW).bundle;
    expect(other.records.sessions.mine.record.endedAt).toBeNull();
  });

  it('leaves one running session alone', () => {
    const bundle = after(
      changeSet({ venues: [venue('v1')] }),
      changeSet({ sessions: [session('a', T0, { startedAt: T0, endedAt: null })] }),
    );
    expect(bundle.records.sessions.a.record.endedAt).toBeNull();
  });

  it('moves the end of a closed session forward when a later hand arrives', () => {
    // The rule closes a session at whatever activity had reached the server by
    // then. A hand pushed afterwards used to leave the end where it was, so a
    // session held a hand that happened outside it.
    const both = changeSet({
      venues: [venue('v1')],
      sessions: [
        session('early', T0, { endedAt: null, startedAt: T0 }),
        session('late', T0, { endedAt: null, startedAt: T0 + HOUR }),
      ],
    });
    const closed = mergeIntoBundle(null, both, 0, NOW).bundle;
    const endedAt = closed.records.sessions.early.record.endedAt;
    expect(endedAt).not.toBeNull();

    const after = mergeIntoBundle(
      closed,
      changeSet({ hands: [hand('h1', 'early', T0, { at: (endedAt as number) + 5 * HOUR })] }),
      0,
      NOW + HOUR,
    ).bundle;
    expect(after.records.sessions.early.record.endedAt).toBe((endedAt as number) + 5 * HOUR);
    // And settles: the next request has nothing left to move.
    const again = mergeIntoBundle(after, changeSet({}), 0, NOW + 2 * HOUR);
    expect(again.bundle.records.sessions.early.heardAt)
      .toBe(after.records.sessions.early.heardAt);
  });

  it('but never revises a session the player has cashed out of', () => {
    // That end is their answer to what came off the table.
    const done = changeSet({
      venues: [venue('v1')],
      sessions: [session('s1', T0, { endedAt: T0 + HOUR, cashOut: 40_000 })],
      hands: [hand('h1', 's1', T0, { at: T0 + 9 * HOUR })],
    });
    const bundle = mergeIntoBundle(null, done, 0, NOW).bundle;
    expect(bundle.records.sessions.s1.record.endedAt).toBe(T0 + HOUR);
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

  it('moves a hand pushed after the fold, not only the ones present for it', () => {
    // The collision is gone by the second merge: the loser is a tombstone and
    // there is nothing left for the rule to notice. A hand logged on the losing
    // session before that device heard about the fold used to sit on a
    // tombstone, invisible, until the sweep took it.
    const folded = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('a', T0, { importKey: 'k', createdAt: T0 }),
                   session('b', T0, { importKey: 'k', createdAt: T0 + HOUR })],
      }),
      0, NOW,
    ).bundle;
    expect(folded.records.sessions.b.deletedAt).not.toBeNull();

    const later = mergeIntoBundle(
      folded, changeSet({ hands: [hand('h1', 'b', T0 + HOUR)] }), 0, NOW + HOUR,
    ).bundle;
    expect(later.records.hands.h1.record.sessionId).toBe('a');

    // And it settles rather than rewriting the hand on every request.
    const again = mergeIntoBundle(later, changeSet({}), 0, NOW + 2 * HOUR);
    expect(again.bundle.records.hands.h1.heardAt).toBe(later.records.hands.h1.heardAt);
  });

  it('forgets a fold once the tombstone that named it has been collected', () => {
    const DAY = 24 * HOUR;
    const only = 'device-aaaa0001';
    let bundle = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('a', T0, { importKey: 'k', createdAt: T0 }),
                   session('b', T0, { importKey: 'k', createdAt: T0 + HOUR })],
      }),
      0, T0, only,
    ).bundle;
    expect(bundle.folded.b).toBe('a');

    // Threading the cursor back in, because a device that keeps asking from
    // nothing is a device that has never confirmed anything, and collection
    // waits for it.
    let cursor = 0;
    for (const clock of [T0 + 100 * DAY, T0 + 100 * DAY + HOUR, T0 + 100 * DAY + 2 * HOUR]) {
      const merged = mergeIntoBundle(bundle, changeSet({}), cursor, clock, only);
      bundle = merged.bundle;
      cursor = merged.cursor;
    }
    expect(bundle.records.sessions.b).toBeUndefined();
    expect(bundle.folded).toEqual({});
  });

  it('will not be handed a function to store as a session', () => {
    // `settleFoldedChildren` reads its map with a bare index. On an ordinary
    // object `folded['toString']` is a function rather than undefined, so a
    // child naming one got that function written into its `sessionId`, where
    // JSON drops it and every device then skips the row for good. The reserved
    // list would not have caught it: `toString` is not on the list. Every map
    // in a bundle has no prototype now, which is the property rather than a
    // list to keep in step with.
    const folded = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('a', T0, { importKey: 'k', createdAt: T0 }),
                   session('b', T0, { importKey: 'k', createdAt: T0 + HOUR })],
      }),
      0, NOW,
    ).bundle;
    expect(folded.folded.b).toBe('a');

    const after = mergeIntoBundle(
      folded,
      changeSet({ hands: [hand('h1', 'toString', T0 + HOUR), hand('h2', '__proto__', T0 + HOUR)] }),
      0, NOW + HOUR,
    ).bundle;
    // Whatever else becomes of them, neither is handed a function to store.
    // (They name no session, so the sweep may take them as unattachable, which
    // is a different rule and the right one.)
    for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
      for (const change of Object.values(after.records[table])) {
        expect(typeof change.record.sessionId).toBe('string');
      }
    }
    expect(after.records.hands.h1?.record.sessionId ?? 'toString').toBe('toString');
  });

  it('and a record can call itself anything without breaking the merge', () => {
    // Every map here is keyed by an id off the wire, and `isRow` only ever
    // refused three names. `toString`, `valueOf` and `hasOwnProperty` all
    // reached something by inheritance instead.
    const named = mergeIntoBundle(
      null,
      changeSet({ venues: [venue('toString'), venue('valueOf'), venue('hasOwnProperty')] }),
      0, NOW,
    );
    expect(named.changes.venues.map((change) => change.record.id).sort())
      .toEqual(['hasOwnProperty', 'toString', 'valueOf']);

    // And again, through a real store round trip, which is where the prototype
    // comes back on.
    const stored: unknown = JSON.parse(JSON.stringify(named.bundle));
    const again = mergeIntoBundle(
      stored, changeSet({ venues: [venue('toString', T0 + HOUR)] }), 0, NOW + HOUR,
    );
    // Bracket, and cast, because the type of a `Record<string, T>` still
    // carries Object's own members even where the value at runtime does not.
    const held = again.bundle.records.venues as unknown as Record<string, { record: Rec }>;
    expect(held['toString'].record.updatedAt).toBe(T0 + HOUR);
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

describe('collecting tombstones', () => {
  const DAY = 24 * HOUR;
  const RETENTION = 90 * DAY;
  const LATER = T0 + RETENTION + 10 * DAY;

  /**
   * A device that keeps the cursor it was last given, which is what makes
   * these tests about the rule rather than about a device that never advances.
   *
   * `sync` records the answer, as a real device does once it has applied it.
   * `lose` asks and throws the answer away, which is a dropped connection: the
   * server built an answer and nobody ever saw it.
   */
  const syncer = (id: string) => {
    let cursor = 0;
    const run = (bundle: unknown, changes: unknown, now: number, keep: boolean) => {
      const merged = mergeIntoBundle(bundle, changes, cursor, now, id);
      if (keep) cursor = merged.cursor;
      return merged;
    };
    return {
      sync: (bundle: unknown, changes: unknown, now: number) => run(bundle, changes, now, true),
      lose: (bundle: unknown, changes: unknown, now: number) => run(bundle, changes, now, false),
    };
  };

  /**
   * Sync everybody twice, which is what it takes for every cursor to catch up.
   *
   * One round hands the answer over; the next is the request in which a device
   * says so. That second round is the price of holding acknowledgements rather
   * than arrival times, and it is paid on a row that has been dead for three
   * months.
   */
  const settle = (bundle: unknown, devices: ReturnType<typeof syncer>[], now: number): Bundle => {
    let held = bundle;
    for (let round = 0; round < 2; round += 1) {
      for (const device of devices) held = device.sync(held, changeSet({}), now + round).bundle;
    }
    return held as Bundle;
  };

  /** A bundle holding one deleted session, tombstoned at T0, and its device. */
  const withADeletedSession = (id = 'device-aaaa0001') => {
    const only = syncer(id);
    let bundle = only.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    bundle = only.sync(
      bundle, changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }), T0,
    ).bundle;
    return { bundle, only };
  };

  it('keeps one that is not old enough yet', () => {
    const { bundle, only } = withADeletedSession();
    const merged = only.sync(bundle, changeSet({}), T0 + 10 * DAY);
    expect(merged.bundle.records.sessions.s1.deletedAt).toBe(T0);
  });

  it('does not draw a line when it collected nothing', () => {
    // The line arms a refusal, and arming it on a sweep that removed nothing
    // would turn away records from any device that had simply been away.
    const only = syncer('device-aaaa0001');
    const held = only.sync(null, changeSet({ venues: [venue('v1')] }), T0).bundle;
    expect(only.sync(held, changeSet({}), LATER).bundle.collectedThrough).toBe(0);
  });

  it('will not sweep a tombstone out of the very answer that delivers it', () => {
    // The bug the device map had all along, and the one it existed to prevent.
    // The asking device used to be stamped with the time of its own request, so
    // it stopped being the least advanced thing on the map the instant it
    // asked, the horizon jumped to the present, and the tombstone it had come
    // for went in the sweep, out of the answer it was about to be handed.
    const phone = syncer('device-aaaa0001');
    const laptop = syncer('device-bbbb0002');
    let bundle = phone.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    // The laptop takes the live row, and then does not sync again for months.
    bundle = laptop.sync(bundle, changeSet({}), T0).bundle;
    bundle = phone.sync(
      bundle, changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }), T0 + DAY,
    ).bundle;

    const merged = laptop.sync(bundle, changeSet({}), LATER);
    expect(merged.bundle.records.sessions.s1).toBeDefined();
    expect(merged.collectedThrough).toBe(0);
    // Delivered, which is the whole reason it was kept.
    expect(merged.changes.sessions.map((change) => change.record.id)).toContain('s1');

    // And gone once both devices have said they took it.
    expect(settle(merged.bundle, [phone, laptop], LATER + HOUR).records.sessions.s1)
      .toBeUndefined();
  });

  it('collects one past the window once every device has acknowledged it', () => {
    const { bundle, only } = withADeletedSession();
    const settled = settle(bundle, [only], LATER);
    expect(settled.records.sessions.s1).toBeUndefined();
    expect(settled.collectedThrough).toBeGreaterThan(T0);
  });

  it('and not when the answer that carried it was never received', () => {
    // The reason the map holds what a device acknowledged rather than when it
    // last asked. An answer built and then lost to a dropped connection proves
    // nothing, and that device is still holding the live row.
    const phone = syncer('device-aaaa0001');
    const laptop = syncer('device-bbbb0002');
    let bundle = phone.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    bundle = laptop.sync(bundle, changeSet({}), T0).bundle;
    bundle = phone.sync(
      bundle, changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }), T0 + DAY,
    ).bundle;
    bundle = phone.sync(bundle, changeSet({}), T0 + 2 * DAY).bundle;

    // The laptop asks, is served the tombstone, and never sees the answer.
    const lost = laptop.lose(bundle, changeSet({}), LATER);
    expect(lost.changes.sessions.map((change) => change.record.id)).toContain('s1');

    // Its cursor did not move, so it has still not acknowledged the delete and
    // the tombstone has to wait, however long ago the delete was.
    const after = phone.sync(lost.bundle, changeSet({}), LATER + HOUR);
    expect(after.bundle.records.sessions.s1).toBeDefined();

    // Where a laptop that did receive it settles the matter.
    expect(settle(after.bundle, [laptop, phone], LATER + 2 * HOUR).records.sessions.s1)
      .toBeUndefined();
  });

  it('measures the window from when it heard, not from the phone that deleted', () => {
    // A session deleted on a phone with no signal carries the moment it was
    // deleted. Four months later that phone finds wifi and pushes a tombstone
    // that is already older than the window, and on the deleting device's clock
    // there is nothing left to wait for, while the second device, which synced
    // an hour ago, is still holding the live row.
    const phone = syncer('device-aaaa0001');
    const laptop = syncer('device-bbbb0002');
    let bundle = phone.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    bundle = laptop.sync(bundle, changeSet({}), LATER - HOUR).bundle;

    // Deleted back at T0, arriving now, a hundred days late.
    const arrived = phone.sync(
      bundle, changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }), LATER,
    );
    expect(arrived.bundle.records.sessions.s1).toBeDefined();
    expect(arrived.bundle.records.sessions.s1.deletedAt).toBe(T0);

    // And it stays until the second device has taken it.
    const later = phone.sync(arrived.bundle, changeSet({}), LATER + HOUR);
    expect(later.bundle.records.sessions.s1).toBeDefined();
  });

  it('does not restart that clock when a device retries a push it already sent', () => {
    // Otherwise a retry loop is a tombstone that is never old enough, and a
    // sync loop is mostly retries.
    const tombstone = changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] });
    const only = syncer('device-aaaa0001');
    let bundle = only.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    bundle = only.sync(bundle, tombstone, T0).bundle;
    const heardAt = bundle.records.sessions.s1.heardAt;

    bundle = only.sync(bundle, tombstone, T0 + 10 * DAY).bundle;
    expect(bundle.records.sessions.s1.heardAt).toBe(heardAt);
  });

  it('will not collect one a second device has not acknowledged', () => {
    // The rule this whole thing turns on. That device still holds the live row,
    // and collecting the tombstone would let it push the row into a server with
    // nothing left to refuse it.
    const phone = syncer('device-aaaa0001');
    const laptop = syncer('device-bbbb0002');
    let bundle = phone.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    // The second device syncs here, and then goes quiet forever.
    bundle = laptop.sync(bundle, changeSet({}), T0).bundle;
    // The delete happens after that, so the second device has never seen it.
    bundle = phone.sync(
      bundle,
      changeSet({ sessions: [{ ...session('s1', T0 + DAY), deletedAt: T0 + DAY }] }),
      T0 + DAY,
    ).bundle;

    // Well past the window as far as the first device is concerned. The line is
    // drawn by the second, whose cursor predates the delete.
    const merged = phone.sync(bundle, changeSet({}), T0 + RETENTION + 2 * DAY);
    expect(merged.bundle.records.sessions.s1).toBeDefined();
    expect(merged.bundle.records.sessions.s1.deletedAt).toBe(T0 + DAY);
  });

  it('forgets a device gone longer than twice the window, so it cannot hold this up', () => {
    // Otherwise one lost phone freezes collection for the rest of somebody's
    // life, which is a worse outcome than the row it was protecting. This is
    // the one thing the wall clock decides, and the only reason a device mark
    // holds two numbers: a device perfectly caught up on a server nobody has
    // written to for months would otherwise look exactly like a sold phone.
    const phone = syncer('device-aaaa0001');
    const laptop = syncer('device-bbbb0002');
    let bundle = phone.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    // The laptop takes the live row here, and is never seen again.
    bundle = laptop.sync(bundle, changeSet({}), T0).bundle;
    bundle = phone.sync(
      bundle, changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }), T0 + DAY,
    ).bundle;
    bundle = phone.sync(bundle, changeSet({}), T0 + 2 * DAY).bundle;

    // Just inside the forget threshold, it still blocks.
    const blocked = phone.sync(bundle, changeSet({}), T0 + 2 * RETENTION - DAY);
    expect(blocked.bundle.records.sessions.s1).toBeDefined();

    // Past it, it is presumed gone and stops holding anything up.
    const settled = settle(bundle, [phone], T0 + 2 * RETENTION + DAY);
    expect(settled.records.sessions.s1).toBeUndefined();
    expect(Object.keys(settled.devices)).toEqual(['device-aaaa0001']);
  });

  it('takes a live child left pointing at a session it collected', () => {
    // Another device logs a hand on a session this one has already deleted, and
    // nothing reconciles the pair. Both device engines take that child with the
    // session when they sweep; this did not, so the hand stayed in the bundle
    // pointing at an id that exists nowhere -- live, so the sweep skipped it,
    // and unreachable by any rule or any device, forever.
    const only = syncer('device-aaaa0001');
    let bundle = only.sync(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), T0,
    ).bundle;
    bundle = only.sync(
      bundle,
      changeSet({
        sessions: [{ ...session('s1', T0), deletedAt: T0 }],
        hands: [hand('h1', 's1', T0)],
      }),
      T0,
    ).bundle;
    expect(bundle.records.hands.h1).toBeDefined();

    const settled = settle(bundle, [only], LATER);
    expect(settled.records.sessions.s1).toBeUndefined();
    expect(settled.records.hands.h1).toBeUndefined();
  });

  it('keeps a collected venue while a session still names it', () => {
    const only = syncer('device-aaaa0001');
    let bundle = only.sync(
      null,
      changeSet({ venues: [{ ...venue('v1'), deletedAt: T0 }], sessions: [session('s1')] }),
      T0,
    ).bundle;
    bundle = only.sync(bundle, changeSet({}), LATER).bundle;
    // The merge un-tombstones it first, so there is nothing left to collect.
    expect(bundle.records.venues.v1).toBeDefined();
  });

  it('never collects a tombstone the merge has only just written', () => {
    // Collection runs last for this reason: the import-collision rule
    // tombstones a session with today's date, and a sweep that ran first could
    // in principle meet it with a stale line.
    const bundle = mergeIntoBundle(
      null,
      changeSet({
        venues: [venue('v1')],
        sessions: [session('a', T0, { importKey: 'k', createdAt: T0 }),
                   session('b', T0, { importKey: 'k', createdAt: T0 + HOUR })],
      }),
      0, LATER, 'device-aaaa0001',
    ).bundle;
    expect(bundle.records.sessions.b.deletedAt).not.toBeNull();
    expect(bundle.records.sessions.b).toBeDefined();
  });

  it('never credits a device with a cursor it was not given', () => {
    // Two wrong values have been in here. The stamp the request minted is only
    // spent if something is written, so a plain pull recorded a device as
    // having taken a number it was never handed. And the answer's own cursor
    // credits an answer that may never have arrived, which is the one thing
    // acknowledgements exist to stop.
    const phone = syncer('device-aaaa0001');
    const first = phone.sync(null, changeSet({ venues: [venue('v1')] }), T0);
    expect(first.bundle.devices['device-aaaa0001'].acked).toBe(0);

    // A pull that writes nothing still hands back a cursor, and the mark moves
    // to what the device sent, which is the cursor it took last time.
    const second = phone.sync(first.bundle, changeSet({}), T0 + HOUR);
    expect(second.bundle.devices['device-aaaa0001'].acked).toBe(first.cursor);
    expect(second.bundle.devices['device-aaaa0001'].acked)
      .toBeLessThanOrEqual(second.bundle.heardThrough);
  });

  it('records a device that names itself, and serves one that does not', () => {
    const named = mergeIntoBundle(null, changeSet({}), 0, T0, 'device-aaaa0001');
    expect(Object.keys(named.bundle.devices)).toEqual(['device-aaaa0001']);

    // An unnamed device holds nothing up and is protected by the window alone,
    // which is strictly safer than being counted wrongly.
    const anonymous = mergeIntoBundle(null, changeSet({}), 0, T0, null);
    expect(anonymous.bundle.devices).toEqual({});
  });

  it('ignores a device id that is not one', () => {
    for (const id of ['', 'short', 'x'.repeat(65), 'has spaces', '../../etc', '__proto__']) {
      const { bundle } = mergeIntoBundle(null, changeSet({}), 0, T0, id);
      expect({ ...bundle.devices }).toEqual({});
      // No prototype at all, which is what makes every lookup in here mean
      // what it says rather than answering for a dozen names nobody stored.
      expect(Object.getPrototypeOf(bundle.devices)).toBeNull();
    }
  });
});

describe('a cursor the bundle cannot place', () => {
  it('is read as never having synced rather than answered with silence', () => {
    // The bucket can be erased, and the next request starts a fresh bundle
    // whose stamps begin again from nothing. A device still holding a cursor
    // from the old one asks for everything after a number no record will ever
    // reach, and would be told nothing for the rest of its life.
    //
    // The stale cursor has to end up *above* where the fresh bundle starts, or
    // the device is served everything regardless and this proves nothing. It
    // gets there on its own: a stamp is `max(now, heardThrough + 1)`, so a
    // bundle that takes more rounds than the clock takes milliseconds runs its
    // own stamps past the wall clock. Erase that bucket and the replacement
    // begins at the clock again, below every number the device is holding.
    let held: unknown = null;
    let stale = 0;
    for (const id of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      const merged = mergeIntoBundle(held, changeSet({ venues: [venue(id)] }), stale, T0);
      held = merged.bundle;
      stale = merged.cursor;
    }
    expect(stale).toBeGreaterThan(T0);

    const erased = mergeIntoBundle(null, changeSet({ venues: [venue('after')] }), stale, T0);
    expect(erased.changes.venues.map((change) => change.record.id)).toEqual(['after']);
  });

  it('and so is one from a device this bundle has never answered', () => {
    // The other half, and the one that was missing. Being ahead of
    // `heardThrough` is only one of the two ways a cursor can be from
    // somewhere else: a cursor from another bucket is just a number, and it is
    // at least as likely to fall below this bundle's stamps as above them, at
    // which point it reads as an ordinary place in a conversation that never
    // happened. The device is answered with everything after it and nothing
    // before -- the tail of its own history, presented as all of it.
    //
    // A second person signing in on a device the first had synced a lot on is
    // exactly how that number arises.
    //
    // The stale cursor has to land *between* this bundle's records for the old
    // check to pass it and for the damage to show, which is why the two are
    // built on either side of it.
    const early = mergeIntoBundle(
      null,
      changeSet({ venues: [venue('early')] }),
      0,
      T0,
      'device-mine00001',
    );

    // Another bucket, synced to a stamp above that record and below the next.
    let theirs: unknown = null;
    let stale = 0;
    for (const id of ['t1', 't2']) {
      const merged = mergeIntoBundle(
        theirs,
        changeSet({ venues: [venue(id)] }),
        stale,
        T0 + HOUR,
        'device-theirs001',
      );
      theirs = merged.bundle;
      stale = merged.cursor;
    }

    const mine = mergeIntoBundle(
      early.bundle,
      changeSet({ venues: [venue('late')] }),
      early.cursor,
      T0 + 2 * HOUR,
      'device-mine00001',
    );

    // Below this bundle's newest stamp and above its oldest, so the check that
    // only asked "is it ahead?" let it straight through.
    expect(stale).toBeLessThan(mine.cursor);
    expect(stale).toBeGreaterThan(early.cursor);

    const { changes } = mergeIntoBundle(
      mine.bundle,
      changeSet({}),
      stale,
      T0 + 3 * HOUR,
      'device-theirs001',
    );
    expect(changes.venues.map((change) => change.record.id).sort()).toEqual(['early', 'late']);
  });

  /**
   * Three rounds an hour apart, and the id of the one left behind the cursor.
   *
   * The gap matters. A cursor is inclusive of the records stamped at it, so
   * the newest always comes back whatever the cursor says; only a record from
   * an earlier round is genuinely behind the mark, and only that one can show
   * whether a place was kept or thrown away.
   */
  const threeRounds = (device?: string) => {
    let bundle: unknown = null;
    let cursor = 0;
    let at = T0;
    for (const id of ['old', 'middle', 'newest']) {
      const merged = mergeIntoBundle(bundle, changeSet({ venues: [venue(id)] }), cursor, at, device);
      bundle = merged.bundle;
      cursor = merged.cursor;
      at += HOUR;
    }
    return { bundle, cursor, at };
  };

  it('but a device it has answered keeps its place', () => {
    // The rule has to cost nothing on the ordinary path, which is every sync
    // by every device that has ever synced here.
    const { bundle, cursor, at } = threeRounds('device-known0001');
    const { changes } = mergeIntoBundle(bundle, changeSet({}), cursor, at, 'device-known0001');
    expect(changes.venues.map((change) => change.record.id)).not.toContain('old');
  });

  it('and a device that does not name itself is left alone', () => {
    // One that sends no id is served without being counted, deliberately.
    // Clamping it would mean a full answer on every sync rather than once.
    const { bundle, cursor, at } = threeRounds();
    const { changes } = mergeIntoBundle(bundle, changeSet({}), cursor, at);
    expect(changes.venues.map((change) => change.record.id)).not.toContain('old');
  });

  it('and so is one that arrived corrupted', () => {
    const held = mergeIntoBundle(null, changeSet({ venues: [venue('v1')] }), 0, T0).bundle;
    for (const since of [Number.MAX_SAFE_INTEGER, -1]) {
      const { changes } = mergeIntoBundle(held, changeSet({}), since, T0 + HOUR);
      expect(changes.venues.map((change) => change.record.id)).toEqual(['v1']);
    }
  });
});

describe('a device that was away longer than the whole window', () => {
  const LATER = T0 + 120 * 24 * HOUR;

  /**
   * A bundle that has actually collected something, so the line is drawn.
   *
   * It has to have collected: the line is only moved by a sweep that removed a
   * row, which is what stops it refusing records on a bundle where nothing was
   * ever deleted.
   */
  const swept = () => {
    // The cursor is threaded back in, as a real device does: a device that
    // keeps asking from nothing has never confirmed anything, and collection
    // waits for it rather than guessing.
    let bundle: unknown = null;
    let cursor = 0;
    const round = (changes: unknown, clock: number) => {
      const merged = mergeIntoBundle(bundle, changes, cursor, clock, 'device-aaaa0001');
      bundle = merged.bundle;
      cursor = merged.cursor;
    };
    round(changeSet({ venues: [venue('v1')], sessions: [session('deleted-long-ago')] }), T0);
    round(changeSet({ sessions: [{ ...session('deleted-long-ago', T0), deletedAt: T0 }] }), T0);
    // Two syncs past the window, not one: the first is the one that hands the
    // tombstone over, and only the second may sweep it. See `collect`.
    round(changeSet({}), LATER);
    round(changeSet({}), LATER + HOUR);
    return bundle as Bundle;
  };

  it('cannot resurrect a row whose tombstone was collected', () => {
    // The backstop. An unknown record older than everything collected is
    // exactly the shape of a row whose tombstone was thrown away.
    const bundle = swept();
    expect(bundle.collectedThrough).toBeGreaterThan(T0);

    const { bundle: after } = mergeIntoBundle(
      bundle,
      changeSet({ sessions: [session('long-gone', T0)] }),
      0,
      LATER,
      'device-cccc0003',
    );
    expect(after.records.sessions['long-gone']).toBeUndefined();
  });

  it('but can still edit a record the server does know about', () => {
    // Not a blanket refusal of old stamps: the server has this one, so a
    // tombstone would have been there to refuse it if there were one.
    const bundle = swept();
    const { bundle: after } = mergeIntoBundle(
      bundle,
      changeSet({ venues: [venue('v1', T0 + 1, { name: 'renamed' })] }),
      0,
      LATER,
      'device-cccc0003',
    );
    expect(after.records.venues.v1.record.name).toBe('renamed');
  });

  it('and anything it wrote after the line still lands', () => {
    const bundle = swept();
    const { bundle: after } = mergeIntoBundle(
      bundle,
      changeSet({ sessions: [session('new-one', LATER)] }),
      0,
      LATER,
      'device-cccc0003',
    );
    expect(after.records.sessions['new-one']).toBeDefined();
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
    expect(asSeen(after(phone, laptop))).toEqual(asSeen(after(laptop, phone)));
  });
});
