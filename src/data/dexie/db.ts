/**
 * Dexie (IndexedDB) database definition -- the web implementation.
 *
 * IndexedDB rather than localStorage because session history is relational and
 * grows for years: localStorage is a synchronous ~5MB string store with no
 * indexes, and querying it would mean deserializing every session on every read.
 *
 * Rows are close to the domain records and not identical, and the differences
 * are all translated at the repository boundary, so callers never see any of
 * them:
 *
 * - `isHomeGame` is 0/1 and an unfinished session's `endedAt` is `0` rather
 *   than `null`, because booleans and nulls are not indexable.
 * - `importKey` is *absent* rather than null on a session logged in the app,
 *   which is a different index rule and the one with teeth. See the note on
 *   `SessionRecord.importKey`.
 * - `deletedAt` is a stored column that no domain type has, and
 *   `Venue.sessionCount` is a domain field that no column holds.
 *
 * Listed rather than counted. This said "two exceptions" while `importKey`
 * was the third, and a count is the part of a list that goes stale without
 * anything to notice.
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
 * build simply has no `deletedAt` and reads as live. SQLite has to be told --
 * the tombstone column there is migration 4, five `ALTER TABLE`s -- and that
 * asymmetry is why the two schemas count their versions differently. It has
 * happened twice: `board` is the other, migration 5 there and a property here
 * that needed no version at all.
 *
 * The ladder below does not stop where the property did, though. Indexed keys
 * still need a version whatever the reason for them, and three of the six are
 * about keys rather than columns: v4 adds the `preferences` store, v5 the
 * `updatedAt` index that every sync reads on, and v6 the `deletedAt` index on
 * the hands. This said the versions stopped at the 3 that tournaments needed,
 * which was true when it was written and stopped being true three versions
 * ago; the ladder is pinned in `migrations.test.ts` now, so the next one
 * cannot pass here in silence.
 *
 * It stays out of the indexes almost everywhere, on purpose. Every query that
 * filters *to* live records is already ordered by an indexed key, and an index
 * cannot help those: what they need is the records that are **not** in it.
 *
 * `hands` is the exception, and it is the same fact read the other way round.
 * Nulls are not indexable, so an index on `deletedAt` holds the tombstones and
 * nothing else -- on a table where almost every record is live, that is a very
 * short list. Counting the live hands is then two counts of keys rather than a
 * cursor over every hand in the log. See the note at `countHands`, and v6
 * below. See SYNC.md.
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
  /** Absent on a record written before the field existed. Not indexed. */
  board?: string | null;
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

/**
 * One of the player's own settings, as a row.
 *
 * Key and value rather than a store with a column per setting, so the second
 * one is a row rather than a version bump. The value is whatever was stored,
 * which IndexedDB keeps structured -- unlike the SQLite side, which has to
 * JSON it through a text column. The reader validates either way.
 */
export interface PreferenceRecord {
  key: string;
  value: unknown;
}

export type LogDatabase = Dexie & {
  venues: EntityTable<VenueRecord, 'id'>;
  sessions: EntityTable<SessionRecord, 'id'>;
  rebuys: EntityTable<RebuyRecord, 'id'>;
  hands: EntityTable<HandRecord, 'id'>;
  moodEntries: EntityTable<MoodRecord, 'id'>;
  preferences: EntityTable<PreferenceRecord, 'key'>;
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
  // v4 adds the player's own settings, which are not part of the log and do
  // not sync. Nothing to upgrade: a device that has never had one reads the
  // absence as unasked, which is what it is.
  db.version(4).stores({
    venues: 'id, name, createdAt',
    sessions: 'id, venueId, format, gameType, startedAt, endedAt, &importKey',
    rebuys: 'id, sessionId, at',
    hands: 'id, sessionId, at',
    moodEntries: 'id, sessionId, phase, at',
    preferences: 'key',
  });
  // v5 indexes the column every sync reads on. `listChangedSince` runs after
  // every write and asks one question of five tables -- `updatedAt > since`,
  // in that order -- and without an index the only way to answer it was to
  // read every row of every table into memory and filter in JavaScript. On
  // this engine that is a structured clone per record, to answer with nothing
  // nearly every time.
  //
  // Nothing to upgrade: Dexie builds the index from the rows already there,
  // and `updatedAt` is on every record of every syncing table by construction.
  // `preferences` gains nothing because it has no `updatedAt` and does not
  // sync; `deletedAt` stays out for the reason `schema.ts` gives at its
  // version 4, which is that it is null on almost every row.
  db.version(5).stores({
    venues: 'id, name, createdAt, updatedAt',
    sessions: 'id, venueId, format, gameType, startedAt, endedAt, updatedAt, &importKey',
    rebuys: 'id, sessionId, at, updatedAt',
    hands: 'id, sessionId, at, updatedAt',
    moodEntries: 'id, sessionId, phase, at, updatedAt',
    preferences: 'key',
  });
  // v6 indexes `deletedAt` on the hands, and on nothing else.
  //
  // Not the reasoning at the top of this file reversed, but that reasoning
  // applied where it points the other way. An index on a property that is null
  // on almost every record is useless for finding the records where it *is*
  // null, which is what every live-record query wants. It is exactly right for
  // finding the handful where it is not -- and the count of live hands is the
  // total minus that handful, which is two counts of keys instead of a cursor
  // over every hand in the log. `countHands` runs on every refresh, after every
  // hand written at the table and after every sync pull.
  //
  // Hands only, because hands are the one table with a count. Adding it to the
  // other four would cost a write per tombstone to answer a question nobody
  // asks.
  db.version(6).stores({
    venues: 'id, name, createdAt, updatedAt',
    sessions: 'id, venueId, format, gameType, startedAt, endedAt, updatedAt, &importKey',
    rebuys: 'id, sessionId, at, updatedAt',
    hands: 'id, sessionId, at, updatedAt, deletedAt',
    moodEntries: 'id, sessionId, phase, at, updatedAt',
    preferences: 'key',
  });
  return db;
};
