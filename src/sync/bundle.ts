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
 * 4. **Sweep, against what every device has said it has.** A device is recorded
 *    at the cursor it sent, never at the clock and never at the answer it is
 *    about to be handed: an answer proves nothing until the device comes back
 *    with a number that covers it.
 *
 * The rules themselves live in the domain and are shared with the client, which
 * calls none of them today. One implementation, two possible callers, is the
 * whole reason they were written as pure functions rather than as part of this.
 */

import {
  CLOCK_ALLOWANCE_MS,
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
import { answerFrom } from './batch';
import { readWindow } from './rateLimit';
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
interface Sanitized {
  change: Change<Row>;
  /** Whether this server had to pull the stamp back to its own clock. */
  clamped: boolean;
  /** The stamp the device sent, which is what identifies the write. */
  raw: Timestamp;
}

const sanitize = (change: unknown, now: Timestamp): Sanitized | null => {
  if (typeof change !== 'object' || change === null) return null;
  const { record, deletedAt } = change as { record?: unknown; deletedAt?: unknown };
  if (!isRow(record)) return null;

  const raw = record.updatedAt;
  const stamp = clampStamp(raw, now);
  const clamped = stamp !== raw;
  const stamped: Row = { ...record, updatedAt: stamp };
  if (deletedAt === null || deletedAt === undefined) {
    return { change: { record: stamped, deletedAt: null }, clamped, raw };
  }
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt)) return null;
  return { change: { record: stamped, deletedAt: clampStamp(deletedAt, now) }, clamped, raw };
};

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Keys that are not keys, kept as a second line rather than the only one.
 *
 * Every map in a bundle is now built with no prototype (see `emptyBundle`), so
 * none of these can reach anything by inheritance and none of them rewrites the
 * object they are assigned to. This list stays because it is cheap and because
 * it was the only defense for one merge: `settleFoldedChildren` read its map
 * with a bare index, and a child naming `toString` was handed a function to
 * store as its session. The list would not have caught that one -- `toString`
 * is not on it -- which is the argument for fixing the shape rather than
 * lengthening the list.
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

  const { records, devices, folded, rate, collectedThrough, heardThrough, version } = stored as {
    records?: unknown;
    devices?: unknown;
    folded?: unknown;
    rate?: unknown;
    collectedThrough?: unknown;
    heardThrough?: unknown;
    version?: unknown;
  };

  // Kept across a version change, unlike the device marks below. It is a
  // minute of counting rather than anything about a record, so there is
  // nothing a migration could make wrong about it.
  bundle.rate = readWindow(rate);

  const migrating = version !== BUNDLE_VERSION;

  if (typeof collectedThrough === 'number' && Number.isFinite(collectedThrough)) {
    bundle.collectedThrough = Math.max(0, collectedThrough);
  }
  if (typeof heardThrough === 'number' && Number.isFinite(heardThrough)) {
    bundle.heardThrough = Math.max(0, heardThrough);
  }
  // Dropped whole on the way across a version. The marks are a claim about a
  // conversation this build has not had -- what a device acknowledged was a
  // cursor in the old bundle's terms -- and a wrong one holds a sweep up or
  // lets it run early. Every device records itself again on its next sync, and
  // until they do, `collect` falls back to the retention window alone, which is
  // the bound that was always underneath it.
  //
  // This used to lean on the restamping below instead: with every entry
  // stamped `now`, nothing was collectable for ninety days, so the marks had
  // nothing to hold up. The restamping is gone -- it made the bundle
  // unpageable, see below -- so the window is doing the work on its own, which
  // is what it does for a device that has been away too long in any case.
  if (!migrating && typeof devices === 'object' && devices !== null) {
    for (const [id, mark] of Object.entries(devices as Record<string, unknown>)) {
      if (!namesADevice(id) || typeof mark !== 'object' || mark === null) continue;
      const { acked, seen } = mark as { acked?: unknown; seen?: unknown };
      if (typeof acked !== 'number' || !Number.isFinite(acked)) continue;
      if (typeof seen !== 'number' || !Number.isFinite(seen)) continue;
      bundle.devices[id] = { acked: Math.max(0, acked), seen: Math.max(0, seen) };
    }
  }

  if (typeof folded === 'object' && folded !== null) {
    for (const [loser, keeper] of Object.entries(folded as Record<string, unknown>)) {
      if (RESERVED.has(loser) || typeof keeper !== 'string' || keeper === '') continue;
      if (loser === keeper) continue;
      bundle.folded[loser] = keeper;
    }
  }

  if (typeof records !== 'object' || records === null) return bundle;

  for (const table of SYNC_TABLES) {
    const held = (records as Record<string, unknown>)[table];
    if (typeof held !== 'object' || held === null) continue;
    for (const [id, change] of Object.entries(held as Record<string, unknown>)) {
      if (RESERVED.has(id)) continue;
      const sane = sanitize(change, Number.MAX_SAFE_INTEGER);
      if (!sane || sane.change.record.id !== id) continue;
      const clean = sane.change;
      // The server's own stamp, kept as written. An entry with none was stored
      // by a version that had none, and is stamped now: see above.
      const { heardAt, clamped: wasClamped } = change as { heardAt?: unknown; clamped?: unknown };
      // Kept whenever it is readable, **including across a version change**,
      // which is the part that was wrong. Restamping every entry with `now` on
      // a migration gave the whole bundle one stamp, and a bundle with one
      // stamp cannot be paged: the cursor is a stamp, so everything sharing one
      // is delivered together or not at all, and `answerFrom`'s budget stops
      // applying to any of it. A migration is exactly when a bundle is
      // largest, so the one moment paging mattered was the one it stopped
      // working. Nothing about a version bump makes an old stamp wrong -- it is
      // this server's own note of when it heard a record, in the same units --
      // and the fields a migration really does drop are handled above.
      const at = typeof heardAt === 'number' && Number.isFinite(heardAt) ? heardAt : now;
      const entry: StoredChange = { ...clean, heardAt: at };
      // What this server already decided about a stamp from the future, kept so
      // it is not decided again every time that record is re-sent.
      if (typeof wasClamped === 'object' && wasClamped !== null) {
        const { from, to } = wasClamped as { from?: unknown; to?: unknown };
        if (
          typeof from === 'number' && Number.isFinite(from) &&
          typeof to === 'number' && Number.isFinite(to)
        ) {
          entry.clamped = { from, to };
        }
      }
      bundle.records[table][id] = entry;
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
 * A stamp this server is willing to believe, or null.
 *
 * Not clamped. Clamping a future stamp answers `now`, and `now` moves: a rule
 * that stored the result compared it against the value it stored last time,
 * found a later one, and wrote the record again -- on every request, for the
 * life of the bundle, re-sending that session to every device each time. A
 * stamp the server cannot place is not evidence of anything, so it is dropped
 * rather than bent into a number that will be different next second.
 */
const believable = (stamp: unknown, now: Timestamp): Timestamp | null =>
  typeof stamp === 'number' && Number.isFinite(stamp) && stamp <= now + CLOCK_ALLOWANCE_MS
    ? stamp
    : null;

/**
 * The last thing logged against each session that this server can place in time.
 *
 * It ends up in a session's `endedAt`, where a wrong one is visible for years,
 * so a hand stamped next year contributes nothing rather than dragging the
 * session's end along behind the clock.
 */
const lastActivity = (bundle: Bundle, now: Timestamp): Map<string, Timestamp> => {
  const activity = new Map<string, Timestamp>();
  for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
    for (const change of Object.values(bundle.records[table])) {
      if (change.deletedAt !== null) continue;
      const sessionId = change.record.sessionId;
      const at = believable(change.record.at, now);
      if (typeof sessionId !== 'string' || at === null) continue;
      const seen = activity.get(sessionId);
      if (seen === undefined || at > seen) activity.set(sessionId, at);
    }
  }
  return activity;
};

/**
 * The parents in a push that the push itself is evidence for.
 *
 * The backstop in `mergeIntoBundle` refuses a record this server has never seen
 * whose stamp is below everything it has collected, because such a row is the
 * shape of one whose tombstone was thrown away, and taking it would put a
 * deleted session back on every device.
 *
 * **A venue with this week's sessions hanging off it is not that shape.** A
 * venue whose tombstone was collected has no live children arriving beside it;
 * one a player has been logging at all along does. Without this the refusal
 * cascaded, and it cascaded onto records the backstop has no argument with at
 * all: venues are merged before sessions and sessions before their children, so
 * a venue refused here left every session on it with a parent that is not in
 * the bundle, which the rule below refuses in turn, and every rebuy, hand and
 * mood entry under those went the same way. One venue stamped four months ago
 * took last night's session down with it.
 *
 * So a record at or above the horizon rescues the parent it names, and a parent
 * rescued that way rescues its own. Two levels is the whole depth of this
 * schema: children hang off sessions and sessions hang off venues.
 *
 * It does not widen what the backstop lets through on its own. A record with no
 * live relation in the same push is refused exactly as before, which is the
 * documented trade: a write that never left a device that was away longer than
 * the retention window is the rarer loss and the one this server cannot tell
 * from a resurrection.
 */
const rescuedParents = (
  sent: Record<string, unknown>,
  now: Timestamp,
  collectedThrough: Timestamp,
): Set<string> => {
  const rescued = new Set<string>();
  const sane = (table: SyncTable): Sanitized[] => {
    const list = sent[table];
    if (!Array.isArray(list)) return [];
    const out: Sanitized[] = [];
    for (const item of list) {
      const one = sanitize(item, now);
      if (one !== null) out.push(one);
    }
    return out;
  };

  // Leaves inward, so a session kept by one of its hands can go on to keep the
  // venue it is at.
  for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
    for (const { change } of sane(table)) {
      if (change.record.updatedAt < collectedThrough) continue;
      const parent = change.record.sessionId;
      if (typeof parent === 'string' && parent !== '') rescued.add(parent);
    }
  }
  for (const { change } of sane('sessions')) {
    const live =
      change.record.updatedAt >= collectedThrough || rescued.has(change.record.id);
    if (!live) continue;
    const parent = change.record.venueId;
    if (typeof parent === 'string' && parent !== '') rescued.add(parent);
  }
  return rescued;
};

/**
 * Two sessions cannot both be running, and only the bundle knows there are two.
 *
 * The rule and its reasoning are in `src/domain/merge.ts`; what happens here is
 * the bookkeeping around it. A session the rule closes is written back with an
 * `endedAt` and **no cash-out**, which leaves it neither active nor complete, so
 * it stays out of every total until the player says what came off the table.
 */
const settleActiveSessions = (
  bundle: Bundle,
  at: Timestamp,
  now: Timestamp,
  activityBySession: Map<string, Timestamp>,
): void => {
  const sessions = bundle.records.sessions;
  const running = Object.values(sessions).filter(
    (change) => change.deletedAt === null && change.record.endedAt === null,
  );
  if (running.length < 2) return;

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
    // A session this server cannot place in time is left out of the contest
    // entirely: it cannot win it and it cannot be closed by it.
    //
    // It used to be clamped to `now` instead, which is worse than useless.
    // `now` is later than every real session's start, so a session stamped next
    // year won the contest on every request and closed whichever one the player
    // was actually sitting in, for as long as it took real time to catch up.
    // And it moves, so the ranking was different every second.
    //
    // Two sessions left running is a visible oddity. That was a session ending
    // itself under somebody every time they sat down.
    const ranked = believable(startedAt, now);
    if (ranked === null) continue;
    candidates.push({
      session: {
        ...(change.record as unknown as Session),
        startedAt: ranked,
        createdAt: believable(createdAt, now) ?? 0,
      },
      lastActivityAt: activityBySession.get(change.record.id) ?? null,
    });
  }
  if (candidates.length < 2) return;

  for (const closed of resolveActiveSessions(candidates).close) {
    const held = sessions[closed.session.id];
    // And never at or below zero. Zero is the web engine's sentinel for a
    // session that has not ended (`OPEN_SESSION_ENDED_AT`), so a session
    // written with it reads as still running in the browser and as ended in
    // 1970 on the phone: the same row, two answers, forever.
    if (!held || !Number.isFinite(closed.endedAt) || closed.endedAt <= 0) continue;
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
 * A session cannot end before the last thing logged inside it.
 *
 * The rule above closes a session at whatever activity had reached the server
 * by then, and a hand pushed after that used to leave the end standing where it
 * was: a session whose own last hand is outside it, which is wrong on the
 * screen and wrong in every total that reads the span.
 *
 * Only where there is no cash-out, which is the state the rule leaves behind
 * and the one the app calls "needs a cash-out". A completed session's end is
 * the player's answer to what came off the table, and nothing here revises it.
 */
const settleSessionEnds = (
  bundle: Bundle,
  at: Timestamp,
  activityBySession: Map<string, Timestamp>,
): void => {
  for (const [id, change] of Object.entries(bundle.records.sessions)) {
    if (change.deletedAt !== null) continue;
    const { endedAt, cashOut } = change.record;
    if (!Number.isFinite(endedAt) || cashOut !== null) continue;
    const activity = activityBySession.get(id);
    if (activity === undefined || activity <= (endedAt as Timestamp)) continue;
    bundle.records.sessions[id] = {
      record: { ...change.record, endedAt: activity, updatedAt: derived(change.record) },
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

    // Remembered rather than acted on here, so a child that arrives after the
    // fold is moved too. `settleFoldedChildren` does the moving, every merge.
    for (const move of collision.reparent) bundle.folded[move.from] = move.to;
  }
};

/**
 * Move what is logged against a folded session onto the one it was folded into.
 *
 * Runs every merge rather than only when a collision fires, which is the whole
 * point: the collision is gone by the second merge, and a hand pushed after it
 * would otherwise name a tombstone for the rest of its short life.
 *
 * The row was a duplicate. A hand somebody wrote a note on is not.
 */
const settleFoldedChildren = (bundle: Bundle, at: Timestamp): void => {
  if (Object.keys(bundle.folded).length === 0) return;

  /** Through a chain of folds, and never round one. */
  const keeperFor = (id: string): string => {
    const walked = new Set<string>([id]);
    let held = id;
    for (;;) {
      const next = bundle.folded[held];
      if (next === undefined || walked.has(next)) return held;
      walked.add(next);
      held = next;
    }
  };

  for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
    for (const [id, change] of Object.entries(bundle.records[table])) {
      if (change.deletedAt !== null) continue;
      const sessionId = change.record.sessionId;
      if (typeof sessionId !== 'string' || bundle.folded[sessionId] === undefined) continue;
      const keeper = keeperFor(sessionId);
      if (keeper === sessionId) continue;
      bundle.records[table][id] = {
        record: { ...change.record, sessionId: keeper, updatedAt: derived(change.record) },
        deletedAt: null,
        heardAt: at,
      };
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
    //
    // **The step is one the pager does not always earn.** An answer may be cut
    // inside a single stamp, and then the cursor C it issues covers only part
    // of C: a tombstone at C held back from that answer is swept here before
    // the device has ever been handed it, and the row it deletes comes back
    // from that device for good. It takes a device further behind than the
    // retention window and a stamp whose records straddle the answer budget.
    // `pageOf` in `src/sync/batch.ts` says why it cannot be closed there --
    // one merge writes one stamp, so an atomic stamp is an unpageable push --
    // and so why the honest fix is on this side, in what a mark is allowed to
    // claim.
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

  // And whatever is left pointing at a session that is not here any more.
  //
  // The assertion two paragraphs down -- that both device engines take such a
  // child with the session -- is the one this rule rests on, and it was
  // asserted nowhere: the rule here is tested in `bundle.test.ts`, each
  // engine's sweep in the repository contract, and the agreement between them
  // by nothing at all. It is now, in `syncingRepository.test.ts`, against the
  // real merge and a real device through the whole lifecycle. Worth having
  // written down because this rule permanently destroys live records, and
  // because a device cannot see whether it ran: an orphaned child is skipped
  // on the way in, so every device looks identical whether the server dropped
  // it or is still serving it in every full pull for good.
  //
  // A live child can sit under a session tombstone: another device logs a hand
  // on a session this one has already deleted, and nothing reconciles the pair.
  // Both device engines take that child with the session when they sweep, and
  // this did not, so collecting the tombstone left the hand behind pointing at
  // an id that exists nowhere. Nothing could ever remove it: it is live, so the
  // sweep above skips it; no rule touches it; and no device will push a
  // tombstone for it, because every device already dropped it in its own sweep.
  // It is served in every full pull from then on and skipped by every device
  // that receives it, one row per hand logged on a session somebody else had
  // just deleted.
  for (const table of ['rebuys', 'hands', 'moodEntries'] as const) {
    for (const [id, change] of Object.entries(bundle.records[table])) {
      const sessionId = change.record.sessionId;
      if (typeof sessionId !== 'string' || bundle.records.sessions[sessionId]) continue;
      delete bundle.records[table][id];
      collected += 1;
    }
  }

  // A fold is remembered only for as long as the tombstone it names. Once that
  // is collected there is nothing left to move anything off, and a child still
  // pointing at it went in the same sweep.
  for (const loser of Object.keys(bundle.folded)) {
    if (!bundle.records.sessions[loser]) delete bundle.folded[loser];
  }

  // Only when something actually went. The line is "below here a tombstone may
  // have been removed", and it arms the refusal below; advancing it on a sweep
  // that removed nothing would refuse records from any device that had simply
  // been away a while, with no deleted row anywhere near them.
  if (collected > 0) bundle.collectedThrough = horizon;
};

export interface MergeResult {
  bundle: Bundle;
  /** Everything heard at or after `since`, or as much of it as will fit. */
  changes: ChangeSet;
  /** What the device should send as `since` next time. */
  cursor: Timestamp;
  /** Whether the answer was cut, and so whether to come straight back. */
  more: boolean;
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
  /** Only ever lowered by a test, which cannot otherwise meet the cap. */
  answerBudget?: number,
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
  //
  // **Being ahead is only one of the two ways a cursor can be from elsewhere,
  // and it was the only one checked.** A cursor from another bucket is just a
  // number, and it is at least as likely to fall *below* this bundle's
  // `heardThrough` as above it -- at which point it reads as a perfectly
  // ordinary place in a conversation that never happened. The device is then
  // answered with everything after it and nothing before, which is the tail of
  // its own history presented as the whole of it. Silent, permanent until
  // something else moves those records, and worst on the case that produces it:
  // a second person signing in on a device the first had synced a lot on.
  //
  // The other half of the check is the device map, which is the only record of
  // who this bundle has actually spoken to. **A device that has never been
  // answered here cannot be holding a number this bundle issued.** So a named
  // device with no mark starts from nothing, whatever it claims.
  //
  // Only a named one. A device that sends no id is served without being
  // counted, deliberately, and clamping it would mean a full answer on every
  // sync forever rather than once. The cost of the rule where it does apply is
  // one full pull for a device this bundle has forgotten, which takes six
  // months of not syncing, or for the sixty-fifth device somebody owns.
  const spokenTo = !namesADevice(device) || bundle.devices[device] !== undefined;
  const placeable = since <= bundle.heardThrough && spokenTo;
  const from = placeable ? Math.max(0, since) : 0;

  // What this device has acknowledged, which is the number it sent and nothing
  // else.
  //
  // The map exists so a tombstone is not collected before every device has it,
  // and the only proof of that is the cursor a device sends: it writes one only
  // after it has applied the answer that produced it.
  //
  // Two other values have been tried here and both were wrong. The moment of
  // the request credits an answer that may never have arrived. The stamp this
  // request minted credits a number the device is not even handed, because the
  // stamp is only spent if something was written -- and now that an answer can
  // be cut short, the cursor is the cut rather than the end of the bundle, so
  // crediting the answer would have a device claiming records it is still
  // waiting for the moment a pull is paged.
  //
  // A device asking from nothing is recorded at nothing, and collection stalls
  // until it comes back and says where it got to. That is the honest answer:
  // this server does not know what it has. It costs tombstones sitting a while
  // longer, and it is bounded by the forget threshold either way.
  //
  // Recorded before the sweep, because the number is the device's own and the
  // sweep is the thing it has to be allowed to hold up.
  if (namesADevice(device)) bundle.devices[device] = { acked: from, seen: now };

  const sent = (incoming ?? {}) as Record<string, unknown>;
  // Worked out before anything is written, because the tables are walked
  // parents first and a venue's fate is decided before its sessions are read.
  const rescued = rescuedParents(sent, now, bundle.collectedThrough);
  for (const table of SYNC_TABLES) {
    const list = sent[table];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const sane = sanitize(item, now);
      if (sane === null) continue;
      const { change, clamped, raw } = sane;
      const held = bundle.records[table][change.record.id];

      // Clamped once, not once per request.
      //
      // A row above its own device's clock stays above that device's push mark,
      // so it is re-sent on every sync. Clamped afresh each time, it was given
      // a stamp later than anything anybody else had written, so it beat every
      // real edit, was broadcast to everyone, and could not be corrected: the
      // device holding it refuses the corrected copy coming back, because its
      // own stamp is still a year larger.
      //
      // The raw stamp identifies the write, so a push carrying one this server
      // has clamped before is answered with the stamp it gave that write the
      // first time. A genuinely new edit from the same wrong clock carries a
      // different raw stamp and is clamped fresh, so it still lands.
      //
      // **Whether this request would clamp it again is not the question.** It
      // used to be asked, and the memory below outlives the condition on
      // purpose -- so once real time caught up with a stamp ten minutes in the
      // future, `clampStamp` stopped firing, the memory sitting on the record
      // was ignored, and the raw stamp went in verbatim. A row a device
      // re-sends on every foreground, with a stamp larger than anything anybody
      // else has written, came back a day later and beat the edit or the
      // tombstone that had corrected it. The server had recorded what it
      // decided about that write and then declined to read it.
      if (held?.clamped?.from === raw) {
        change.record.updatedAt = held.clamped.to;
      }

      // The backstop for a device that was away longer than the whole retention
      // window and has already been forgotten. A record the server has never
      // seen, older than everything it has collected, is exactly the shape of a
      // row whose tombstone it threw away, and taking it would put a session
      // somebody deleted back on every device. Refusing it can lose a record
      // that device really did create and never sent, which is the worse thing
      // to lose but the rarer one: it needs three months offline and a write
      // that never left. See SYNC.md.
      //
      // Unless this same push is carrying something live that hangs off it, in
      // which case it is not the shape of a collected row at all. See
      // `rescuedParents`, and the cascade it stops.
      if (
        !held &&
        change.record.updatedAt < bundle.collectedThrough &&
        !rescued.has(change.record.id)
      ) {
        continue;
      }

      // A record whose parent this server does not have is refused rather than
      // stored. The tables are walked parents first, so a parent arriving in
      // this same push is already here; one that is not here at all was either
      // never sent or refused by the line below, and storing the child anyway
      // leaves the bundle holding a row that resolves to nothing. Every device
      // is then served it and skips it, forever, while its cursor moves past.
      // The pager already refuses to *hand over* a child without its parent;
      // this is the same rule on the way in.
      const parent =
        table === 'sessions'
          ? change.record.venueId
          : table === 'venues'
            ? null
            : change.record.sessionId;
      if (typeof parent === 'string' && !bundle.records[table === 'sessions' ? 'venues' : 'sessions'][parent]) {
        continue;
      }

      const next = held ? (resolve(versioned(held), versioned(change)) as StoredChange) : change;
      const stored = heard(next, held, at);
      // Kept across a write from anybody else, because the mapping is about
      // the device that keeps sending that stamp, not about who last touched
      // the record. Dropping it here is what let the stale row win again the
      // moment somebody edited what it was overwriting.
      const memory = clamped ? { from: raw, to: change.record.updatedAt } : held?.clamped;
      bundle.records[table][change.record.id] = memory
        ? { ...stored, clamped: memory }
        : stored;
    }
  }

  // In order, and the order matters twice over.
  //
  // Collisions first, because that rule *removes* sessions: a duplicate that
  // exists only until the end of this merge could otherwise win the
  // one-active-session contest and close the session the player is actually
  // sitting in, permanently, on the word of a row that no longer exists. Which
  // of the two happened depended on which push carried the duplicate, so the
  // merge was not even commutative.
  //
  // Then the folding, so the activity read below counts a hand under the
  // session it has just been moved onto rather than the one it left.
  //
  // And the venue rule last, because closing a session changes which sessions
  // are live and that is what it reads.
  settleImportCollisions(bundle, at);
  settleFoldedChildren(bundle, at);
  const activity = lastActivity(bundle, now);
  settleActiveSessions(bundle, at, now, activity);
  settleSessionEnds(bundle, at, activity);
  settleVenueTombstones(bundle, at);

  // Last, so it never collects a tombstone one of the rules above just wrote,
  // and so an un-tombstoned venue is live again before anything looks at it.
  collect(bundle, now);

  let wrote = false;
  for (const table of SYNC_TABLES) {
    for (const change of Object.values(bundle.records[table])) {
      if (change.heardAt === at) wrote = true;
    }
  }

  // Recorded only now, and only if this request wrote something. A stamp that
  // was never used must stay available, or a merge that changed nothing would
  // still move the bundle and no push would ever be idempotent.
  if (wrote) bundle.heardThrough = at;

  // Cut on when this server heard each record, never on the stamp the device
  // that wrote it chose: a push that arrives late carries an old `updatedAt`
  // and would fall behind a cursor another device is already holding, and would
  // then never be delivered to it at all.
  //
  // And bounded, which it was not. See `answerFrom`. When nothing is held back
  // the cursor is the stamp this request issued rather than the newest record,
  // because a device echoing it back is asking for everything heard after this
  // request, which is exactly what it has now been told.
  const answer = answerFrom(bundle.records, from, bundle.heardThrough, answerBudget);

  return {
    bundle,
    changes: answer.changes,
    cursor: answer.cursor,
    more: answer.more,
    collectedThrough: bundle.collectedThrough,
  };
};

/** Every table, for a caller that wants to walk one at a time. */
export const tablesOf = (bundle: Bundle): [SyncTable, Record<string, StoredChange>][] =>
  SYNC_TABLES.map((table) => [table, bundle.records[table]]);
