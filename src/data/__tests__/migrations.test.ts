/**
 * Upgrading a database that already has a player's history in it.
 *
 * The contract suite opens both engines at the current version on an empty
 * store, which never exercises an upgrade. That is the one path where a mistake
 * is unrecoverable: a fresh install that reads wrong can be reinstalled, and a
 * migration that drops a year of sessions cannot be undone. So each engine is
 * built here at an *older* version, filled with rows in the shape that version
 * wrote, and then opened by the shipping code.
 *
 * Older rather than previous, which is what this used to say. SQLite starts
 * from 2, 3, 4 and 6 against a head of 7, and Dexie from 2 and 5 against a
 * head of 6, because "the previous version" is a single start point and this
 * file has never had one. A phone that has not been opened since last winter
 * is not one version behind.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    // Hands as v2 wrote them: no `deletedAt` property at all, which is what the
    // `deletedAt` index added in v6 has to be built over.
    await legacy.table('hands').bulkAdd([
      { id: 'h1', sessionId: 's1', holeCards: 'AsKd', position: 'BTN', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0 },
      { id: 'h2', sessionId: 's1', holeCards: 'QhQd', position: 'CO', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0 },
      { id: 'h3', sessionId: 's2', holeCards: '7c2s', position: 'BB', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0 },
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

  it('counts hands that predate the index they are now counted through', async () => {
    // `countHands` is the total minus the tombstones, off an index that only
    // exists from v6. These three rows were written with no `deletedAt`
    // property, so none of them is in that index -- which is the answer, and
    // the way this would go wrong is by reading absent as deleted.
    expect(await repository.countHands()).toBe(3);

    await repository.deleteHand('h2');
    expect(await repository.countHands()).toBe(2);

    // And a hand written after the upgrade joins the same count.
    await repository.createHand({ sessionId: 's1', at: T0 });
    expect(await repository.countHands()).toBe(3);
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

describe('what this file says it covers', () => {
  it('names each test once, so a paste cannot double-count a block', () => {
    // Three tests had been pasted out of the IndexedDB block into the SQLite
    // one. Two ran twice under the same name, and one of them carried the
    // other engine's comment: "no migration added anything here, so these rows
    // carry no `deletedAt` at all rather than a null one" -- about a row shape
    // SQLite cannot have, since migration 4 is five `ALTER TABLE`s and every
    // migrated row really does get a NULL.
    //
    // Nothing failed and the README's count of 32 was honest. What was not
    // honest is a list of test names advertising more upgrade coverage than
    // there was.
    // Within one block, not across the file: the two engines deliberately
    // answer some of the same questions under the same name, and that parallel
    // is the point of running both.
    const source = readFileSync(join(__dirname, 'migrations.test.ts'), 'utf8');
    const blocks = source.split(/^describe\(/m).slice(1);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      const names = [...block.matchAll(/^ {2}it\('([^']+)'/gm)].map(([, name]) => name);
      expect([...new Set(names)]).toHaveLength(names.length);
    }
  });
});

describe('the Dexie version ladder', () => {
  /**
   * Pinned because the note at the top of `db.ts` describes it, and prose
   * cannot be run. That note said the versions "stop at the 3 that tournaments
   * needed" for three versions after they stopped doing so, which is the shape
   * a comment goes stale in: nothing errors, and the next reader is told the
   * ladder is half as tall as it is. Adding a version now costs a line here.
   */
  const name = 'log-poker-ladder-test';
  let db: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    db = createDatabase(name);
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('runs to 6, and the note at the top of db.ts says which three of those are about keys', () => {
    expect(db.verno).toBe(6);
  });

  it('indexes the tombstone on the hands and on nothing else', async () => {
    // The other half of that note, and the more expensive one to get wrong:
    // an index on a property that is null on almost every row costs a write
    // per tombstone to answer a question only `countHands` asks.
    const indexed = db.tables
      .filter((table) => table.schema.indexes.some((index) => index.name === 'deletedAt'))
      .map((table) => table.name);
    expect(indexed).toEqual(['hands']);
  });

  it('and the board needed no version here, which is where the two schemas part', async () => {
    // SQLite took an `ALTER TABLE` for it, migration 5. IndexedDB stores whole
    // objects, so a hand with a board and a hand without are both just hands.
    // The note calls this the second time that asymmetry has come up; this is
    // the assertion that it is still true.
    expect(MIGRATIONS[4].statements).toEqual(['ALTER TABLE hands ADD COLUMN board TEXT']);
    const hands = db.tables.find((table) => table.name === 'hands');
    expect(hands?.schema.indexes.some((index) => index.name === 'board')).toBe(false);
    await hands?.add({ id: 'h9', sessionId: 's9', holeCards: 'AsKd', board: 'Ah7c2d', position: 'BTN', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0 });
    expect(await hands?.get('h9')).toMatchObject({ board: 'Ah7c2d' });
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

describe('SQLite: a v6 database, which is the shortest walk that exists', () => {
  /**
   * Every SQLite block above starts at 2, 3 or 4, so migration 7's
   * `CREATE INDEX` over existing rows is only ever run at the end of a long
   * walk. That is not the walk a phone one release behind takes, and it is the
   * one the index is most likely to be wrong on -- an index built over rows
   * that were already there rather than over an empty table.
   */
  let driver: NodeSqliteDriver;
  let repository: SqlRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= 6)) {
      for (const statement of migration.statements) await driver.execute(statement);
    }
    await driver.execute('PRAGMA user_version = 6');

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
         NULL, ?, ?, NULL, 'csv|1', ?, ?)`,
      [T0, T0 + 3_600_000, T0, T0],
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

  it('and the index migration 7 builds answers over the rows that were already there', async () => {
    // `listChangedSince` is the read that index exists for, and the row it has
    // to find was written before the index was.
    const { sessions, venues } = await repository.listChangedSince(0);
    expect(sessions.map((change) => change.record.id)).toEqual(['s1']);
    expect(venues.map((change) => change.record.id)).toEqual(['v1']);
    expect(await repository.listChangedSince(T0 + 1)).toEqual({
      venues: [],
      sessions: [],
      rebuys: [],
      hands: [],
      moodEntries: [],
    });
  });

  it('and the log it was holding is all still there', async () => {
    expect(await repository.listSessions()).toHaveLength(1);
    expect(await repository.listImportKeys()).toEqual(['csv|1']);
  });
});

describe('IndexedDB: a v5 database, where the tombstone index has yet to land', () => {
  /**
   * v6 indexes `deletedAt` on the hands so `countHands` can answer with two
   * counts of keys instead of a cursor over the log. Every Dexie block above
   * starts at 2, so that index has only ever been built during a four-version
   * walk; this is the one-step upgrade a device one release behind performs,
   * over hands that are already there and one that is already tombstoned.
   */
  const name = 'log-poker-v5-test';
  let db: ReturnType<typeof createDatabase>;
  let repository: DexieRepository;

  beforeEach(async () => {
    const legacy = new Dexie(name);
    // v5's stores exactly: the `updatedAt` indexes, and no `deletedAt` on the
    // hands.
    legacy.version(5).stores({
      venues: 'id, name, createdAt, updatedAt',
      sessions: 'id, venueId, format, gameType, startedAt, endedAt, updatedAt, &importKey',
      rebuys: 'id, sessionId, at, updatedAt',
      hands: 'id, sessionId, at, updatedAt',
      moodEntries: 'id, sessionId, phase, at, updatedAt',
      preferences: 'key',
    });
    await legacy.open();
    await legacy.table('venues').add({
      id: 'v1', name: 'Aria', isHomeGame: 0, createdAt: T0, updatedAt: T0,
    });
    await legacy.table('sessions').add({
      id: 's1', venueId: 'v1', format: 'cash', gameType: 'NLHE',
      stakes: { smallBlind: 100, bigBlind: 200 }, currency: 'USD', buyIn: 30_000,
      fee: null, cashOut: 45_000, entrants: null, finishPosition: null,
      startedAt: T0, endedAt: T0 + 3_600_000, notes: null, createdAt: T0, updatedAt: T0,
    });
    await legacy.table('hands').bulkAdd([
      { id: 'h1', sessionId: 's1', holeCards: 'AsKd', position: 'BTN', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0 },
      { id: 'h2', sessionId: 's1', holeCards: 'QhQd', position: 'CO', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0 },
      // Already deleted when the index arrives, which is the row the index is
      // for and the one a fresh table would never have.
      { id: 'h3', sessionId: 's1', holeCards: '7c2s', position: 'BB', note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0, deletedAt: T0 },
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

  it('opens at 6, which is one step', async () => {
    expect(db.verno).toBe(6);
  });

  it('counts the live hands over an index built after they were written', async () => {
    expect(await repository.countHands()).toBe(2);
    expect(await repository.listHands('s1')).toHaveLength(2);
  });
});
