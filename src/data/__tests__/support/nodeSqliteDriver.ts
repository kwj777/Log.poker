/**
 * `SqlDriver` over Node's built-in SQLite, used only by the test suite.
 *
 * This is what lets the shipped `SqlRepository` -- the exact class that runs on
 * iOS and Android -- be exercised against a real SQLite engine in CI, instead of
 * a hand-written fake that would agree with whatever the repository does.
 *
 * **It queues its transactions the way the shipped driver does**, and that is
 * not a detail. It used to answer a transaction opened inside another by
 * joining it -- `if (depth > 0) return fn()` -- which expo-sqlite does not and
 * cannot, so the stand-in was forgiving where the real one destroys itself. A
 * whole class of failure was invisible to every test by construction. Nothing
 * in the repository opens a nested transaction, which a run of the suite over
 * a driver that threw on one confirms, so what the guard bought was silence.
 */

import { DatabaseSync } from 'node:sqlite';

import { oneAtATime, type SqlDriver, type SqlValue } from '../../sql/driver';

export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private readonly queue = oneAtATime();

  constructor(filename = ':memory:') {
    this.db = new DatabaseSync(filename);
  }

  async execute(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as SqlValue[]));
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    // node:sqlite returns null-prototype objects; spreading gives plain ones so
    // Jest's matchers and `Object.entries` behave as callers expect.
    const rows = this.db.prepare(sql).all(...(params as SqlValue[]));
    return rows.map((row) => ({ ...row })) as T[];
  }

  /** One at a time, the same as the driver that ships. See the note above. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue(async () => {
      this.db.exec('BEGIN');
      try {
        const result = await fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
