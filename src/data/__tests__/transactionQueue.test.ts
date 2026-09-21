/**
 * Two writes at once, on the database the app actually ships against.
 *
 * `NodeSqliteDriver` is a real SQLite engine but a synchronous one, so its
 * statements cannot interleave and the race this is about cannot happen there.
 * expo-sqlite's are asynchronous and its `withTransactionAsync` is `BEGIN`, the
 * task, `COMMIT`, with a `ROLLBACK` in the catch and nothing else -- no depth
 * counter, no queue, no lock. So the driver below is that body verbatim over
 * `node:sqlite`, with a macrotask between statements to put the gaps back.
 *
 * What it demonstrates is not a conflict. The second `BEGIN` throws, its catch
 * issues a `ROLLBACK`, and that `ROLLBACK` ends the *first* caller's
 * transaction: the first caller's remaining statements land in autocommit and
 * its `COMMIT` then throws, so both callers are told the write failed while one
 * of them is half applied and on its way to every other device.
 */

import { DatabaseSync } from 'node:sqlite';

import { oneAtATime, type SqlDriver, type SqlValue } from '../sql/driver';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

/** expo-sqlite's semantics, with or without the queue that fixes them. */
const expoShaped = (db: DatabaseSync, queued: boolean): SqlDriver => {
  const queue = oneAtATime();
  const gap = () => new Promise((resolve) => setImmediate(resolve));
  const body = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      db.exec('BEGIN');
      await gap();
      const result = await fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return {
    execute: async (sql) => {
      await gap();
      db.exec(sql);
    },
    run: async (sql, params: readonly SqlValue[] = []) => {
      await gap();
      db.prepare(sql).run(...(params as SqlValue[]));
    },
    all: async <T>(sql: string, params: readonly SqlValue[] = []) => {
      await gap();
      return db.prepare(sql).all(...(params as SqlValue[])).map((row) => ({ ...row })) as T[];
    },
    transaction: <T>(fn: () => Promise<T>) => (queued ? queue(() => body(fn)) : body(fn)),
    close: async () => db.close(),
  };
};

const open = async (queued: boolean) => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE rows (id TEXT PRIMARY KEY NOT NULL)');
  return expoShaped(db, queued);
};

/** Two transactions started in the same tick, as a sync answer and a tap are. */
const both = async (driver: SqlDriver) => {
  const write = (ids: string[]) =>
    driver.transaction(async () => {
      for (const id of ids) await driver.run('INSERT INTO rows (id) VALUES (?)', [id]);
      throw new Error('the second statement failed');
    });
  return Promise.allSettled([write(['a1', 'a2']), write(['b1', 'b2'])]);
};

describe('two transactions arriving together', () => {
  it('destroy each other without the queue, and leave half a write behind', async () => {
    const driver = await open(false);
    const outcomes = await both(driver);

    // Both callers are told it failed, which is the part that looks fine.
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    // And one of them is durably applied anyway: a rolled-back transaction
    // that rolled back somebody else's, leaving its own statements committed.
    const left = await driver.all<{ id: string }>('SELECT id FROM rows');
    expect(left.length).toBeGreaterThan(0);
    await driver.close();
  });

  it('and with it, a failed write leaves nothing at all', async () => {
    const driver = await open(true);
    const outcomes = await both(driver);

    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    // Each one rolled back its own work and nobody else's, which is what a
    // transaction is for.
    expect(await driver.all('SELECT id FROM rows')).toEqual([]);
    await driver.close();
  });

  it('and the reason each one gave is its own, not the other one arriving', async () => {
    const driver = await open(true);
    const outcomes = await both(driver);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      expect(String((outcome as PromiseRejectedResult).reason)).toContain(
        'the second statement failed',
      );
    }
    await driver.close();
  });
});

/**
 * And the same question of the stand-in, which is a driver in this repository
 * rather than a sketch of one.
 *
 * `node:sqlite` is synchronous, so its statements cannot interleave -- but the
 * transaction bodies can, because they await. This used to be answered by a
 * depth counter, and a counter on the instance cannot tell a transaction
 * opened inside another from one opened beside it: a second caller arriving
 * while the first was awaiting was silently folded into the first's
 * transaction, so one rolling back took the other's work with it. That is the
 * opposite of forgiving, and it was invisible because nothing asked.
 */
describe('the driver the suite runs on', () => {
  it('does not let one failed write roll back another that was already in flight', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    await driver.execute('CREATE TABLE rows (id TEXT PRIMARY KEY NOT NULL)');

    const kept = driver.transaction(async () => {
      await driver.run('INSERT INTO rows (id) VALUES (?)', ['kept']);
      await new Promise((resolve) => setImmediate(resolve));
      await driver.run('INSERT INTO rows (id) VALUES (?)', ['kept-too']);
    });
    const lost = driver.transaction(async () => {
      await driver.run('INSERT INTO rows (id) VALUES (?)', ['lost']);
      throw new Error('this one could not finish');
    });

    await expect(kept).resolves.toBeUndefined();
    await expect(lost).rejects.toThrow('this one could not finish');

    const left = await driver.all<{ id: string }>('SELECT id FROM rows ORDER BY id');
    expect(left.map((row) => row.id)).toEqual(['kept', 'kept-too']);
    await driver.close();
  });
});
