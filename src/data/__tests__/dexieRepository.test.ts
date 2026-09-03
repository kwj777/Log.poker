/**
 * The IndexedDB implementation against the shared contract, backed by
 * fake-indexeddb -- a real IndexedDB engine running in Node, so Dexie's actual
 * transaction and index behavior is exercised.
 */

import 'fake-indexeddb/auto';

import { createDatabase, type LogDatabase } from '../dexie/db';
import { DexieRepository } from '../dexie/DexieRepository';
import { runRepositoryContract } from './repositoryContract';

const databases = new WeakMap<DexieRepository, LogDatabase>();
let counter = 0;

runRepositoryContract('IndexedDB', {
  create: async ({ ctx }) => {
    // A fresh database name per test: IndexedDB deletion is asynchronous and
    // reusing one name lets a previous test's rows leak into the next.
    const db = createDatabase(`log-poker-test-${++counter}`);
    const repository = new DexieRepository(db, ctx);
    await repository.init();
    databases.set(repository, db);
    return repository;
  },
  destroy: async (repository) => {
    const db = databases.get(repository as DexieRepository);
    if (!db) return;
    db.close();
    await db.delete();
  },
});
