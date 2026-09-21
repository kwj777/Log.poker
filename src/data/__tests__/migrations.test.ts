/**
 * Upgrading a database that already has a player's history in it.
 *
 * The contract suite opens both engines at the current version on an empty
 * store, which never exercises an upgrade. That is the one path where a mistake
 * is unrecoverable: a fresh install that reads wrong can be reinstalled, and a
 * migration that drops a year of sessions cannot be undone. So each engine is
 * built here at the *previous* version, filled with rows in the shape that
 * version wrote, and then opened by the shipping code.
 */

import 'fake-indexeddb/auto';

import { Dexie } from 'dexie';

import { createDatabase } from '../dexie/db';
import { DexieRepository } from '../dexie/DexieRepository';
import { SqlRepository } from '../sql/SqlRepository';
import { LATEST_VERSION, MIGRATIONS } from '../sql/schema';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

const T0 = 1_700_000_000_000;

describe('SQLite: a v2 database upgraded to the current version', () => {
  let driver: NodeSqliteDriver;
  let repository: SqlRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');

    // Build the database exactly as the shipped v2 left it.
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 2)) {
      for (const statement of migration.statements) await driver.execute(statement);
    }
    await driver.execute('PRAGMA user_version = 2');

    await driver.run(
      `INSERT INTO venues (id, name, is_home_game, created_at, updated_at)
       VALUES ('v1', 'Aria', 0, ?, ?)`,
      [T0, T0],
    );
    // A cash game with real blinds, as the new-session screen wrote them.
    await driver.run(
      `INSERT INTO sessions (id, venue_id, game_type, small_blind, big_blind, ante, currency,
         buy_in, cash_out, started_at, ended_at, notes, import_key, created_at, updated_at)
       VALUES ('s1', 'v1', 'NLHE', 100, 200, NULL, 'USD', 30000, 45000, ?, ?, NULL, NULL, ?, ?)`,
      [T0, T0 + 3_600_000, T0, T0],
    );
    // A session the importer wrote with 0/0 because it could not read the stakes.
    await driver.run(
      `INSERT INTO sessions (id, venue_id, game_type, small_blind, big_blind, ante, currency,
         buy_in, cash_out, started_at, ended_at, notes, import_key, created_at, updated_at)
       VALUES ('s2', 'v1', 'NLHE', 0, 0, NULL, 'EUR', 0, 12000, ?, ?, NULL, 'csv|1', ?, ?)`,
      [T0, T0, T0, T0],
    );

    repository = new SqlRepository(driver);
    await repository.init();
  });

  afterEach(async () => {
    await driver.close();
  });

  it('walks the database to the current version', async () => {
    // Read from the schema rather than written down again, so that adding a
    // migration cannot leave this quietly asserting an old version.
    const [row] = await driver.all<{ user_version: number }>('PRAGMA user_version');
    expect(row.user_version).toBe(LATEST_VERSION);
  });

  it('reads everything already stored as live rather than as deleted', async () => {
    // The tombstone column decides whether a row is visible at all, so a
    // migration landing it as anything but null would hide a player's entire
    // history behind an upgrade, with nothing erroring.
    const rows = await driver.all<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM sessions UNION ALL SELECT deleted_at FROM venues`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.deleted_at).toBeNull();
  });

  it('reports them all as changed since the beginning of time, and none as gone', async () => {
    const { sessions, venues } = await repository.listChangedSince(0);
    expect(sessions.map((change) => change.record.id).sort()).toEqual(['s1', 's2']);
    for (const change of [...sessions, ...venues]) expect(change.deletedAt).toBeNull();
  });

  it('can tombstone a migrated session, which frees its import key', async () => {
    await repository.deleteSession('s2');
    expect(await repository.listSessions()).toHaveLength(1);
    expect(await repository.listImportKeys()).toEqual([]);
  });

  it('keeps every session', async () => {
    expect(await repository.listSessions()).toHaveLength(2);
  });

  it('reads records written without the tombstone property as live', async () => {
    // The asymmetry with SQLite: no migration added anything here, so these
    // rows carry no `deletedAt` at all rather than a null one, and absent has
    // to mean live or an upgrade hides the whole log.
    const { sessions, venues } = await repository.listChangedSince(0);
    expect(sessions.map((change) => change.record.id).sort()).toEqual(['s1', 's2']);
    for (const change of [...sessions, ...venues]) expect(change.deletedAt).toBeNull();
  });

  it('can tombstone a migrated session, which frees its import key', async () => {
    await repository.deleteSession('s2');
    expect(await repository.listSessions()).toHaveLength(1);
    expect(await repository.listImportKeys()).toEqual([]);
  });

  it('reads existing sessions as cash games', async () => {
    const session = await repository.getSession('s1');
    expect(session?.format).toBe('cash');
    expect(session?.fee).toBeNull();
    expect(session?.entrants).toBeNull();
    expect(session?.finishPosition).toBeNull();
  });

  it('keeps the stakes and lifts the currency onto the session', async () => {
    const session = await repository.getSession('s1');
    expect(session?.stakes).toEqual({ smallBlind: 100, bigBlind: 200 });
    expect(session?.currency).toBe('USD');
  });

  it('reads a 0/0 session as having no stakes at all', async () => {
    const session = await repository.getSession('s2');
    expect(session?.stakes).toBeNull();
    expect(session?.currency).toBe('EUR');
  });

  it('keeps the import keys, so a re-import still skips what it has', async () => {
    expect(await repository.listImportKeys()).toEqual(['csv|1']);
  });

  it('can write a tournament afterwards', async () => {
    const created = await repository.createSession({
      venueId: 'v1',
      format: 'tournament',
      gameType: 'NLHE',
      buyIn: 10_000,
      fee: 1_000,
      entrants: 210,
      finishPosition: 12,
      startedAt: T0,
    });
    const loaded = await repository.getSession(created.id);
    expect(loaded).toMatchObject({
      format: 'tournament',
      stakes: null,
      fee: 1_000,
      entrants: 210,
      finishPosition: 12,
    });
  });
});

describe('IndexedDB: a v2 database upgraded to the current version', () => {
  const name = 'log-poker-upgrade-test';
  let repository: DexieRepository;
  let db: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    // A hand-built v2 database: the stores as they were, and the currency still
    // living inside the nested stakes object.
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      venues: 'id, name, createdAt',
      sessions: 'id, venueId, gameType, startedAt, endedAt',
      rebuys: 'id, sessionId, at',
      hands: 'id, sessionId, at',
      moodEntries: 'id, sessionId, phase, at',
    });
    legacy.version(2).stores({
      venues: 'id, name, createdAt',
      sessions: 'id, venueId, gameType, startedAt, endedAt, &importKey',
      rebuys: 'id, sessionId, at',
      hands: 'id, sessionId, at',
      moodEntries: 'id, sessionId, phase, at',
    });
    await legacy.open();
    await legacy.table('venues').add({
      id: 'v1',
      name: 'Aria',
      isHomeGame: 0,
      createdAt: T0,
      updatedAt: T0,
    });
    await legacy.table('sessions').bulkAdd([
      {
        id: 's1',
        venueId: 'v1',
        gameType: 'NLHE',
        stakes: { smallBlind: 100, bigBlind: 200, currency: 'USD' },
        buyIn: 30_000,
        cashOut: 45_000,
        startedAt: T0,
        endedAt: T0 + 3_600_000,
        notes: null,
        createdAt: T0,
        updatedAt: T0,
      },
      {
        id: 's2',
        venueId: 'v1',
        gameType: 'NLHE',
        stakes: { smallBlind: 0, bigBlind: 0, currency: 'EUR' },
        buyIn: 0,
        cashOut: 12_000,
        startedAt: T0,
        endedAt: T0,
        notes: null,
        importKey: 'csv|1',
        createdAt: T0,
        updatedAt: T0,
      },
    ]);
    legacy.close();

    db = createDatabase(name);
    repository = new DexieRepository(db);
    await repository.init();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('keeps every session', async () => {
    expect(await repository.listSessions()).toHaveLength(2);
  });

  it('reads records written without the tombstone property as live', async () => {
    // The asymmetry with SQLite: no migration added anything here, so these
    // rows carry no `deletedAt` at all rather than a null one, and absent has
    // to mean live or an upgrade hides the whole log.
    const { sessions, venues } = await repository.listChangedSince(0);
    expect(sessions.map((change) => change.record.id).sort()).toEqual(['s1', 's2']);
    for (const change of [...sessions, ...venues]) expect(change.deletedAt).toBeNull();
  });

  it('can tombstone a migrated session, which frees its import key', async () => {
    await repository.deleteSession('s2');
    expect(await repository.listSessions()).toHaveLength(1);
    expect(await repository.listImportKeys()).toEqual([]);
  });

  it('reads existing sessions as cash games', async () => {
    const session = await repository.getSession('s1');
    expect(session?.format).toBe('cash');
    expect(session?.fee).toBeNull();
  });

  it('moves the currency out of the stakes object and onto the session', async () => {
    const session = await repository.getSession('s1');
    expect(session?.stakes).toEqual({ smallBlind: 100, bigBlind: 200 });
    expect(session?.currency).toBe('USD');
  });

  it('reads a 0/0 session as having no stakes at all', async () => {
    const session = await repository.getSession('s2');
    expect(session?.stakes).toBeNull();
    expect(session?.currency).toBe('EUR');
  });

  it('keeps the import keys, so a re-import still skips what it has', async () => {
    expect(await repository.listImportKeys()).toEqual(['csv|1']);
  });

  it('can write a tournament afterwards', async () => {
    const created = await repository.createSession({
      venueId: 'v1',
      format: 'tournament',
      gameType: 'NLHE',
      buyIn: 10_000,
      fee: 1_000,
      entrants: 210,
      finishPosition: 12,
      startedAt: T0,
    });
    const loaded = await repository.getSession(created.id);
    expect(loaded).toMatchObject({
      format: 'tournament',
      stakes: null,
      fee: 1_000,
      entrants: 210,
      finishPosition: 12,
    });
  });
});

describe('the read that runs after every write', () => {
  let driver: NodeSqliteDriver;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) await driver.execute(statement);
    }
  });

  afterEach(() => driver.close());

  it('goes to an index on every table it asks, rather than reading all of them', async () => {
    // `listChangedSince` asks five tables `updated_at > ?` after every write,
    // and answers with nothing nearly every time. Unindexed, each of those was
    // a scan of a whole table and a sort of everything in it, and the cost
    // went up with the size of the log rather than the size of the answer.
    //
    // The query planner is the only thing that can say which of the two is
    // happening. It says SCAN for the one and SEARCH ... USING INDEX for the
    // other, on the same SQL.
    for (const table of ['venues', 'sessions', 'rebuys', 'hands', 'mood_entries']) {
      const plan = await driver.all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT * FROM ${table} WHERE updated_at > 0 ORDER BY updated_at ASC`,
      );
      const detail = plan.map((row) => row.detail).join(' ');
      expect(detail).toContain('USING INDEX');
      expect(detail).not.toContain('SCAN');
    }
  });
});

describe('the migration list', () => {
  it('is append only, and every shipped version still says what it said', () => {
    // A device that ran version 3 last month will never run it again, so
    // editing one changes nothing there and everything on a fresh install, and
    // the two stop agreeing without anything erroring.
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(MIGRATIONS[1].statements).toEqual([
      'ALTER TABLE sessions ADD COLUMN import_key TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_import_key ON sessions(import_key)',
    ]);
  });

  it('adds the board to the hands and to nothing else', () => {
    expect(MIGRATIONS[4].statements).toEqual(['ALTER TABLE hands ADD COLUMN board TEXT']);
  });

  it('gives the preferences no tombstone column, because they do not sync', () => {
    const [statement, ...rest] = MIGRATIONS[5].statements;
    expect(rest).toEqual([]);
    expect(statement).toContain('CREATE TABLE IF NOT EXISTS preferences');
    // The day this table syncs it needs one, and this line is what asks.
    expect(statement).not.toContain('deleted_at');
  });

  it('puts the tombstone column on every table that syncs', () => {
    const tombstones = MIGRATIONS[3].statements;
    expect(tombstones).toHaveLength(5);
    for (const table of ['venues', 'sessions', 'rebuys', 'hands', 'mood_entries']) {
      expect(tombstones).toContain(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER`);
    }
  });

  it('and an updated_at index on the same five, because that is what sync reads on', () => {
    // The tables that sync are the tables `listChangedSince` asks about, and
    // it asks one question: `updated_at > ?`. The two lists have to be the
    // same list, and `preferences` is out of both for the same reason.
    const indexes = MIGRATIONS[6].statements;
    expect(indexes).toHaveLength(5);
    for (const table of ['venues', 'sessions', 'rebuys', 'hands', 'mood_entries']) {
      expect(indexes.some((sql) => sql.includes(`ON ${table}(updated_at)`))).toBe(true);
    }
    expect(indexes.some((sql) => sql.includes('preferences'))).toBe(false);
  });
});

describe('a hand written before there was anywhere to put the board', () => {
  let driver: NodeSqliteDriver;
  let repository: SqlRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    // The database exactly as the shipped v4 left it: tombstones, no board.
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 4)) {
      for (const statement of migration.statements) await driver.execute(statement);
    }
    await driver.execute('PRAGMA user_version = 4');

    await driver.run(
      `INSERT INTO venues (id, name, is_home_game, created_at, updated_at)
       VALUES ('v1', 'Aria', 0, ?, ?)`,
      [T0, T0],
    );
    await driver.run(
      `INSERT INTO sessions (id, venue_id, format, game_type, small_blind, big_blind, ante,
         currency, buy_in, fee, cash_out, entrants, finish_position, started_at, ended_at,
         notes, import_key, created_at, updated_at)
       VALUES ('s1', 'v1', 'cash', 'NLHE', 100, 200, NULL, 'USD', 30000, NULL, 45000, NULL,
         NULL, ?, ?, NULL, NULL, ?, ?)`,
      [T0, T0 + 3_600_000, T0, T0],
    );
    await driver.run(
      `INSERT INTO hands (id, session_id, hole_cards, position, note, tags, amount, at,
         created_at, updated_at)
       VALUES ('h1', 's1', 'AsKd', 'BTN', 'Ran into aces', '["cooler"]', -25000, ?, ?, ?)`,
      [T0, T0, T0],
    );

    repository = new SqlRepository(driver);
    await repository.init();
  });

  afterEach(async () => {
    await driver.close();
  });

  it('walks to the current version', async () => {
    const [row] = await driver.all<{ user_version: number }>('PRAGMA user_version');
    expect(row.user_version).toBe(LATEST_VERSION);
  });

  it('reads as a hand logged without a board, which is what it was', async () => {
    const hand = await repository.getHand('h1');
    expect(hand?.board).toBeNull();
    // And nothing else about it moved.
    expect(hand?.holeCards).toBe('AsKd');
    expect(hand?.tags).toEqual(['cooler']);
    expect(hand?.amount).toBe(-25_000);
  });

  it('and takes one afterwards, which is the ordinary way round', async () => {
    // The runout is not known when the hand is logged at the table.
    await repository.updateHand('h1', { board: '7c2sKhAd9d' });
    expect((await repository.getHand('h1'))?.board).toBe('7c2sKhAd9d');
  });
});

describe('an upgrade that was interrupted halfway through', () => {
  let driver: NodeSqliteDriver;

  afterEach(async () => {
    await driver.close();
  });

  /** A v3 database, which is the version migration 4 upgrades from. */
  const atVersionThree = async (): Promise<NodeSqliteDriver> => {
    const fresh = new NodeSqliteDriver(':memory:');
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 3)) {
      for (const statement of migration.statements) await fresh.execute(statement);
    }
    await fresh.execute('PRAGMA user_version = 3');
    await fresh.run(
      `INSERT INTO venues (id, name, is_home_game, created_at, updated_at)
       VALUES ('v1', 'Aria', 0, ?, ?)`,
      [T0, T0],
    );
    await fresh.run(
      `INSERT INTO sessions (id, venue_id, format, game_type, small_blind, big_blind, ante,
         currency, buy_in, fee, cash_out, entrants, finish_position, started_at, ended_at,
         notes, import_key, created_at, updated_at)
       VALUES ('s1', 'v1', 'cash', 'NLHE', 100, 200, NULL, 'USD', 30000, NULL, 45000, NULL,
         NULL, ?, ?, NULL, NULL, ?, ?)`,
      [T0, T0 + 3_600_000, T0, T0],
    );
    return fresh;
  };

  it('leaves nothing behind when the process stops between two statements', async () => {
    driver = await atVersionThree();

    // Migration 4 is five `ALTER TABLE ... ADD COLUMN`s. The app is killed
    // after the second: a cold start upgrade is exactly the moment somebody
    // backgrounds the app, and the device can also simply run out of storage.
    const killed = MIGRATIONS.find((entry) => entry.version === 4);
    if (killed === undefined) throw new Error('migration 4 has gone missing');
    await expect(
      driver.transaction(async () => {
        await driver.execute(killed.statements[0]);
        await driver.execute(killed.statements[1]);
        throw new Error('app killed');
      }),
    ).rejects.toThrow('app killed');

    // The columns that landed are rolled back with the ones that did not, so
    // the database is still honestly on version 3 rather than half on 4.
    const [row] = await driver.all<{ user_version: number }>('PRAGMA user_version');
    expect(row.user_version).toBe(3);
    const columns = await driver.all<{ name: string }>(`PRAGMA table_info(venues)`);
    expect(columns.map((column) => column.name)).not.toContain('deleted_at');
  });

  it('opens on the next launch and finishes the job', async () => {
    driver = await atVersionThree();
    const killed = MIGRATIONS.find((entry) => entry.version === 4);
    if (killed === undefined) throw new Error('migration 4 has gone missing');
    await driver
      .transaction(async () => {
        await driver.execute(killed.statements[0]);
        await driver.execute(killed.statements[1]);
        throw new Error('app killed');
      })
      .catch(() => undefined);

    // The whole point. Before the migration ran in a transaction this replay
    // threw `duplicate column name: deleted_at` here and on every launch
    // after it, and the player's history was intact and unreachable for good.
    const repository = new SqlRepository(driver);
    await expect(repository.init()).resolves.toBeUndefined();

    const [row] = await driver.all<{ user_version: number }>('PRAGMA user_version');
    expect(row.user_version).toBe(LATEST_VERSION);
    expect(await repository.listSessions()).toHaveLength(1);
  });
});
