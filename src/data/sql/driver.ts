/**
 * The narrow slice of SQLite that `SqlRepository` needs.
 *
 * expo-sqlite implements it on device; a `node:sqlite` adapter implements it in
 * the test suite. That is the whole point: the repository code that ships to
 * iOS and Android is the code the tests exercise, rather than a stand-in.
 */

export type SqlValue = string | number | null;

export interface SqlDriver {
  /** Run one or more statements with no parameters (schema DDL, pragmas). */
  execute(sql: string): Promise<void>;
  /** Run a single parameterised statement. */
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Run a query and return every row. */
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Run `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const first = async <T>(
  driver: SqlDriver,
  sql: string,
  params?: readonly SqlValue[],
): Promise<T | null> => {
  const rows = await driver.all<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
};
