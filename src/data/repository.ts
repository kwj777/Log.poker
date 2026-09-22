/**
 * The storage contract.
 *
 * Two implementations satisfy it: `SqlRepository` (SQLite via expo-sqlite on
 * iOS/Android) and `DexieRepository` (IndexedDB on web). Nothing above this
 * interface knows which one it is talking to, which is what makes the same
 * screens run on all three targets -- and what will make a syncing
 * implementation droppable later without touching a feature folder.
 *
 * Every method is async even where an implementation could answer synchronously,
 * so the interface stays honest about the slowest backend.
 */

import type {
  Cents,
  GameType,
  SessionFormat,
  Hand,
  MoodEntry,
  NewHand,
  NewMoodEntry,
  NewRebuy,
  NewSession,
  NewVenue,
  Rebuy,
  Session,
  SessionWithChildren,
  Timestamp,
  Venue,
} from '../domain/types';

export interface SessionFilter {
  venueId?: string;
  format?: SessionFormat;
  gameType?: GameType;
  /** Inclusive lower bound on `startedAt`. */
  from?: Timestamp;
  /** Exclusive upper bound on `startedAt`. */
  to?: Timestamp;
  /** `active` = still running, `completed` = cashed out. Defaults to `all`. */
  status?: 'all' | 'active' | 'completed';
  limit?: number;
}

/**
 * The player's own settings, which are facts about them rather than about a night.
 *
 * One field so far. It is here rather than in a file beside the auth token
 * because it belongs to the log -- `clearAll` should take it, and a phone with
 * no sessions on it has no starting balance either -- and because both engines
 * already have a database and neither platform has a key-value store this app
 * ships without adding a dependency for.
 *
 * **Not synced.** Adding a sixth table to `SYNC_TABLES` means a bundle format,
 * tombstones, and a merge rule for a singleton, which is a great deal of the
 * riskiest machinery in this repository for one number somebody types once.
 * The cost is that a second device shows profit until the number is entered
 * there too, which the field says plainly. It is a thing to revisit the next
 * time the sync layer is open for its own reasons, not before.
 */
export interface StartingBalance {
  /** What the player had behind them before the first logged session. */
  cents: Cents;
  /**
   * Which money that is.
   *
   * Carried with the amount for the same reason a session carries one: a log
   * can hold more than one currency, every total on the dashboard is scoped to
   * a single one, and a balance in dollars added to a euro column would be the
   * currency bug this app has already had once.
   */
  currency: string;
}

export interface Preferences {
  /**
   * The balance behind the first logged session, or null for never asked.
   *
   * Null is unasked; `{ cents: 0 }` is a player who started from nothing and
   * is a real answer. Everything that reads this has to tell those apart,
   * because the difference is whether the dashboard says "bankroll" at all.
   */
  startingBalance: StartingBalance | null;
}

export type VenuePatch = Partial<NewVenue>;
export type SessionPatch = Partial<
  Pick<
    Session,
    | 'venueId'
    | 'gameType'
    | 'stakes'
    | 'currency'
    | 'buyIn'
    | 'fee'
    | 'cashOut'
    | 'entrants'
    | 'finishPosition'
    | 'startedAt'
    | 'endedAt'
    | 'notes'
  >
>;
export type HandPatch = Partial<
  Pick<Hand, 'holeCards' | 'board' | 'position' | 'note' | 'tags' | 'amount' | 'at'>
>;

/**
 * A record as the sync layer sees it: the row, and whether it is a tombstone.
 *
 * `deletedAt` is deliberately not a field on `Session`, `Hand` and the rest.
 * A tombstone is a storage fact rather than a domain one, every read below
 * filters them out, and keeping the flag off the domain types is what makes it
 * impossible for a screen to render one by forgetting to check.
 */
export interface Change<T> {
  record: T;
  /** When the row was tombstoned, or null while it is live. */
  deletedAt: Timestamp | null;
}

/** Everything that changed after a cursor, tombstones included. */
export interface ChangeSet {
  venues: Change<Venue>[];
  sessions: Change<Session>[];
  rebuys: Change<Rebuy>[];
  hands: Change<Hand>[];
  moodEntries: Change<MoodEntry>[];
}

export interface Repository {
  /** Create tables / open the database. Safe to call repeatedly. */
  init(): Promise<void>;

  /**
   * Every record with `updatedAt` strictly after `since`, tombstones included.
   *
   * The only read that can see a deleted row, and the seam the sync engine
   * plugs into: `updatedAt` is the cursor, so there is no sequence number for
   * two devices to keep in step.
   *
   * It was written before there was a sync to plug in, "because tombstones are
   * otherwise unobservable through this interface, and an invariant nothing
   * can read is an invariant nothing can test." Every push calls it now --
   * `SyncingRepository.run` reads the pending change set through it -- which
   * is why `schema.ts` indexes for it and calls it "the read that runs after
   * every write".
   */
  listChangedSince(since: Timestamp): Promise<ChangeSet>;

  /**
   * Write records exactly as given, stamps and tombstones included.
   *
   * The other half of `listChangedSince`, and the sync engine's only write. It
   * upserts rather than creating, and it does **not** touch `updatedAt`: these
   * records are already resolved, and re-stamping them would make every
   * incoming record look like a local change and push it straight back.
   *
   * Applied parents first, because a session can arrive naming a venue this
   * device has never seen. A record whose parent is still missing after its
   * table's turn is skipped rather than thrown on: this runs in a background
   * loop where one inconsistent row should cost that row and not the sync.
   */
  applyChanges(changes: ChangeSet): Promise<void>;

  /**
   * Remove tombstones deleted before `before`, for real this time. Answers how
   * many rows went.
   *
   * **Collecting one too early resurrects the record.** A device still holding
   * the live row meets a server with nothing to refuse it, pushes, and a
   * session somebody deleted months ago is back on every device. So `before` is
   * never chosen here: the caller works out how far back is safe, and this only
   * does as it is told. See `TOMBSTONE_RETENTION_MS` and, on the server side,
   * the device map in `src/sync/bundle.ts`.
   *
   * Children first, then sessions, then venues, and a venue only when nothing
   * references it at all: foreign keys are on, and a half-collected sweep is
   * worse than an uncollected one.
   */
  collectTombstones(before: Timestamp): Promise<number>;

  getPreferences(): Promise<Preferences>;
  /** Merges the patch and answers the settings as they now are. */
  setPreferences(patch: Partial<Preferences>): Promise<Preferences>;

  listVenues(): Promise<Venue[]>;
  getVenue(id: string): Promise<Venue | null>;
  createVenue(input: NewVenue): Promise<Venue>;
  updateVenue(id: string, patch: VenuePatch): Promise<Venue>;
  /**
   * Tombstones the venue. Rejects if any live session still references it.
   *
   * A tombstoned session does not hold a venue back, but its `venueId` still
   * points at the row, which is why the venue is tombstoned rather than
   * removed: the foreign key has to keep resolving for history that is only
   * waiting to be collected.
   */
  deleteVenue(id: string): Promise<void>;

  listSessions(filter?: SessionFilter): Promise<SessionWithChildren[]>;
  getSession(id: string): Promise<SessionWithChildren | null>;
  /** The single running session, if one exists. Log allows only one at a time. */
  getActiveSession(): Promise<SessionWithChildren | null>;
  createSession(input: NewSession): Promise<Session>;
  /**
   * Create many sessions in one transaction -- the session-summary import.
   *
   * All-or-nothing. A file that names a venue that does not exist, or that
   * duplicates a session already imported, writes nothing: a half-imported
   * bankroll is worse than a failed import, because only one of the two is
   * obvious to the person looking at it.
   */
  createSessions(inputs: readonly NewSession[]): Promise<Session[]>;
  /**
   * Every import key already stored. The importer diffs a file against this, so
   * re-importing last month's export adds the new sessions and skips the rest.
   */
  listImportKeys(): Promise<string[]>;
  updateSession(id: string, patch: SessionPatch): Promise<Session>;
  /** Cash out and stamp the end time in one write. */
  endSession(id: string, cashOut: number, endedAt: Timestamp): Promise<Session>;
  /**
   * Tombstones the session, and cascades tombstones to its rebuys, hands and
   * mood entries under the same stamp, so no merge can revive a hand whose
   * session is gone.
   *
   * Also clears `importKey`. Deleting an imported session has always made it
   * importable again, and a tombstone that kept the key would hold it in the
   * unique index forever and silently break re-import. The key is derived from
   * the source row, so a re-import simply mints it again.
   */
  deleteSession(id: string): Promise<void>;

  listRebuys(sessionId: string): Promise<Rebuy[]>;
  addRebuy(input: NewRebuy): Promise<Rebuy>;
  deleteRebuy(id: string): Promise<void>;

  /** All hands, newest first, optionally scoped to one session. */
  listHands(sessionId?: string): Promise<Hand[]>;
  /**
   * How many live hands there are, without reading any of them.
   *
   * Settings prints this number and nothing else needs it. It exists because
   * the alternative was holding every hand ever logged in memory so that one
   * line of one screen could call `.length` on it, which is what the store used
   * to do and what made a hand write the most expensive write in the app.
   */
  countHands(): Promise<number>;
  getHand(id: string): Promise<Hand | null>;
  createHand(input: NewHand): Promise<Hand>;
  updateHand(id: string, patch: HandPatch): Promise<Hand>;
  deleteHand(id: string): Promise<void>;

  listMoodEntries(sessionId?: string): Promise<MoodEntry[]>;
  createMoodEntry(input: NewMoodEntry): Promise<MoodEntry>;
  deleteMoodEntry(id: string): Promise<void>;

  /**
   * Wipes user data. Used by the dev seeder and the settings reset.
   *
   * A truncate rather than a tombstone sweep, deliberately, and it is the one
   * delete in here that is not a tombstone. Reset means "this device", not
   * "every device": writing tombstones here would push a wipe to every other
   * one, so a player clearing a phone they are about to sell would take five
   * years of history off the laptop with it. Erasing everywhere is a different
   * action and needs its own control. See SYNC.md.
   */
  clearAll(): Promise<void>;
}

/**
 * How long a tombstone is kept before it can be collected.
 *
 * The number answers one question: how long can a device be switched off and
 * still come back with a coherent view? Ninety days covers a phone in a drawer
 * for a season, which is the realistic worst case for an app somebody opens at
 * a poker table. A tombstone is a few hundred bytes, so being generous costs
 * almost nothing and being wrong costs a resurrected session on every device.
 *
 * It is a floor rather than the rule. The server will not collect a tombstone
 * any device has yet to see, however old it is.
 */
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * How far back a signed-out device may collect its own tombstones.
 *
 * The window is the answer whenever the server is holding nothing this device
 * wrote: there is no bucket anywhere to send a deleted row back, so a
 * tombstone past the window has no job left to do.
 *
 * Otherwise the window, or the moment the server last heard everything,
 * whichever is further back. A tombstone older than `settled` was pushed, by
 * definition, so the server holds the delete too and dropping the local copy
 * loses nothing. One newer than it may never have been sent, and sweeping that
 * one does not lose the delete quietly: it loses it loudly, on the next sync,
 * when the row comes back down onto every device this person owns.
 *
 * The cost is tombstones kept past the window on a device that signed out and
 * never came back. They are a few hundred bytes each, and a session a week for
 * five years is under a hundred kilobytes, against a resurrected session on
 * every device for the other choice.
 */
export const safeToCollect = (settled: Timestamp, now: Timestamp): Timestamp => {
  const window = now - TOMBSTONE_RETENTION_MS;
  return settled > 0 ? Math.min(window, settled) : window;
};

/**
 * How long a device is remembered as one that might still be waiting.
 *
 * Twice the retention window, and it has to be longer than it or the rule it
 * serves does nothing: a device is only worth counting while it can still hold
 * collection up, and if it were forgotten at exactly the window then every
 * remembered device would be newer than the window and the count would never
 * decide anything.
 *
 * So between ninety days and a hundred and eighty, a device that has been away
 * blocks collection of anything it has not seen. Past that it is presumed gone
 * -- a phone that was sold, or replaced -- because one lost device should not
 * freeze collection for the rest of somebody's life. That is the case the
 * refusal in `mergeIntoBundle` then covers.
 */
export const DEVICE_FORGET_MS = 2 * TOMBSTONE_RETENTION_MS;

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConstraintError';
  }
}
