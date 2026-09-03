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
  Pick<Hand, 'holeCards' | 'position' | 'note' | 'tags' | 'amount' | 'at'>
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
   * two devices to keep in step. Nothing in the app calls this yet. It exists
   * now because tombstones are otherwise unobservable through this interface,
   * and an invariant nothing can read is an invariant nothing can test.
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
