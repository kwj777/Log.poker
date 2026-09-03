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
import type { Change, ChangeSet } from '../data/repository';
import {
  BUNDLE_VERSION,
  SYNC_TABLES,
  emptyBundle,
  type Bundle,
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

/** A stored bundle, or a fresh one, without trusting what came out of the store. */
export const readBundle = (stored: unknown): Bundle => {
  const bundle = emptyBundle();
  if (typeof stored !== 'object' || stored === null) return bundle;

  const { records } = stored as { records?: unknown };
  if (typeof records !== 'object' || records === null) return bundle;

  for (const table of SYNC_TABLES) {
    const held = (records as Record<string, unknown>)[table];
    if (typeof held !== 'object' || held === null) continue;
    for (const [id, change] of Object.entries(held as Record<string, unknown>)) {
      // `__proto__` is an ordinary string in JSON and a setter on a plain
      // object, so a map built by assignment would have its prototype rewritten
      // rather than gaining an entry.
      if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
      const clean = sanitize(change, Number.MAX_SAFE_INTEGER);
      if (clean && clean.record.id === id) bundle.records[table][id] = clean;
    }
  }
  return bundle;
};

const versioned = (change: Change<Row>): Versioned<Row> => change as Versioned<Row>;

/**
 * Two sessions cannot both be running, and only the bundle knows there are two.
 *
 * The rule and its reasoning are in `src/domain/merge.ts`; what happens here is
 * the bookkeeping around it. A session the rule closes is written back with an
 * `endedAt` and **no cash-out**, which leaves it neither active nor complete, so
 * it stays out of every total until the player says what came off the table.
 */
const settleActiveSessions = (bundle: Bundle, now: Timestamp): void => {
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
      if (typeof sessionId !== 'string' || typeof at !== 'number') continue;
      const seen = activityBySession.get(sessionId);
      if (seen === undefined || at > seen) activityBySession.set(sessionId, at);
    }
  }

  const candidates: ActiveSession[] = running.map((change) => ({
    session: change.record as unknown as Session,
    lastActivityAt: activityBySession.get(change.record.id) ?? null,
  }));

  for (const closed of resolveActiveSessions(candidates).close) {
    const held = sessions[closed.session.id];
    if (!held) continue;
    sessions[closed.session.id] = {
      record: { ...held.record, endedAt: closed.endedAt, cashOut: null, updatedAt: now },
      deletedAt: null,
    };
  }
};

/**
 * One import key is one session, however many devices imported the same file.
 *
 * The loser is tombstoned and anything logged against it moves across, because
 * the row is a duplicate and a hand somebody wrote a note on is not.
 */
const settleImportCollisions = (bundle: Bundle, now: Timestamp): void => {
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
        record: { ...held.record, importKey: null, updatedAt: now },
        deletedAt: now,
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
          record: { ...change.record, sessionId: collision.keep.id, updatedAt: now },
          deletedAt: null,
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
const settleVenueTombstones = (bundle: Bundle, now: Timestamp): void => {
  const liveSessions = Object.values(bundle.records.sessions)
    .filter((change) => change.deletedAt === null)
    .map((change) => ({ venueId: String(change.record.venueId ?? '') }));

  for (const [id, change] of Object.entries(bundle.records.venues)) {
    if (change.deletedAt === null) continue;
    if (venueTombstoneApplies(String(id), liveSessions)) continue;
    bundle.records.venues[id] = {
      record: { ...change.record, updatedAt: now },
      deletedAt: null,
    };
  }
};

export interface MergeResult {
  bundle: Bundle;
  /** Everything at or after `since` once the merge has run. */
  changes: ChangeSet;
  /** What the device should send as `since` next time. */
  cursor: Timestamp;
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
): MergeResult => {
  const bundle = readBundle(stored);
  bundle.version = BUNDLE_VERSION;

  const sent = (incoming ?? {}) as Record<string, unknown>;
  for (const table of SYNC_TABLES) {
    const list = sent[table];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const change = sanitize(raw, now);
      if (change === null) continue;
      const held = bundle.records[table][change.record.id];
      bundle.records[table][change.record.id] = held
        ? (resolve(versioned(held), versioned(change)) as Change<Row>)
        : change;
    }
  }

  // In order, and the order matters: closing a session changes which sessions
  // are live, which is what the venue rule reads.
  settleActiveSessions(bundle, now);
  settleImportCollisions(bundle, now);
  settleVenueTombstones(bundle, now);

  // Built loose and named once, because a `ChangeSet` is five differently
  // typed arrays and the server is deliberately indifferent to which is which.
  const collected: Record<SyncTable, Change<Row>[]> = {
    venues: [], sessions: [], rebuys: [], hands: [], moodEntries: [],
  };
  let cursor = since;
  for (const table of SYNC_TABLES) {
    for (const change of Object.values(bundle.records[table])) {
      if (change.record.updatedAt > cursor) cursor = change.record.updatedAt;
      if (change.record.updatedAt >= since) collected[table].push(change);
    }
  }
  const changes = collected as unknown as ChangeSet;

  return { bundle, changes, cursor };
};

/** Every table, for a caller that wants to walk one at a time. */
export const tablesOf = (bundle: Bundle): [SyncTable, Record<string, Change<Row>>][] =>
  SYNC_TABLES.map((table) => [table, bundle.records[table] as Record<string, Change<Row>>]);
