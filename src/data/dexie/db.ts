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

import { DEFAULT_CURRENCY } from '../../domain/money';
import type {
  GameType,
  HandTag,
  MoodPhase,
  MoodScore,
  Position,
  SessionFormat,
  Stakes,
} from '../../domain/types';

export const DATABASE_NAME = 'log-poker';

/** Sentinel for "no end time" -- see the note above about indexing nulls. */
export const OPEN_SESSION_ENDED_AT = 0;

/**
 * Tombstones, and why they added no version below.
 *
 * `deletedAt` is a property rather than an index, and IndexedDB stores whole
 * objects, so adding one needs no migration: a record written by an earlier
 * build simply has no `deletedAt` and reads as live. That is the one place this
 * file and the SQLite schema genuinely differ. The tombstone column there is
 * migration 4, added by an `ALTER TABLE`, while the versions below stop at the
 * 3 that tournaments needed, because that one changed indexed keys and this
 * does not.
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
  format: SessionFormat;
  gameType: GameType;
  /** Null for a tournament, and for a cash session with no blinds recorded. */
  stakes: Stakes | null;
  currency: string;
  buyIn: number;
  fee: number | null;
  cashOut: number | null;
  entrants: number | null;
  finishPosition: number | null;
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

/** A v1/v2 session as it sits on disk before the v3 upgrade rewrites it. */
type LegacySessionRecord = Omit<SessionRecord, 'stakes'> & {
  stakes?: (Stakes & { currency?: string }) | null;
};

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
  // v3 adds tournaments, and moves the currency out of the nested stakes object
  // onto the record -- a tournament has no stakes to hang it off. Everything
  // stored before this version is a cash game, which is what the upgrade writes.
  db.version(3)
    .stores({
      venues: 'id, name, createdAt',
      sessions: 'id, venueId, format, gameType, startedAt, endedAt, &importKey',
      rebuys: 'id, sessionId, at',
      hands: 'id, sessionId, at',
      moodEntries: 'id, sessionId, phase, at',
    })
    .upgrade((tx) =>
      tx
        .table<LegacySessionRecord>('sessions')
        .toCollection()
        .modify((record) => {
          const legacy = record.stakes;
          record.format = 'cash';
          record.currency = legacy?.currency ?? DEFAULT_CURRENCY;
          record.fee = null;
          record.entrants = null;
          record.finishPosition = null;
          // The importer wrote 0/0 for a session whose blinds it could not read.
          // Those become null here, which is what they always meant.
          record.stakes =
            legacy && (legacy.smallBlind !== 0 || legacy.bigBlind !== 0)
              ? {
                  smallBlind: legacy.smallBlind,
                  bigBlind: legacy.bigBlind,
                  ...(legacy.ante == null ? {} : { ante: legacy.ante }),
                }
              : null;
        }),
    );
  return db;
};
