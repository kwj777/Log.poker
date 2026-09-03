/**
 * The storage contract.
 *
 * Two implementations satisfy it: `SqlRepository` (SQLite via expo-sqlite on
 * iOS/Android) and `DexieRepository` (IndexedDB on web). Nothing above this
 * interface knows which one it is talking to, which is what makes the same
 * screens run on all three targets — and what will make a syncing
 * implementation droppable later without touching a feature folder.
 *
 * Every method is async even where an implementation could answer synchronously,
 * so the interface stays honest about the slowest backend.
 */

import type {
  GameType,
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
  Pick<Session, 'venueId' | 'gameType' | 'stakes' | 'buyIn' | 'cashOut' | 'startedAt' | 'endedAt' | 'notes'>
>;
export type HandPatch = Partial<
  Pick<Hand, 'holeCards' | 'position' | 'note' | 'tags' | 'amount' | 'at'>
>;

export interface Repository {
  /** Create tables / open the database. Safe to call repeatedly. */
  init(): Promise<void>;

  listVenues(): Promise<Venue[]>;
  getVenue(id: string): Promise<Venue | null>;
  createVenue(input: NewVenue): Promise<Venue>;
  updateVenue(id: string, patch: VenuePatch): Promise<Venue>;
  /** Rejects if any session still references the venue. */
  deleteVenue(id: string): Promise<void>;

  listSessions(filter?: SessionFilter): Promise<SessionWithChildren[]>;
  getSession(id: string): Promise<SessionWithChildren | null>;
  /** The single running session, if one exists. Log allows only one at a time. */
  getActiveSession(): Promise<SessionWithChildren | null>;
  createSession(input: NewSession): Promise<Session>;
  /**
   * Create many sessions in one transaction — the session-summary import.
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
  /** Cascades to the session's rebuys, hands and mood entries. */
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

  /** Wipes user data. Used by the dev seeder and the settings reset. */
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
