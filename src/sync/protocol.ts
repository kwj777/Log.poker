/**
 * What a device and the server say to each other.
 *
 * One round trip, and it does both halves: a device sends what it has changed
 * and what it last saw, and gets back everything it has not seen. There is no
 * separate pull, because a pull is this with nothing to push, and two endpoints
 * would be two chances to disagree about what a cursor means.
 *
 * ## Delta on the wire, bundle at rest
 *
 * The server keeps one object per person, the same shape and the same store
 * Untilt's sync keeps. What travels is only what changed. Measured against this
 * data model, five years of a three-sessions-a-week player is 1.34MB, so a
 * protocol that shipped the bundle would reach its own cap on exactly the
 * players the feature exists for, and a rebuy tapped at a table on one bar of
 * signal would send five years of history to record 200 dollars. See SYNC.md.
 *
 * ## The cursor is `updatedAt`, and the comparison is `>=`
 *
 * No sequence numbers, no vector clocks: every record already carries the one
 * stamp the merge sorts by, so there is nothing for two devices to keep in step.
 *
 * `>=` rather than `>` is deliberate and costs one millisecond of records on
 * every sync. With `>`, a record written by another device in the very
 * millisecond this one last synced is invisible forever, which is a bug that
 * would appear once a year and be unreproducible when it did. Re-sending is
 * free because applying a record twice is a no-op: the merge is idempotent by
 * construction, which is the property that makes this safe rather than lucky.
 */

import type { Change, ChangeSet } from '../data/repository';
import type { Timestamp } from '../domain/types';

/** Bumped only if a change would make an older client read a bundle wrongly. */
export const BUNDLE_VERSION = 1;

/** The tables that sync, in the order a merge has to apply them. */
export const SYNC_TABLES = ['venues', 'sessions', 'rebuys', 'hands', 'moodEntries'] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * The least a record must be for the merge to reason about it.
 *
 * The server does not know or care what a session is: it sorts by `updatedAt`,
 * keys by `id`, and carries the rest through untouched. That is what lets a
 * field be added to a session without the endpoint being redeployed.
 */
export interface SyncRow {
  id: string;
  updatedAt: Timestamp;
  [key: string]: unknown;
}

/**
 * What the server keeps: every record it has ever been told about, by id.
 *
 * Keyed rather than listed so a merge is a lookup per incoming record instead
 * of a scan, and tombstones sit in here beside live rows because a tombstone is
 * a record with a date on it rather than an absence.
 */
export interface Bundle {
  version: number;
  records: { [T in SyncTable]: Record<string, Change<SyncRow>> };
  /**
   * When each device was last seen, by its own opaque id.
   *
   * The only thing this is for is deciding when a tombstone may be collected,
   * and it is the difference between a rule and a guess. Time alone says "no
   * device is plausibly older than ninety days"; this says "no device *is*".
   *
   * It holds no more than an id somebody's app invented and a timestamp. A
   * device that has not been seen for the retention window is forgotten, so a
   * phone that was lost cannot hold collection up forever.
   */
  devices: Record<string, Timestamp>;
  /**
   * Tombstones deleted before this have been collected and are gone.
   *
   * Which makes it the line under which the server can no longer tell a record
   * it has never seen from one it deliberately forgot, and therefore the line
   * under which an unknown record is refused. See `mergeIntoBundle`.
   */
  collectedThrough: Timestamp;
}

export const emptyBundle = (): Bundle => ({
  version: BUNDLE_VERSION,
  records: { venues: {}, sessions: {}, rebuys: {}, hands: {}, moodEntries: {} },
  devices: {},
  collectedThrough: 0,
});

export interface SyncRequest {
  /** What this device has already seen. 0 on a device that has never synced. */
  since: Timestamp;
  /** Everything it has changed since it last pushed. Empty is a plain pull. */
  changes: ChangeSet;
  /**
   * Who is asking, so the server knows whether anybody is still waiting to see
   * a tombstone before it collects it. Opaque, invented by the app on first
   * run, and worth no more than knowing two requests came from one place.
   */
  device: string;
}

export interface SyncResponse {
  /** What to send as `since` next time. */
  cursor: Timestamp;
  /** Everything at or after the request's `since`, once the merge has run. */
  changes: ChangeSet;
  /**
   * How far back the server has collected. A device may safely drop its own
   * tombstones this old, because nothing will ever ask about them again.
   */
  collectedThrough: Timestamp;
}

/** An answer that is not one. The client shows one sentence for all of them. */
export type SyncFailure =
  /** No token, an unreadable one, or one this person may not sync with. */
  | 'unauthorized'
  /** Asked too often, or sent more than the endpoint will read. */
  | 'refused'
  /** No network, a timeout, or an answer that was not the shape promised. */
  | 'unreachable';

export const emptyChangeSet = (): ChangeSet => ({
  venues: [],
  sessions: [],
  rebuys: [],
  hands: [],
  moodEntries: [],
});

/** Whether a change set has anything in it, without counting all of it twice. */
export const isEmptyChangeSet = (changes: ChangeSet): boolean =>
  SYNC_TABLES.every((table) => changes[table].length === 0);

/** How many records a change set carries. Shown in Settings, nowhere else. */
export const countChanges = (changes: ChangeSet): number =>
  SYNC_TABLES.reduce((total, table) => total + changes[table].length, 0);
