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

/**
 * One transaction at a time, on a database that will not do it for us.
 *
 * expo-sqlite's `withTransactionAsync` is `BEGIN`, the task, `COMMIT`, with a
 * `ROLLBACK` in the catch, and nothing else: no depth counter, no queue, no
 * lock. Its own documentation says as much -- "we cannot control the order of
 * async/await order" -- and points at `withExclusiveTransactionAsync`, which
 * solves a different problem by making everybody else fail with "database is
 * locked".
 *
 * Two overlapping transactions on that do not merely conflict, they destroy
 * each other. The second `BEGIN` throws, its catch issues a `ROLLBACK`, and
 * that `ROLLBACK` ends the **first** caller's transaction. The first caller's
 * remaining statements then run in autocommit, so a cascade lands partially
 * and durably, and its `COMMIT` throws -- so both callers are told the write
 * failed while one of them is half applied. `SqlRepository` opens a
 * transaction in six places and the app has no lock above them: a sync answer
 * arrives while somebody taps Delete and that is the whole window.
 *
 * A queue in JavaScript rather than a SQLite mechanism, because the ordering
 * problem is in JavaScript. A failed transaction does not reject the ones
 * behind it: the tail swallows, and only the caller sees the error.
 *
 * **It serializes transactions with each other and nothing more.** A single
 * statement run outside one can still land inside somebody's open transaction
 * and be rolled back with it -- the caveat expo documents -- and fixing that
 * needs the driver to know which calls belong to which transaction, which it
 * cannot see. The catastrophic case is the one that is gone.
 */
export const oneAtATime = (): (<T>(run: () => Promise<T>) => Promise<T>) => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run);
    tail = next.catch(() => undefined);
    return next;
  };
};

export const first = async <T>(
  driver: SqlDriver,
  sql: string,
  params?: readonly SqlValue[],
): Promise<T | null> => {
  const rows = await driver.all<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
};
