/**
 * Walking an existing database forward, which is the half of a migration the
 * conformance suite cannot see.
 *
 * Every other test in here starts from an empty database at the latest version,
 * so it proves the schema is right and proves nothing at all about the upgrade
 * that gets a real device to it. The failure mode being guarded is specific and
 * silent: a player with three years of sessions installs an update, the
 * migration runs against rows that already exist, and either it throws on
 * launch or it quietly leaves the new column meaning something other than what
 * fresh installs mean by it.
 *
 * Tombstones make that worse than it usually is, because the new column decides
 * whether a row is visible. A migration that landed `deleted_at` as anything
 * other than null would hide a player's entire history behind an upgrade.
 */

import { SqlRepository } from '../sql/SqlRepository';
import { LATEST_VERSION, MIGRATIONS, migrate } from '../sql/schema';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

const T0 = 1_700_000_000_000;

/** A database at some earlier version, built by running only what shipped then. */
const databaseAtVersion = async (version: number): Promise<NodeSqliteDriver> => {
  const driver = new NodeSqliteDriver(':memory:');
  await driver.execute('PRAGMA foreign_keys = ON');
  for (const migration of MIGRATIONS) {
    if (migration.version > version) continue;
    for (const statement of migration.statements) await driver.execute(statement);
    await driver.execute(`PRAGMA user_version = ${migration.version}`);
  }
  return driver;
};

const userVersion = async (driver: NodeSqliteDriver): Promise<number> => {
  const rows = await driver.all<{ user_version: number }>('PRAGMA user_version');
  return rows[0].user_version;
};

describe('migrating a database that already has data in it', () => {
  let driver: NodeSqliteDriver;

  afterEach(async () => {
    await driver.close();
  });

  it('carries a version 2 database forward without losing a row', async () => {
    driver = await databaseAtVersion(2);
    await driver.run(
      `INSERT INTO venues (id, name, is_home_game, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ['venue-1', 'Bellagio', 0, T0, T0],
    );
    await driver.run(
      `INSERT INTO sessions (
         id, venue_id, game_type, small_blind, big_blind, ante, currency, buy_in,
         cash_out, started_at, ended_at, notes, import_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'session-1', 'venue-1', 'NLHE', 100, 200, null, 'USD', 30_000,
        47_500, T0, T0 + 3_600_000, 'Ran good early', null, T0, T0,
      ],
    );

    await migrate(driver);
    expect(await userVersion(driver)).toBe(LATEST_VERSION);

    // Read it back through the shipped class rather than through SQL, because
    // what matters is that the app can still see it.
    const repository = new SqlRepository(driver);
    await repository.init();
    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('session-1');
    expect(sessions[0].venue?.name).toBe('Bellagio');
  });

  it('lands the new column as null, so nothing already stored reads as deleted', async () => {
    driver = await databaseAtVersion(2);
    for (const id of ['venue-1', 'venue-2']) {
      await driver.run(
        `INSERT INTO venues (id, name, is_home_game, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [id, id, 0, T0, T0],
      );
    }

    await migrate(driver);

    const rows = await driver.all<{ deleted_at: number | null }>(`SELECT deleted_at FROM venues`);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.deleted_at).toBeNull();
  });

  it('leaves an already-current database alone', async () => {
    driver = await databaseAtVersion(LATEST_VERSION);
    await migrate(driver);
    expect(await userVersion(driver)).toBe(LATEST_VERSION);
  });

  it('runs from nothing to the latest version in one pass', async () => {
    driver = new NodeSqliteDriver(':memory:');
    expect(await userVersion(driver)).toBe(0);
    await migrate(driver);
    expect(await userVersion(driver)).toBe(LATEST_VERSION);
  });

  it('is safe to run twice, which is what every launch does', async () => {
    driver = new NodeSqliteDriver(':memory:');
    await migrate(driver);
    await migrate(driver);
    expect(await userVersion(driver)).toBe(LATEST_VERSION);
  });
});

describe('the migration list', () => {
  it('is append only, and version 2 still says what it said when it shipped', () => {
    // Appending is the whole contract: a device that ran version 2 last month
    // will never run it again, so editing it changes nothing there and
    // everything on a fresh install, and the two stop agreeing silently.
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3]);
    expect(MIGRATIONS[1].statements).toEqual([
      'ALTER TABLE sessions ADD COLUMN import_key TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_import_key ON sessions(import_key)',
    ]);
  });

  it('adds the tombstone column to every table that syncs', () => {
    const tombstones = MIGRATIONS[2].statements;
    expect(tombstones).toHaveLength(5);
    for (const table of ['venues', 'sessions', 'rebuys', 'hands', 'mood_entries']) {
      expect(tombstones).toContain(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER`);
    }
  });
});
