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
 * ## The cursor is the server's stamp, and the comparison is `>=`
 *
 * A cursor answers one question: what has this device not been told yet. So it
 * has to be measured in the order the **server** learned things, not in the
 * order they happened on whichever phone wrote them.
 *
 * This was `record.updatedAt` and that was wrong, in a way that lost data
 * quietly. A delete made in a card room carries the moment it was made. If the
 * other device syncs before that phone finds signal, its cursor is already past
 * that moment, so when the tombstone finally lands it is never handed over:
 * not collected, not refused, simply never sent. The two devices then disagree
 * for as long as they both exist.
 *
 * So the server stamps each entry with `heardAt` when it writes it, and both
 * the answer and the cursor are cut on that. The device never interprets the
 * number; it echoes back whatever it was last given. There are still no
 * sequence numbers and no vector clocks, because there is still only one writer.
 *
 * `>=` rather than `>` is deliberate and costs one stamp's worth of records on
 * every sync. With `>`, anything sharing the cursor's exact millisecond is
 * invisible forever, which is a bug that would appear once a year and be
 * unreproducible when it did. Re-sending is free because applying a record
 * twice is a no-op: the merge is idempotent by construction, which is the
 * property that makes this safe rather than lucky.
 */

import { freshWindow, type RateWindow } from './rateLimit';
import type { Change, ChangeSet } from '../data/repository';
import type { Timestamp } from '../domain/types';

/**
 * Bumped only if a change would make an older client read a bundle wrongly.
 *
 * 2: the answer and the cursor are cut on `heardAt`, the server's own stamp,
 * rather than on `record.updatedAt`, which belongs to whichever device wrote
 * the record. A bundle stored under 1 is read by stamping every entry as heard
 * now, which costs each device one full re-pull and is the only reading of an
 * old bundle that cannot skip anything. See `readBundle`.
 */
export const BUNDLE_VERSION = 2;

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
 * A stored change: what a device sent, plus when this server wrote it.
 *
 * `heardAt` is the one clock in the system that belongs to the server, and two
 * separate things need it.
 *
 * **Delivery.** It is the cursor. A device is served everything heard at or
 * after the stamp it sends back, which is the only ordering that cannot skip a
 * record that arrived late. See the header of this file.
 *
 * **Retention.** `deletedAt` is a fact about a phone. A row deleted in a drawer
 * carries the moment it was deleted, which can be months before that phone next
 * has signal, so a tombstone arrives already older than the window and would be
 * swept in the request that first delivered it, while every other device is
 * still holding the live row. Ninety days of retention has to mean ninety days
 * the server has held the thing.
 *
 * Stamped whenever the stored entry actually changes and left alone when it
 * does not, so a device retrying a push it already sent neither restarts the
 * clock on its own delete nor re-sends the record to everybody else.
 */
export interface StoredChange extends Change<SyncRow> {
  heardAt: Timestamp;
  /**
   * What this server did to a stamp from the future, remembered so it is only
   * done once.
   *
   * A record above its own device's clock stays above that device's push mark,
   * so it is re-sent on every sync. Clamping it afresh each time gave it a
   * stamp later than anything anybody else had written, so it beat every real
   * edit and could not be corrected. `from` is the stamp the device keeps
   * sending, which identifies the write; `to` is what this server used instead.
   */
  clamped?: { from: Timestamp; to: Timestamp };
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
  records: { [T in SyncTable]: Record<string, StoredChange> };
  /**
   * What each device has taken, and when it was last here, by its opaque id.
   *
   * The only thing this is for is deciding when a tombstone may be collected,
   * and it is the difference between a rule and a guess. Time alone says "no
   * device is plausibly older than ninety days"; this says "no device *is*".
   *
   * It holds no more than an id somebody's app invented and two numbers. A
   * device not here for twice the window is forgotten, so a phone that was lost
   * cannot hold collection up forever.
   */
  devices: Record<string, DeviceMark>;
  /**
   * Which session each folded import was folded into, loser to keeper.
   *
   * The import rule tombstones a duplicate and moves what was logged against it
   * onto the survivor, and it can only move what is in the bundle when it
   * fires. A hand pushed after that names a session that is now a tombstone,
   * and there is no collision left for the rule to notice: it sits there
   * invisible until the tombstone is collected and takes it. So the decision is
   * remembered rather than re-derived.
   *
   * Server bookkeeping, like `heardAt`. It never goes on the wire, and it is
   * dropped for a loser once that tombstone has been collected.
   */
  folded: Record<string, string>;
  /**
   * The newest stamp this server has issued, and never a stamp it will reuse.
   *
   * Every `heardAt` comes from here rather than straight from the clock, and
   * it only ever moves forward: a stamp is the later of the wall clock and one
   * past this. Functions run on many machines and their clocks agree to within
   * milliseconds rather than exactly, and a stamp that went backwards would put
   * a record behind a cursor already handed out, which is the same lost record
   * this whole scheme exists to prevent.
   */
  heardThrough: Timestamp;
  /**
   * How often this person has asked, lately.
   *
   * Server bookkeeping like `folded` and `heardAt`: it never goes on the wire
   * and no device is told about it. It lives here rather than in a record of
   * its own because every POST already reads this object, so checking a limit
   * kept here costs nothing extra and refusing costs less than answering. See
   * `src/sync/rateLimit.ts`.
   */
  rate: RateWindow;
  /**
   * Tombstones deleted before this have been collected and are gone.
   *
   * Which makes it the line under which the server can no longer tell a record
   * it has never seen from one it deliberately forgot, and therefore the line
   * under which an unknown record is refused. See `mergeIntoBundle`.
   */
  collectedThrough: Timestamp;
}

/**
 * Two numbers about one device, on two different clocks, and they have to stay
 * apart because they answer two different questions.
 *
 * `acked` is the cursor it last sent, which is in the same space as `heardAt`
 * and is proof: a device writes its cursor only once it has applied the answer
 * that produced it. That is what decides whether anybody is still owed a
 * tombstone.
 *
 * `seen` is the wall clock, and it decides only whether this device still
 * exists. The two were one number until the cursor stopped being a record's own
 * stamp, and keeping them one meant a device that was perfectly caught up on a
 * server nobody had written to for months looked exactly like a phone that had
 * been sold.
 */
export interface DeviceMark {
  acked: Timestamp;
  seen: Timestamp;
}

/**
 * A map with no prototype, which is the only kind safe to key on a string
 * somebody else chose.
 *
 * Every map in a bundle is keyed by an id or a device name off the wire. On an
 * ordinary object, `held['toString']` is a function and `held['__proto__']` is
 * `Object.prototype`, so a lookup that means "is there an entry for this?"
 * answers yes for a dozen names nobody ever stored, and an assignment to one of
 * them either vanishes or rewrites the object. Guarding each read is a list to
 * keep in step with; having no prototype is the property itself.
 */
const bare = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export const emptyBundle = (): Bundle => ({
  rate: freshWindow(),
  version: BUNDLE_VERSION,
  records: {
    venues: bare(),
    sessions: bare(),
    rebuys: bare(),
    hands: bare(),
    moodEntries: bare(),
  },
  devices: bare(),
  folded: bare(),
  heardThrough: 0,
  collectedThrough: 0,
});

export interface SyncRequest {
  /**
   * The last cursor the server gave this device. 0 on one that has never
   * synced. Opaque: it is the server's stamp, and no device reads it.
   */
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
  /** What to send as `since` next time. Not a record's stamp; see above. */
  cursor: Timestamp;
  /** Everything heard at or after the request's `since`, or as much as fits. */
  changes: ChangeSet;
  /**
   * Whether the answer was cut, and so whether to ask again straight away.
   *
   * Absent reads as false, which costs a device on an older build nothing it
   * did not already have: it asks again on its next write and gets the rest.
   */
  more?: boolean;
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
  /**
   * Sync is in the pass and this claim has not bought it.
   *
   * Its own reason rather than folded into `unauthorized`, because the two
   * want opposite things from the person reading them: one is fixed by signing
   * in again and the other is not fixed by anything this device can do.
   */
  | 'unpaid'
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
