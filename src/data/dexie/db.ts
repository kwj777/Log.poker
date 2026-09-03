/**
 * Dexie (IndexedDB) database definition -- the web implementation.
 *
 * IndexedDB rather than localStorage because session history is relational and
 * grows for years: localStorage is a synchronous ~5MB string store with no
 * indexes, and querying it would mean deserializing every session on every read.
 *
 * Rows are stored in the same shape as the domain records, with two exceptions
 * forced by IndexedDB's index rules: booleans and nulls are not indexable, so
 * `isHomeGame` is stored as 0/1 and an unfinished session's `endedAt` is stored
 * as `0` rather than `null`. Both are translated at the repository boundary, so
 * callers never see the encoding.
 */

import Dexie, { type EntityTable } from 'dexie';

import type { GameType, HandTag, MoodPhase, MoodScore, Position, Stakes } from '../../domain/types';

export const DATABASE_NAME = 'log-poker';

/** Sentinel for "no end time" -- see the note above about indexing nulls. */
export const OPEN_SESSION_ENDED_AT = 0;

/**
 * Tombstones, and why there is no version 3 below.
 *
 * `deletedAt` is a property rather than an index, and IndexedDB stores whole
 * objects, so adding one needs no migration: a record written by an earlier
 * build simply has no `deletedAt` and reads as live. That is the one place this
 * file and the SQLite schema genuinely differ, since a column there has to be
 * added by an `ALTER TABLE` in a numbered migration.
 *
 * It stays out of the indexes on purpose. Every query that filters on it is
 * already ordered by an indexed key, and indexing a property that is absent on
 * almost every record buys nothing. See SYNC.md.
 */
export type DeletedAt = number | null | undefined;

export interface VenueRecord {
  id: string;
  name: string;
  isHomeGame: 0 | 1;
  createdAt: number;
  updatedAt: number;
  /** Absent or null while the record is live. See the note above. */
  deletedAt?: DeletedAt;
}

export interface SessionRecord {
  id: string;
  venueId: string;
  gameType: GameType;
  stakes: Stakes;
  buyIn: number;
  cashOut: number | null;
  startedAt: number;
  /** `OPEN_SESSION_ENDED_AT` while the session is running. */
  endedAt: number;
  notes: string | null;
  /**
   * Absent -- not null -- for a session logged in the app.
   *
   * IndexedDB leaves a record out of an index entirely when the key path does
   * not resolve, which is the only way a *unique* index can coexist with a
   * column that is empty on almost every row. Storing `null` here instead would
   * put every hand-logged session into the index under the same key and the
   * second one would be rejected.
   */
  importKey?: string;
  createdAt: number;
  updatedAt: number;
  /** Absent or null while the record is live. See the note above. */
  deletedAt?: DeletedAt;
}

export interface RebuyRecord {
  id: string;
  sessionId: string;
  amount: number;
  at: number;
  createdAt: number;
  updatedAt: number;
  /** Absent or null while the record is live. See the note above. */
  deletedAt?: DeletedAt;
}

export interface HandRecord {
  id: string;
  sessionId: string;
  holeCards: string | null;
  position: Position | null;
  note: string | null;
  tags: HandTag[];
  amount: number | null;
  at: number;
  createdAt: number;
  updatedAt: number;
  /** Absent or null while the record is live. See the note above. */
  deletedAt?: DeletedAt;
}

export interface MoodRecord {
  id: string;
  sessionId: string;
  phase: MoodPhase;
  score: MoodScore;
  at: number;
  createdAt: number;
  updatedAt: number;
  /** Absent or null while the record is live. See the note above. */
  deletedAt?: DeletedAt;
}

export type LogDatabase = Dexie & {
  venues: EntityTable<VenueRecord, 'id'>;
  sessions: EntityTable<SessionRecord, 'id'>;
  rebuys: EntityTable<RebuyRecord, 'id'>;
  hands: EntityTable<HandRecord, 'id'>;
  moodEntries: EntityTable<MoodRecord, 'id'>;
};

/**
 * Dexie versions are additive in exactly the same way the SQLite migrations are:
 * bump the number and declare the new stores; never rewrite a shipped version.
 */
export const createDatabase = (name: string = DATABASE_NAME): LogDatabase => {
  const db = new Dexie(name) as LogDatabase;
  db.version(1).stores({
    venues: 'id, name, createdAt',
    sessions: 'id, venueId, gameType, startedAt, endedAt',
    rebuys: 'id, sessionId, at',
    hands: 'id, sessionId, at',
    moodEntries: 'id, sessionId, phase, at',
  });
  // v2 adds the session-summary import: `&importKey` is unique, so a re-import
  // cannot double a bankroll. Records written before this version have no
  // `importKey` property and so are simply not in the index.
  db.version(2).stores({
    venues: 'id, name, createdAt',
    sessions: 'id, venueId, gameType, startedAt, endedAt, &importKey',
    rebuys: 'id, sessionId, at',
    hands: 'id, sessionId, at',
    moodEntries: 'id, sessionId, phase, at',
  });
  return db;
};
