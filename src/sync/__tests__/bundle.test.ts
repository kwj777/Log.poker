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

describe('collecting tombstones', () => {
  const DAY = 24 * HOUR;
  const RETENTION = 90 * DAY;
  const LATER = T0 + RETENTION + 10 * DAY;

  /** A bundle holding one deleted session, tombstoned at T0. */
  const withADeletedSession = (device = 'device-aaaa0001') => {
    let bundle: unknown = mergeIntoBundle(
      null,
      changeSet({ venues: [venue('v1')], sessions: [session('s1')] }),
      0,
      T0,
      device,
    ).bundle;
    bundle = mergeIntoBundle(
      bundle,
      changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }),
      0,
      T0,
      device,
    ).bundle;
    return bundle;
  };

  it('keeps one that is not old enough yet', () => {
    const { bundle } = mergeIntoBundle(withADeletedSession(), changeSet({}), 0,
      T0 + 10 * DAY, 'device-aaaa0001');
    expect(bundle.records.sessions.s1.deletedAt).toBe(T0);
  });

  it('does not draw a line when it collected nothing', () => {
    // The line arms a refusal, and arming it on a sweep that removed nothing
    // would turn away records from any device that had simply been away.
    const { bundle } = mergeIntoBundle(
      mergeIntoBundle(null, changeSet({ venues: [venue('v1')] }), 0, T0, 'device-aaaa0001').bundle,
      changeSet({}), 0, LATER, 'device-aaaa0001',
    );
    expect(bundle.collectedThrough).toBe(0);
  });

  it('will not sweep a tombstone out of the very answer that delivers it', () => {
    // The bug the device map had all along, and the one it existed to prevent.
    // This device was stamped with the time of its own request before the sweep
    // ran, so it stopped being the oldest thing on the map the instant it
    // asked, the horizon jumped to the present, and the tombstone it had come
    // for went in the sweep -- out of the answer it was about to be handed.
    const { bundle, changes, collectedThrough } = mergeIntoBundle(
      withADeletedSession(), changeSet({}), 0, LATER, 'device-aaaa0001');

    expect(bundle.records.sessions.s1).toBeDefined();
    expect(collectedThrough).toBe(0);
    // Delivered, which is the whole reason it was kept.
    expect(changes.sessions.map((change) => change.record.id)).toContain('s1');
  });

  it('collects one past the window on the sync after the only device has seen it', () => {
    const delivered = mergeIntoBundle(
      withADeletedSession(), changeSet({}), 0, LATER, 'device-aaaa0001').bundle;
    const { bundle, collectedThrough } = mergeIntoBundle(
      delivered, changeSet({}), 0, LATER + HOUR, 'device-aaaa0001');
    expect(bundle.records.sessions.s1).toBeUndefined();
    expect(collectedThrough).toBeGreaterThan(T0);
  });

  it('measures the window from when it heard, not from the phone that deleted', () => {
    // A session deleted on a phone with no signal carries the moment it was
    // deleted. Four months later that phone finds wifi and pushes a tombstone
    // that is already older than the window, and on the deleting device's clock
    // there is nothing left to wait for -- while the second device, which last
    // synced an hour ago, is still holding the live row.
    let bundle: unknown = mergeIntoBundle(
      null,
      changeSet({ venues: [venue('v1')], sessions: [session('s1')] }),
      0, T0, 'device-aaaa0001',
    ).bundle;
    bundle = mergeIntoBundle(bundle, changeSet({}), 0, LATER - HOUR, 'device-bbbb0002').bundle;
    bundle = mergeIntoBundle(bundle, changeSet({}), 0, LATER - HOUR, 'device-aaaa0001').bundle;

    // Deleted back at T0, arriving now, a hundred days late.
    const arrived = mergeIntoBundle(
      bundle,
      changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] }),
      0, LATER, 'device-aaaa0001',
    );
    expect(arrived.bundle.records.sessions.s1).toBeDefined();
    expect(arrived.bundle.records.sessions.s1.deletedAt).toBe(T0);

    // And it stays until the second device has actually been answered.
    const later = mergeIntoBundle(arrived.bundle, changeSet({}), 0, LATER + HOUR,
      'device-aaaa0001');
    expect(later.bundle.records.sessions.s1).toBeDefined();
  });

  it('does not restart that clock when a device retries a push it already sent', () => {
    // Otherwise a retry loop is a tombstone that is never old enough, and a
    // sync loop is mostly retries.
    const tombstone = changeSet({ sessions: [{ ...session('s1', T0), deletedAt: T0 }] });
    let bundle: unknown = mergeIntoBundle(
      null, changeSet({ venues: [venue('v1')], sessions: [session('s1')] }), 0, T0,
      'device-aaaa0001',
    ).bundle;
    bundle = mergeIntoBundle(bundle, tombstone, 0, T0, 'device-aaaa0001').bundle;
    const heardAt = (bundle as Bundle).records.sessions.s1.heardAt;

    bundle = mergeIntoBundle(bundle, tombstone, 0, T0 + 10 * DAY, 'device-aaaa0001').bundle;
    expect((bundle as Bundle).records.sessions.s1.heardAt).toBe(heardAt);
  });

  it('will not collect one a second device has not seen', () => {
    // The rule this whole thing turns on. That device still holds the live row,
    // and collecting the tombstone would let it push the row into a server with
    // nothing left to refuse it.
    let bundle: unknown = mergeIntoBundle(
      null,
      changeSet({ venues: [venue('v1')], sessions: [session('s1')] }),
      0, T0, 'device-aaaa0001',
    ).bundle;
    // The second device syncs here, and then goes quiet forever.
    bundle = mergeIntoBundle(bundle, changeSet({}), 0, T0, 'device-bbbb0002').bundle;
    // The delete happens after that, so the second device has never seen it.
    bundle = mergeIntoBundle(
      bundle,
      changeSet({ sessions: [{ ...session('s1', T0 + DAY), deletedAt: T0 + DAY }] }),
      0, T0 + DAY, 'device-aaaa0001',
    ).bundle;

    // Well past the window as far as the first device is concerned. The line is
    // drawn by the second, which last synced before the delete existed.
    const merged = mergeIntoBundle(bundle, changeSet({}), 0, T0 + RETENTION + 2 * DAY,
      'device-aaaa0001');
    expect(merged.bundle.records.sessions.s1).toBeDefined();
    expect(merged.bundle.records.sessions.s1.deletedAt).toBe(T0 + DAY);
  });

  it('forgets a device gone longer than twice the window, so it cannot hold this up', () => {
    // Otherwise one lost phone freezes collection for the rest of somebody's
    // life, which is a worse outcome than the row it was protecting.
    let bundle: unknown = withADeletedSession('device-aaaa0001');
    bundle = mergeIntoBundle(bundle, changeSet({}), 0, T0, 'device-bbbb0002').bundle;

    // Just inside the forget threshold, it still blocks.
    const blocked = mergeIntoBundle(bundle, changeSet({}), 0, T0 + 2 * RETENTION - DAY,
      'device-aaaa0001');
    expect(blocked.bundle.records.sessions.s1).toBeDefined();

    // Past it, it is presumed gone and stops holding anything up.
    const merged = mergeIntoBundle(bundle, changeSet({}), 0, T0 + 2 * RETENTION + DAY,
      'device-aaaa0001');
    expect(merged.bundle.records.sessions.s1).toBeUndefined();
    expect(Object.keys(merged.bundle.devices)).toEqual(['device-aaaa0001']);
  });

  it('keeps a collected venue while a session still names it', () => {
    let bundle: unknown = mergeIntoBundle(
      null,
      changeSet({ venues: [{ ...venue('v1'), deletedAt: T0 }], sessions: [session('s1')] }),
      0, T0, 'device-aaaa0001',
    ).bundle;
    bundle = mergeIntoBundle(bundle, changeSet({}), 0, LATER, 'device-aaaa0001').bundle;
    // The merge un-tombstones it first, so there is nothing left to collect.
    expect((bundle as { records: { venues: Record<string, unknown> } }).records.venues.v1)
      .toBeDefined();
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

  it('records a device that names itself, and serves one that does not', () => {
    const named = mergeIntoBundle(null, changeSet({}), 0, T0, 'device-aaaa0001');
    expect(Object.keys(named.bundle.devices)).toEqual(['device-aaaa0001']);

    // An unnamed device holds nothing up and is protected by the window alone,
    // which is strictly safer than being counted wrongly.
    const anonymous = mergeIntoBundle(null, changeSet({}), 0, T0, null);
    expect(anonymous.bundle.devices).toEqual({});
  });

  it('ignores a device id that is not one', () => {
    for (const id of ['', 'short', 'x'.repeat(65), 'has spaces', '../../etc']) {
      const { bundle } = mergeIntoBundle(null, changeSet({}), 0, T0, id);
      expect(bundle.devices).toEqual({});
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
    let bundle: unknown = mergeIntoBundle(
      null,
      changeSet({ venues: [venue('v1')], sessions: [session('deleted-long-ago')] }),
      0, T0, 'device-aaaa0001',
    ).bundle;
    bundle = mergeIntoBundle(
      bundle,
      changeSet({ sessions: [{ ...session('deleted-long-ago', T0), deletedAt: T0 }] }),
      0, T0, 'device-aaaa0001',
    ).bundle;
    // Two syncs past the window, not one: the first is the one that hands the
    // tombstone over, and only the second may sweep it. See `collect`.
    bundle = mergeIntoBundle(bundle, changeSet({}), 0, LATER, 'device-aaaa0001').bundle;
    return mergeIntoBundle(bundle, changeSet({}), 0, LATER + HOUR, 'device-aaaa0001').bundle;
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
    expect(after(phone, laptop)).toEqual(after(laptop, phone));
  });
});
