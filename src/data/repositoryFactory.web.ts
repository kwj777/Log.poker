/**
 * Web repository factory — IndexedDB via Dexie.
 *
 * Mirrors `repositoryFactory.ts`; see that file for why the split exists.
 */

import { createDatabase } from './dexie/db';
import { DexieRepository } from './dexie/DexieRepository';
import type { Repository } from './repository';
import type { RepositoryFactory } from './repositoryFactory';

export const createRepository: RepositoryFactory = async () => {
  const repository = new DexieRepository(createDatabase());
  await repository.init();
  return repository satisfies Repository;
};

export const STORAGE_ENGINE = 'IndexedDB (Dexie)';
