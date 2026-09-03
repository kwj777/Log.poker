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
import { MIGRATIONS } from '../sql/schema';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

const T0 = 1_700_000_000_000;

describe('SQLite: a v2 database upgraded to v3', () => {
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
    const [row] = await driver.all<{ user_version: number }>('PRAGMA user_version');
    expect(row.user_version).toBe(3);
  });

  it('keeps every session', async () => {
    expect(await repository.listSessions()).toHaveLength(2);
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

describe('IndexedDB: a v2 database upgraded to v3', () => {
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
