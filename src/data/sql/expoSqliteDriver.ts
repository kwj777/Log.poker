/**
 * expo-sqlite driver -- used on iOS and Android only.
 *
 * This is the single file in the data layer that imports a native module, which
 * is why the web build never reaches it: `src/data/index.ts` resolves to the
 * Dexie repository on web, and Metro drops this module from that bundle.
 */

import * as SQLite from 'expo-sqlite';

import type { SqlDriver, SqlValue } from './driver';

export const DATABASE_NAME = 'log.db';

class ExpoSqliteDriver implements SqlDriver {
  private readonly db: SQLite.SQLiteDatabase;

  constructor(db: SQLite.SQLiteDatabase) {
    this.db = db;
  }

  async execute(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    await this.db.runAsync(sql, params as SqlValue[]);
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params as SqlValue[]);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    let result: T;
    await this.db.withTransactionAsync(async () => {
      result = await fn();
    });
    // `withTransactionAsync` rejects if `fn` throws, so reaching here means the
    // assignment above ran.
    return result!;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}

export const openExpoSqliteDriver = async (
  name: string = DATABASE_NAME,
): Promise<SqlDriver> => {
  const db = await SQLite.openDatabaseAsync(name);
  return new ExpoSqliteDriver(db);
};
