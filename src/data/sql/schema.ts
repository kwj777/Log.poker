/**
 * SQLite schema and migrations.
 *
 * Versioned through `PRAGMA user_version`: each migration is applied in order
 * and the pragma is bumped, so an app updated months from now walks a device
 * forward from whatever version it is on. Adding a migration means appending to
 * `MIGRATIONS` -- never editing an entry that has shipped.
 */

import type { SqlDriver } from './driver';

export interface Migration {
  version: number;
  statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS venues (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        is_home_game INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        venue_id TEXT NOT NULL REFERENCES venues(id),
        game_type TEXT NOT NULL,
        small_blind INTEGER NOT NULL,
        big_blind INTEGER NOT NULL,
        ante INTEGER,
        currency TEXT NOT NULL,
        buy_in INTEGER NOT NULL,
        cash_out INTEGER,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rebuys (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS hands (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        hole_cards TEXT,
        position TEXT,
        note TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        amount INTEGER,
        at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS mood_entries (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        score INTEGER NOT NULL,
        at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_venue ON sessions(venue_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_ended_at ON sessions(ended_at)`,
      `CREATE INDEX IF NOT EXISTS idx_rebuys_session ON rebuys(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hands_session ON hands(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hands_at ON hands(at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_mood_session ON mood_entries(session_id)`,
    ],
  },
  {
    // Session-summary import. The index is UNIQUE so a re-import cannot double a
    // bankroll even if the check above it is ever bypassed; SQLite treats NULLs
    // as distinct, so the column stays free for every hand-logged session.
    version: 2,
    statements: [
      `ALTER TABLE sessions ADD COLUMN import_key TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_import_key ON sessions(import_key)`,
    ],
  },
  {
    // Tournaments. Existing rows are cash games, which is what the default says.
    //
    // `small_blind` and `big_blind` stay NOT NULL: SQLite cannot relax a column
    // constraint without rebuilding the table, and rebuilding one that three
    // other tables hold foreign keys into is a great deal of risk for a column
    // that has a perfectly good sentinel available. A session with no stakes
    // stores 0/0, which is not a poker game anybody has ever played, and
    // `toSession` maps it back to null. Same trick as `OPEN_SESSION_ENDED_AT`
    // on the IndexedDB side, for the same reason.
    version: 3,
    statements: [
      `ALTER TABLE sessions ADD COLUMN format TEXT NOT NULL DEFAULT 'cash'`,
      `ALTER TABLE sessions ADD COLUMN fee INTEGER`,
      `ALTER TABLE sessions ADD COLUMN entrants INTEGER`,
      `ALTER TABLE sessions ADD COLUMN finish_position INTEGER`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_format ON sessions(format)`,
    ],
  },
  {
    // Tombstones, and the reason for them is not local at all.
    //
    // A deleted row stops being a removed row and becomes one carrying
    // `deleted_at`. Locally that is strictly worse; across two devices it is
    // the only thing that works, because a row that is absent because somebody
    // deleted it and a row that is absent because this device has not been told
    // about it yet are the same absence, and any merge that unions rows
    // resurrects the first kind. Delete a mis-entered session on the phone,
    // watch it come back from the laptop. See SYNC.md.
    //
    // No index on the new column. It is null on almost every row, so on its own
    // it narrows nothing, and every query that filters on it is already ordered
    // by an indexed column. A composite index would help and is not worth
    // carrying before there is a sync to profile it against.
    version: 4,
    statements: [
      `ALTER TABLE venues ADD COLUMN deleted_at INTEGER`,
      `ALTER TABLE sessions ADD COLUMN deleted_at INTEGER`,
      `ALTER TABLE rebuys ADD COLUMN deleted_at INTEGER`,
      `ALTER TABLE hands ADD COLUMN deleted_at INTEGER`,
      `ALTER TABLE mood_entries ADD COLUMN deleted_at INTEGER`,
    ],
  },
  {
    // The board, which a hand had nowhere to put.
    //
    // Three of the four tags a hand can carry are claims about a runout -- bad
    // beat, cooler, bluff -- and until this column the record could not show
    // the runout they were claims about. Optional, and null on every row
    // written before it existed, which is what a hand logged without one looks
    // like anyway: there is no migration to do beyond making the column exist.
    //
    // No index, for the reason the tombstone column above gives: it is null on
    // most rows and nothing queries on it.
    version: 5,
    statements: [`ALTER TABLE hands ADD COLUMN board TEXT`],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export const migrate = async (driver: SqlDriver): Promise<void> => {
  await driver.execute('PRAGMA foreign_keys = ON');
  const rows = await driver.all<{ user_version: number }>('PRAGMA user_version');
  const current = rows[0]?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    for (const statement of migration.statements) {
      await driver.execute(statement);
    }
    // PRAGMA does not accept bound parameters; the value is an integer literal
    // from this file, never user input.
    await driver.execute(`PRAGMA user_version = ${migration.version}`);
  }
};
