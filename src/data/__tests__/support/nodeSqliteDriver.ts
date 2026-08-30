/**
 * `SqlDriver` over Node's built-in SQLite, used only by the test suite.
 *
 * This is what lets the shipped `SqlRepository` — the exact class that runs on
 * iOS and Android — be exercised against a real SQLite engine in CI, instead of
 * a hand-written fake that would agree with whatever the repository does.
 */

import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver, SqlValue } from '../../sql/driver';

export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private depth = 0;

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

  /** Nested calls join the outer transaction rather than failing on BEGIN. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn();
    this.depth += 1;
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
