/**
 * Native repository factory (iOS / Android).
 *
 * Metro picks `repositoryFactory.web.ts` for the web bundle, so expo-sqlite is
 * never pulled into a browser build. Both files export the same `createRepository`
 * signature; the `satisfies` check in each one keeps them from drifting.
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
