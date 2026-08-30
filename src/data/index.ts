/**
 * The data layer's public entry point.
 *
 * Everything above this file asks for `getRepository()` and gets whichever
 * implementation the platform provides. When cloud sync arrives, a syncing
 * repository is wrapped here — no feature folder needs to change.
 */

import { createRepository, STORAGE_ENGINE } from './repositoryFactory';
import type { Repository } from './repository';

let pending: Promise<Repository> | null = null;

/**
 * Open (once) and return the repository. Concurrent callers during startup share
 * the same promise, so the database is never opened twice.
 */
export const getRepository = (): Promise<Repository> => {
  pending ??= createRepository().catch((error: unknown) => {
    // Clear the cache so a transient open failure can be retried rather than
    // permanently poisoning every later call.
    pending = null;
    throw error;
  });
  return pending;
};

/** Test/dev hook: swap in another implementation. */
export const setRepository = (repository: Repository | null): void => {
  pending = repository === null ? null : Promise.resolve(repository);
};

export { STORAGE_ENGINE };
export * from './repository';
