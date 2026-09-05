/**
 * The merge, which runs on the server.
 *
 * Pure: a bundle and a change set in, a bundle and a change set out. It has no
 * network, no store and no clock of its own, which is what lets the whole of it
 * be tested without standing up either end. `netlify/functions/sync.mts` is the
 * thin part around it that reads a blob, checks a token and writes the blob
 * back, in the same way `SqlRepository` is the interesting part and
 * `expoSqliteDriver` is not.
 *
 * ## Why the server merges rather than the device
 *
 * Either would work, and the argument that decides it is which one you would
 * rather trust. A device that has been in a drawer for a month arrives with a
 * month-old view of the world and a clock that may be wrong. Resolving there
 * means the answer depends on which device asked, and the loser of any race is
 * whichever one happened to sync second. Resolving here means one place holds
 * the outcome, every device converges on it, and the rules are exercised by one
 * test suite rather than by however many app versions are still installed.
 *
 * It also means a device can be simple: send what changed, apply what comes
 * back. There is nothing for it to reason about.
 *
 * ## What it does, in order
 *
 * 1. **Clamp** every incoming stamp to the server's clock, so a phone set to
 *    next year cannot win every merge until real time catches up.
 * 2. **Resolve** each record against what is already stored, last write wins,
 *    a tombstone beating a same-millisecond edit.
 * 3. **Apply the three constraint rules**, which is the part a per-record merge
 *    cannot do, because each of them is about a pair of records that are each
 *    fine alone. See `src/domain/merge.ts`.
 * 4. **Sweep, and only then record who asked.** A device is stamped as caught
 *    up after the sweep rather than before it, or the request in which it asks
 *    for a tombstone is the request that decides nobody is waiting for one.
 *
 * The rules themselves live in the domain and are shared with the client, which
 * calls none of them today. One implementation, two possible callers, is the
 * whole reason they were written as pure functions rather than as part of this.
 */

import {
  clampStamp,
  resolve,
  resolveActiveSessions,
  resolveImportCollisions,
  venueTombstoneApplies,
  type ActiveSession,
  type Versioned,
} from '../domain/merge';
import type { Session, Timestamp } from '../domain/types';
import {
  DEVICE_FORGET_MS,
  TOMBSTONE_RETENTION_MS,
  type Change,
  type ChangeSet,
} from '../data/repository';
import {
  BUNDLE_VERSION,
  SYNC_TABLES,
  emptyBundle,
  type Bundle,
  type StoredChange,
  type SyncRow,
  type SyncTable,
} from './protocol';

type Row = SyncRow;

const isRow = (value: unknown): value is Row => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id !== '' &&
    row.id.length <= 200 &&
    // A record can name itself `__proto__`, and a bundle is a map built by
    // assignment. `readBundle` guards the same three on the way back in; this
    // is the side that stops one being stored in the first place.
    !RESERVED.has(row.id) &&
    typeof row.updatedAt === 'number' &&
    Number.isFinite(row.updatedAt)
  );
};

/**
 * A change from a device, with its stamps pulled back to this clock.
 *
 * Everything arriving here was written by somebody else's device, so nothing is
 * trusted: a record that is not the shape a record is gets dropped rather than
 * stored, the same rule Untilt's merge already follows for the same reason. A
 * person can only ever corrupt their own bundle, and "only their own" is not a
 * reason to let them.
 */
const sanitize = (change: unknown, now: Timestamp): Change<Row> | null => {
  if (typeof change !== 'object' || change === null) return null;
  const { record, deletedAt } = change as { record?: unknown; deletedAt?: unknown };
  if (!isRow(record)) return null;

  const stamped: Row = { ...record, updatedAt: clampStamp(record.updatedAt, now) };
  if (deletedAt === null || deletedAt === undefined) return { record: stamped, deletedAt: null };
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt)) return null;
  return { record: stamped, deletedAt: clampStamp(deletedAt, now) };
};

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Keys that are not keys.
 *
 * `__proto__` is an ordinary string in JSON and a setter on a plain object, so
 * a map built by assignment has its prototype rewritten rather than gaining an
 * entry. All three are nine characters or fewer of `[A-Za-z0-9_-]`, so the
 * device pattern above admits them too.
 */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * How many devices one person's bundle will remember at once.
 *
 * Far above anybody's real count and far below the size at which this stops
 * being a small object. Nothing else in a bundle is bounded by anything but the
 * log itself.
 */
const MAX_DEVICES = 64;

/** A device id worth recording, which is not the same as one worth serving. */
const namesADevice = (id: unknown): id is string =>
  typeof id === 'string' && !RESERVED.has(id) && DEVICE_ID.test(id);

/**
 * A stored bundle, or a fresh one, without trusting what came out of the store.
 *
 * `now` is what an entry written before `heardAt` existed is stamped with. That
 * is the whole of the version-1 migration and it is deliberately the blunt
 * option: stamping every old entry as heard now means every device is served
 * the whole bundle once, which is a re-pull of something it already has, and
 * costs nothing but bytes because applying a record twice is a no-op. The
 * alternative -- guessing a stamp from `updatedAt` -- can put an entry behind a
 * cursor a device is already holding, and that entry is then never delivered,
 * which is the exact bug the version bump is for.
 */
export const readBundle = (stored: unknown, now: Timestamp = 0): Bundle => {
  const bundle = emptyBundle();
  if (typeof stored !== 'object' || stored === null) return bundle;

  const { records, devices, collectedThrough, heardThrough, version } = stored as {
    records?: unknown;
    devices?: unknown;
    collectedThrough?: unknown;
    heardThrough?: unknown;
    version?: unknown;
  };

  const migrating = version !== BUNDLE_VERSION;

  if (typeof collectedThrough === 'number' && Number.isFinite(collectedThrough)) {
    bundle.collectedThrough = Math.max(0, collectedThrough);
  }
  if (typeof heardThrough === 'number' && Number.isFinite(heardThrough)) {
    bundle.heardThrough = Math.max(0, heardThrough);
  }
  // Dropped whole on the way across a version, because after the migration
  // above nothing in the bundle is older than the retention window, so nothing
  // is collectable for ninety days and there is nothing for a device to be
  // waiting on. Every device records itself again on its next sync.
  if (!migrating && typeof devices === 'object' && devices !== null) {
    for (const [id, mark] of Object.entries(devices as Record<string, unknown>)) {
      if (!namesADevice(id) || typeof mark !== 'object' || mark === null) continue;
      const { acked, seen } = mark as { acked?: unknown; seen?: unknown };
      if (typeof acked !== 'number' || !Number.isFinite(acked)) continue;
      if (typeof seen !== 'number' || !Number.isFinite(seen)) continue;
      bundle.devices[id] = { acked: Math.max(0, acked), seen: Math.max(0, seen) };
    }
  }

  if (typeof records !== 'object' || records === null) return bundle;

  for (const table of SYNC_TABLES) {
    const held = (records as Record<string, unknown>)[table];
    if (typeof held !== 'object' || held === null) continue;
    for (const [id, change] of Object.entries(held as Record<string, unknown>)) {
      if (RESERVED.has(id)) continue;
      const clean = sanitize(change, Number.MAX_SAFE_INTEGER);
      if (!clean || clean.record.id !== id) continue;
      // The server's own stamp, kept as written. An entry with none was stored
      // by a version that had none, and is stamped now: see above.
      const { heardAt } = change as { heardAt?: unknown };
      const at =
        !migrating && typeof heardAt === 'number' && Number.isFinite(heardAt) ? heardAt : now;
      bundle.records[table][id] = { ...clean, heardAt: at };
      if (at > bundle.heardThrough) bundle.heardThrough = at;
    }
  }
  return bundle;
};

/**
 * The stamp this request would issue: the later of the clock and one past the
 * last one issued.
 *
 * Everything a merge writes shares it, so the cursor handed out at the end of a
 * request covers exactly the records that request wrote. It is only recorded on
 * the bundle if something was actually written, which is what keeps a merge that
 * changed nothing from changing anything: a device retrying a push it already
 * sent must leave the bundle byte for byte as it found it.
 */
const stampFor = (bundle: Bundle, now: Timestamp): Timestamp =>
  Math.max(now, bundle.heardThrough + 1);

const versioned = (change: Change<Row>): Versioned<Row> => change as Versioned<Row>;

/**
 * The entry to store, stamped only if it really changed.
 *
 * `resolve` hands back one of the two objects it was given, so identity is the
 * test: getting the held one back means the push changed nothing. A retry of a
 * push that already landed must neither restart the retention clock on the
 * tombstone it carried nor re-send that record to every other device.
 */
const heard = (
  next: StoredChange | Change<Row>,
  held: StoredChange | undefined,
  at: Timestamp,
): StoredChange => (next === held ? held : { ...next, heardAt: at });

/**
 * A record a rule rewrote, stamped one step past the version it replaces.
 *
 * The three rules below are the server's own conclusions rather than anybody's
 * edit, and they used to be stamped `updatedAt: now`, which made them newer
 * than every push still in flight. A phone that deleted a session in a card
 * room came back with a tombstone stamped an hour earlier, lost the comparison,
 * and the delete was thrown away: the session was closed instead and came back
 * down to the device that deleted it.
 *
 * One past the row it replaces is the whole requirement. It beats that row, and
 * any stale copy of it a device is still holding, so a rule cannot be undone by
 * somebody re-sending what it just corrected. It loses to anything a person did
 * after that row was written, which is every edit and every delete that matters.
 * Delivery does not depend on it at all any more: `heardAt` carries the change
 * to every device whatever this says.
 */
const derived = (record: Row): Timestamp => record.updatedAt + 1;

/**
 * Two sessions cannot both be running, and only the bundle knows there are two.
 *
 * The rule and its reasoning are in `src/domain/merge.ts`; what happens here is
 * the bookkeeping around it. A session the rule closes is written back with an
 * `endedAt` and **no cash-out**, which leaves it neither active nor complete, so
 * it stays out of every total until the player says what came off the table.
 */
const settleActiveSessions = (bundle: Bundle, at: Timestamp, now: Timestamp): void => {
  const sessions = bundle.records.sessions;
  const running = Object.values(sessions).filter(
    (change) => change.deletedAt === null && change.record.endedAt === null,
  );
  if (running.length < 2) return;

  const activityBySession = new Map<string, Timestamp>();
  for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
    for (const change of Object.values(bundle.records[table])) {
      if (change.deletedAt !== null) continue;
      const sessionId = change.record.sessionId;
      const at = change.record.at;
      if (typeof sessionId !== 'string' || !Number.isFinite(at)) continue;
      const seen = activityBySession.get(sessionId);
      const stamped = clampStamp(at as Timestamp, now);
      if (seen === undefined || stamped > seen) activityBySession.set(sessionId, stamped);
    }
  }

  // This is the one rule that reads a field the server otherwise carries
  // through untouched, and `sanitize` validates only an id and a stamp. So the
  // numbers it ranks on are checked here, where they are used.
  //
  // **Clamped**, because the ranking is "the one started later" and a session
  // stamped next year on a phone with a wrong date would win it against every
  // real session on every device, forever: start one, and the app closes the
  // one you are actually sitting in.
  //
  // **And skipped when there is no start time at all**, because the alternative
  // is worse in a way that does not stop. `Math.max` over a missing stamp is
  // NaN, JSON writes NaN as null, and a session with a null `endedAt` is a
  // running session: the rule would close it again on every request for the
  // rest of the bundle's life, re-sending it to every device each time. Two
  // sessions left running is a visible oddity; that is a loop.
  const candidates: ActiveSession[] = [];
  for (const change of running) {
    const { startedAt, createdAt } = change.record;
    if (!Number.isFinite(startedAt)) continue;
    candidates.push({
      session: {
        ...(change.record as unknown as Session),
        startedAt: clampStamp(startedAt as Timestamp, now),
        createdAt: Number.isFinite(createdAt) ? clampStamp(createdAt as Timestamp, now) : 0,
      },
      lastActivityAt: activityBySession.get(change.record.id) ?? null,
    });
  }
  if (candidates.length < 2) return;

  for (const closed of resolveActiveSessions(candidates).close) {
    const held = sessions[closed.session.id];
    if (!held || !Number.isFinite(closed.endedAt)) continue;
    sessions[closed.session.id] = {
      record: {
        ...held.record,
        endedAt: closed.endedAt,
        cashOut: null,
        updatedAt: derived(held.record),
      },
      deletedAt: null,
      heardAt: at,
    };
  }
};

/**
 * One import key is one session, however many devices imported the same file.
 *
 * The loser is tombstoned and anything logged against it moves across, because
 * the row is a duplicate and a hand somebody wrote a note on is not.
 */
const settleImportCollisions = (bundle: Bundle, at: Timestamp): void => {
  const sessions = bundle.records.sessions;
  const live = Object.values(sessions)
    .filter((change) => change.deletedAt === null)
    .map((change) => change.record as unknown as Session);

  for (const collision of resolveImportCollisions(live)) {
    for (const loser of collision.tombstone) {
      const held = sessions[loser.id];
      if (!held) continue;
      // The key goes with it, exactly as `deleteSession` does locally: a
      // tombstone holding a unique key would block the next honest import.
      sessions[loser.id] = {
        record: { ...held.record, importKey: null, updatedAt: derived(held.record) },
        deletedAt: at,
        heardAt: at,
      };
    }

    const moving = new Set(collision.reparent.map((move) => move.from));
    if (moving.size === 0) continue;
    for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
      for (const [id, change] of Object.entries(bundle.records[table])) {
        if (change.deletedAt !== null) continue;
        if (typeof change.record.sessionId !== 'string') continue;
        if (!moving.has(change.record.sessionId)) continue;
        bundle.records[table][id] = {
          record: {
            ...change.record,
            sessionId: collision.keep.id,
            updatedAt: derived(change.record),
          },
          deletedAt: null,
          heardAt: at,
        };
      }
    }
  }
};

/**
 * A venue deleted on one device while a session was logged against it on
 * another is not a conflict either device could see. The tombstone loses: a
 * session pointing at a collected row is a broken read, and a venue nobody
 * wants costs nothing to keep.
 */
const settleVenueTombstones = (bundle: Bundle, at: Timestamp): void => {
  const liveSessions = Object.values(bundle.records.sessions)
    .filter((change) => change.deletedAt === null)
    .map((change) => ({ venueId: String(change.record.venueId ?? '') }));

  for (const [id, change] of Object.entries(bundle.records.venues)) {
    if (change.deletedAt === null) continue;
    if (venueTombstoneApplies(String(id), liveSessions)) continue;
    bundle.records.venues[id] = {
      record: { ...change.record, updatedAt: derived(change.record) },
      deletedAt: null,
      heardAt: at,
    };
  }
};

/**
 * Collect tombstones nobody is still waiting to hear about.
 *
 * Two conditions, and the second is the one that makes this a rule rather than
 * a guess.
 *
 * **Old enough.** Older than the retention window, which answers "how long can
 * a device be switched off and still come back coherent". Measured in server
 * time, from `heardAt`, and not from the `deletedAt` the deleting device wrote:
 * a session deleted on a phone with no signal arrives whenever that phone next
 * has some, and on its own clock it is already older than the window. Trusting
 * that stamp collects the tombstone in the same request that delivered it, with
 * every other device still holding the row.
 *
 * **And acknowledged by everybody.** A tombstone heard after the least
 * advanced device's cursor has not reached that device, and collecting it would
 * let that device push the live row back into a server with nothing left to
 * refuse it. A session somebody deleted in March would be back on every device
 * in June.
 *
 * Acknowledged rather than answered, and the distinction is the whole of it: a
 * device writes its cursor only once it has applied what that cursor covers, so
 * the number it sends is the one thing here that is proof rather than
 * assumption. An answer that was built and then lost to a dropped connection
 * proves nothing, and the map used to count it.
 *
 * A device not heard from for twice the window is forgotten first, so a phone
 * that was lost or replaced cannot hold collection up for the rest of
 * somebody's life. Twice rather than once because the two thresholds being
 * equal would make this whole rule decorative: every remembered device would be
 * newer than the window and the minimum would never be the binding one. That is
 * the case `collectedThrough` then covers, below.
 */
const collect = (bundle: Bundle, now: Timestamp): void => {
  // On the wall clock, which is the only one that can say a phone is gone.
  for (const [id, mark] of Object.entries(bundle.devices)) {
    if (now - mark.seen > DEVICE_FORGET_MS) delete bundle.devices[id];
  }

  // And a hard ceiling, because this is the one part of a bundle that grows
  // with something other than the log. A device that cannot read its own store
  // invents a new id every time it syncs, and nothing else here would ever stop
  // it: the oldest sighting goes first, which is the same judgment the rule
  // above makes, only sooner. Dropping a device can never lose a record; it can
  // only stop that device holding a tombstone back.
  const known = Object.entries(bundle.devices);
  if (known.length > MAX_DEVICES) {
    known.sort((a, b) => a[1].seen - b[1].seen);
    for (const [id] of known.slice(0, known.length - MAX_DEVICES)) delete bundle.devices[id];
  }

  // Reduced rather than spread: `Math.min(...list)` is an argument list, and a
  // long enough one throws rather than answering.
  const acked = Object.values(bundle.devices).map((mark) => mark.acked);
  const horizon = Math.min(
    now - TOMBSTONE_RETENTION_MS,
    // One past the least advanced cursor, because a device is served
    // everything at or after the number it sends and its next cursor is the
    // stamp of the answer it just took. So a cursor of C is proof of having
    // applied C, not merely of having applied everything below it, and without
    // the step the newest thing in the bundle could never be collected at all:
    // every device would sit acknowledging exactly it, forever.
    acked.length === 0
      ? Number.MAX_SAFE_INTEGER
      : acked.reduce((least, mark) => (mark < least ? mark : least), Infinity) + 1,
  );
  if (horizon <= bundle.collectedThrough) return;

  const referenced = new Set(
    Object.values(bundle.records.sessions).map((change) => String(change.record.venueId ?? '')),
  );

  let collected = 0;
  for (const table of SYNC_TABLES) {
    for (const [id, change] of Object.entries(bundle.records[table])) {
      if (change.deletedAt === null || change.heardAt >= horizon) continue;
      // A venue stays while anything still points at it, tombstoned or not, for
      // the same reason the local sweep keeps it: a session whose venue is gone
      // renders with no venue at all.
      if (table === 'venues' && referenced.has(id)) continue;
      delete bundle.records[table][id];
      collected += 1;
    }
  }

  // Only when something actually went. The line is "below here a tombstone may
  // have been removed", and it arms the refusal below; advancing it on a sweep
  // that removed nothing would refuse records from any device that had simply
  // been away a while, with no deleted row anywhere near them.
  if (collected > 0) bundle.collectedThrough = horizon;
};

export interface MergeResult {
  bundle: Bundle;
  /** Everything at or after `since` once the merge has run. */
  changes: ChangeSet;
  /** What the device should send as `since` next time. */
  cursor: Timestamp;
  /** How far back this bundle has been collected, for the device to match. */
  collectedThrough: Timestamp;
}

/**
 * Merge what a device sent, then answer with everything it has not seen.
 *
 * The answer is computed from the merged bundle rather than from what arrived,
 * so a device is told about its own records coming back changed: a session the
 * merge closed, or one that lost an import collision, reaches the device that
 * created it the same way anything else does.
 */
export const mergeIntoBundle = (
  stored: unknown,
  incoming: unknown,
  since: Timestamp,
  now: Timestamp,
  device: string | null = null,
): MergeResult => {
  const bundle = readBundle(stored, now);
  bundle.version = BUNDLE_VERSION;
  const at = stampFor(bundle, now);

  // A cursor this bundle cannot place is read as never having synced.
  //
  // The bucket can be erased, and the next request then starts a fresh bundle
  // whose stamps begin again from nothing. A device still holding a cursor from
  // the old one asks for everything after a number no record will ever reach,
  // and is answered with silence for the rest of its life. The same clamp
  // covers a cursor that was corrupted, and one restored onto a second device
  // from somebody else's backup. Re-pulling is free; being told nothing is not.
  const from = since > bundle.heardThrough ? 0 : Math.max(0, since);

  // What this device has acknowledged, which is not the same as when it asked.
  //
  // The map exists so a tombstone is not collected before every device has it,
  // and the only proof of that is the cursor a device sends: it writes one only
  // after it has applied the answer that produced it. Recording the moment of
  // the request instead trusts an answer that may never have arrived, and now
  // that a cursor and a `heardAt` are the same kind of number, the honest
  // version costs nothing.
  //
  // A device asking from nothing is recorded at this request's own stamp
  // instead, because it is about to be handed the whole bundle and so cannot be
  // waiting on any part of it. Recording its zero would freeze collection until
  // it came back.
  if (namesADevice(device)) {
    bundle.devices[device] = { acked: from > 0 ? from : at, seen: now };
  }

  const sent = (incoming ?? {}) as Record<string, unknown>;
  for (const table of SYNC_TABLES) {
    const list = sent[table];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const change = sanitize(raw, now);
      if (change === null) continue;
      const held = bundle.records[table][change.record.id];

      // The backstop for a device that was away longer than the whole retention
      // window and has already been forgotten. A record the server has never
      // seen, older than everything it has collected, is exactly the shape of a
      // row whose tombstone it threw away, and taking it would put a session
      // somebody deleted back on every device. Refusing it can lose a record
      // that device really did create and never sent, which is the worse thing
      // to lose but the rarer one: it needs three months offline and a write
      // that never left. See SYNC.md.
      if (!held && change.record.updatedAt < bundle.collectedThrough) continue;

      const next = held ? (resolve(versioned(held), versioned(change)) as StoredChange) : change;
      bundle.records[table][change.record.id] = heard(next, held, at);
    }
  }

  // In order, and the order matters: closing a session changes which sessions
  // are live, which is what the venue rule reads.
  settleActiveSessions(bundle, at, now);
  settleImportCollisions(bundle, at);
  settleVenueTombstones(bundle, at);

  // Last, so it never collects a tombstone one of the rules above just wrote,
  // and so an un-tombstoned venue is live again before anything looks at it.
  collect(bundle, now);

  // Built loose and named once, because a `ChangeSet` is five differently
  // typed arrays and the server is deliberately indifferent to which is which.
  const collected: Record<SyncTable, Change<Row>[]> = {
    venues: [], sessions: [], rebuys: [], hands: [], moodEntries: [],
  };
  let wrote = false;
  for (const table of SYNC_TABLES) {
    for (const change of Object.values(bundle.records[table])) {
      if (change.heardAt === at) wrote = true;
      // Cut on when this server heard the record, never on the stamp the
      // device that wrote it chose. A push that arrives late carries an old
      // `updatedAt` and would fall behind a cursor another device is already
      // holding, and would then never be delivered to it at all.
      //
      // `heardAt` itself is the server's note to itself and no part of what a
      // device was promised, so it is left here rather than put on the wire.
      if (change.heardAt >= from) {
        collected[table].push({ record: change.record, deletedAt: change.deletedAt });
      }
    }
  }
  const changes = collected as unknown as ChangeSet;

  // Recorded only now, and only if this request wrote something. A stamp that
  // was never used must stay available, or a merge that changed nothing would
  // still move the bundle and no push would ever be idempotent.
  if (wrote) bundle.heardThrough = at;

  // The stamp this request issued, not the newest record in the bundle: a
  // device that echoes it back is asking for everything heard after this
  // request, which is exactly what it has now been told.
  return { bundle, changes, cursor: bundle.heardThrough, collectedThrough: bundle.collectedThrough };
};

/** Every table, for a caller that wants to walk one at a time. */
export const tablesOf = (bundle: Bundle): [SyncTable, Record<string, StoredChange>][] =>
  SYNC_TABLES.map((table) => [table, bundle.records[table]]);
