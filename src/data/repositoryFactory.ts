/**
 * Native repository factory (iOS / Android).
 *
 * Metro picks `repositoryFactory.web.ts` for the web bundle, so expo-sqlite is
 * never pulled into a browser build. Both files export the same
 * `createRepository` signature, held there by the `RepositoryFactory`
 * annotation on each -- which is a shared type because the web half imports it
 * from here rather than declaring its own.
 *
 * That pins the signature and nothing else. It cannot pin the *set* of names
 * the two halves export, because an export missing from one file is not an
 * error in the file that does not have it: deleting `STORAGE_ENGINE` below
 * from the web half leaves the typecheck and the lint green and Settings
 * saying "Log stores your sessions in on this device". This said the
 * `satisfies` check in each file did that job, and there is no `satisfies` in
 * either one. `platformTwins.test.ts` does it now, for all five pairs.
 */

import { openExpoSqliteDriver } from './sql/expoSqliteDriver';
import { SqlRepository } from './sql/SqlRepository';
import type { Repository } from './repository';

export type RepositoryFactory = () => Promise<Repository>;

export const createRepository: RepositoryFactory = async () => {
  const driver = await openExpoSqliteDriver();
  const repository = new SqlRepository(driver);
  await repository.init();
  return repository;
};

/** Names the storage engine in Settings, so a bug report says which one it hit. */
export const STORAGE_ENGINE = 'SQLite (expo-sqlite)';
