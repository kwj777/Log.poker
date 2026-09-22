/**
 * The merge rules: what happens when two devices both have a say.
 *
 * Pure and platform-free, like everything else in this folder. Nothing here
 * touches storage or the network, which is deliberate: these are the rules that
 * decide whose version of a record survives, and rules that can only be
 * exercised by standing up two databases and a server are rules nobody
 * exercises. The sync engine will call them; the tests already do.
 *
 * Most of a merge needs no rules at all. Every record carries a
 * client-generated id and an `updatedAt`, so per-record last-write-wins is
 * commutative and idempotent on its own: merging A into B gives what merging B
 * into A gives, and merging twice changes nothing the first merge did not.
 *
 * The exceptions are the three cases where the thing being merged is a
 * *constraint* rather than a field, and a constraint cannot be resolved by
 * looking at one record. Both devices are right locally and the pair is wrong.
 * Those three are `resolveActiveSessions`, `resolveImportCollisions` and the
 * ordering `MERGE_ORDER` names. See SYNC.md.
 */

import type { Session, Timestamp } from './types';

/** Anything the merge can resolve: an id, and when it last changed. */
export interface Mergeable {
  id: string;
  updatedAt: Timestamp;
}

/**
 * A record and whether it is a tombstone.
 *
 * Structurally the same as the data layer's `Change<T>`, and declared here
 * rather than imported from it so that the domain keeps depending on nothing.
 */
export interface Versioned<T extends Mergeable> {
  record: T;
  deletedAt: Timestamp | null;
}

/**
 * How far ahead of the receiving clock a stamp may be and still be believed.
 *
 * `updatedAt` is the cursor and the tie-breaker, which makes a device with a
 * wrong clock a device that wins every merge until real time catches up. Five
 * minutes is loose enough that ordinary drift and a slow request never trip it,
 * and tight enough that a phone set to next year cannot overwrite a laptop for
 * a year.
 */
export const CLOCK_ALLOWANCE_MS = 5 * 60_000;

/**
 * A stamp, or the receiving clock's now if it claims to be from the future.
 *
 * Applied where a stamp arrives from somewhere else, never to a local write.
 * Clamping to `now` rather than rejecting the record keeps the change: the
 * player's edit is real even when their clock is not.
 */
export const clampStamp = (
  stamp: Timestamp,
  now: Timestamp,
  allowance: number = CLOCK_ALLOWANCE_MS,
): Timestamp => (stamp > now + allowance ? now : stamp);

/**
 * Which of two versions of the same record survives.
 *
 * Later `updatedAt` wins. The two tie-breaks under it exist so that both
 * devices reach the same answer without talking to each other, which is what
 * makes the merge commutative:
 *
 *  - **A tombstone beats a same-millisecond edit.** Not a coin toss: a
 *    tombstone is recoverable until it is collected, while a row that comes
 *    back rejoins the bankroll silently, and of the two mistakes only one is
 *    visible to the person it happens to.
 *  - **Then the greater serialization.** Arbitrary on purpose, and it only
 *    decides between two edits made in the same millisecond on two devices.
 *    Both sides serialize records built by the same helpers in `data/support`,
 *    so the key order is the same on each.
 */
export const resolve = <T extends Mergeable>(mine: Versioned<T>, theirs: Versioned<T>): Versioned<T> => {
  if (mine.record.updatedAt !== theirs.record.updatedAt) {
    return mine.record.updatedAt > theirs.record.updatedAt ? mine : theirs;
  }
  const mineDeleted = mine.deletedAt !== null;
  const theirsDeleted = theirs.deletedAt !== null;
  if (mineDeleted !== theirsDeleted) return mineDeleted ? mine : theirs;
  return canonical(mine.record) >= canonical(theirs.record) ? mine : theirs;
};

/**
 * A record as one string, in an order neither engine chose.
 *
 * The last tiebreak has to agree on every device or two of them keep different
 * rows under one id for good, and it used to be `JSON.stringify` -- whose key
 * order is *insertion* order. The SQL and Dexie row builders happen to agree
 * on that today, so nothing was wrong yet; the moment one of them adds a column
 * in a different place, the same record serializes two ways and the two devices
 * pick opposite winners. Sorting the keys removes the dependence entirely.
 *
 * **Sorted entries rather than a key list**, which is the version of this that
 * works. `JSON.stringify(value, array)` does not take a key *order*, it takes
 * an allowlist, and it applies that allowlist at every depth. A session's
 * `stakes` holds `smallBlind`, `bigBlind` and `ante`, none of which are keys of
 * the session, so every session serialized with `"stakes":{}` in it and two
 * sessions differing in nothing but their blinds compared equal. The tiebreak
 * then fell to `>=`, which answers `mine` -- and `mergeIntoBundle` always
 * passes the stored record as `mine`, so the winner was whichever push arrived
 * first. That is the order dependence this function exists to remove, worse
 * than the one it replaced, and on the field a player is most likely to be
 * correcting on two devices at once.
 */
const canonical = (record: Mergeable): string =>
  JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, (record as unknown as Record<string, unknown>)[key]]),
  );

/* ------------------------------------------------------- one active session */

/**
 * A session that is running, and the last thing that happened in it.
 *
 * `lastActivityAt` is the newest `at` across the session's rebuys, hands and
 * mood entries, or null when nothing was ever logged against it. The caller
 * computes it because it owns the children; this file owns only the rule.
 */
export interface ActiveSession {
  session: Session;
  lastActivityAt: Timestamp | null;
}

export interface ClosedSession {
  session: Session;
  /** When the merge ends it, which is the last thing it can prove happened. */
  endedAt: Timestamp;
}

export interface ActiveSessionResolution {
  /** The one that stays running, or null when there was nothing to resolve. */
  keep: Session | null;
  close: ClosedSession[];
}

/**
 * Two devices, two sessions started, one app that allows one.
 *
 * `getActiveSession` reads the newest open session, so without this the older
 * one does not error, it becomes a row that is invisible and permanently open,
 * and the player's hours quietly stop adding up.
 *
 * **The later `startedAt` stays running**, because it is the one the player is
 * most likely sitting in front of. The others are ended at the last activity
 * recorded against them, falling back to their own start when nothing was ever
 * logged, since a session cannot end before it began.
 *
 * **Nothing is cashed out.** A closed session keeps `cashOut: null`, which
 * leaves it neither active (`endedAt` is set) nor complete (`isComplete` wants
 * both), so it stays out of every total and every bankroll point until somebody
 * says what came off the table. Guessing zero would be a loss the player did
 * not take, and guessing the buy-in would be a result they did not get. The
 * state that means *this needs you* already existed; it did not need a column.
 */
export const resolveActiveSessions = (
  candidates: readonly ActiveSession[],
): ActiveSessionResolution => {
  if (candidates.length === 0) return { keep: null, close: [] };

  const ranked = [...candidates].sort(
    (a, b) =>
      b.session.startedAt - a.session.startedAt ||
      b.session.createdAt - a.session.createdAt ||
      (a.session.id < b.session.id ? 1 : a.session.id > b.session.id ? -1 : 0),
  );

  const [winner, ...losers] = ranked;
  return {
    keep: winner.session,
    close: losers.map(({ session, lastActivityAt }) => ({
      session,
      endedAt: Math.max(lastActivityAt ?? session.startedAt, session.startedAt),
    })),
  };
};

/* ------------------------------------------------------- import collisions */

export interface ImportCollision {
  /** The row that survives, and the one every child gets moved onto. */
  keep: Session;
  tombstone: Session[];
  /** Children of the tombstoned sessions, by session id. */
  reparent: { from: string; to: string }[];
}

/**
 * The same CSV imported on two devices before either had synced.
 *
 * Both imports were correct where they happened, and `importKey` is unique on
 * both engines, so the merge would try to write a second row into a unique
 * index: an error the player can neither understand nor act on, blocking the
 * next import rather than the duplicate.
 *
 * The key is derived from the source row, so **two sessions carrying the same
 * key are the same session**. The earlier `createdAt` survives, which keeps
 * whichever device imported first and makes the outcome independent of the
 * order the merge happens to see them in. Anything logged against the loser
 * moves across rather than going down with it: the row is a duplicate, but a
 * hand somebody wrote a note on is not.
 */
export const resolveImportCollisions = (
  sessions: readonly Session[],
): ImportCollision[] => {
  const byKey = new Map<string, Session[]>();
  for (const session of sessions) {
    // Not `!== null`. The server calls this on records it deliberately does not
    // validate field by field, so a session can reach here with no import key
    // at all or with an empty one, and both used to group. Every session
    // without a key would then collide with every other, and all but one of
    // somebody's history would be tombstoned with its hands moved onto the
    // survivor. The same check `applyChanges` makes before it touches the
    // unique index.
    if (typeof session.importKey !== 'string' || session.importKey === '') continue;
    const group = byKey.get(session.importKey);
    if (group) group.push(session);
    else byKey.set(session.importKey, [session]);
  }

  const collisions: ImportCollision[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const [keep, ...tombstone] = [...group].sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    collisions.push({
      keep,
      tombstone,
      reparent: tombstone.map((session) => ({ from: session.id, to: keep.id })),
    });
  }
  return collisions;
};

/* ------------------------------------------------------------ merge order */

/**
 * The order tables have to be merged in, parents before children.
 *
 * A session arriving from another device can name a venue this device has never
 * seen, and `PRAGMA foreign_keys` is on, so venues out of order is an insert
 * that throws in the middle of a merge rather than a row that arrives late.
 */
export const MERGE_ORDER = ['venues', 'sessions', 'rebuys', 'hands', 'moodEntries'] as const;

/**
 * Whether a venue tombstone may be applied, given the sessions that will exist
 * once the merge is done.
 *
 * A venue deleted on the laptop while a session was logged against it on the
 * phone is not a conflict either device can see: locally, each was allowed. The
 * tombstone loses, because the alternative is a session pointing at a row that
 * is on its way to being collected, and a venue nobody wants is a row that
 * costs nothing to keep.
 */
export const venueTombstoneApplies = (
  venueId: string,
  liveSessions: readonly { venueId: string }[],
): boolean => !liveSessions.some((session) => session.venueId === venueId);
