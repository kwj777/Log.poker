/**
 * SQLite schema and migrations.
 *
 * Versioned through `PRAGMA user_version`: each migration is applied in order
 * and the pragma is bumped, so an app updated months from now walks a device
 * forward from whatever version it is on. Adding a migration means appending to
 * `MIGRATIONS` — never editing an entry that has shipped.
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
