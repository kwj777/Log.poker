/**
 * The SQLite implementation against the shared contract, backed by a real
 * SQLite engine (`node:sqlite`) rather than a fake.
 */

import { SqlRepository } from '../sql/SqlRepository';
import { runRepositoryContract } from './repositoryContract';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

const drivers = new WeakMap<SqlRepository, NodeSqliteDriver>();

runRepositoryContract('SQLite', {
  create: async ({ ctx }) => {
    const driver = new NodeSqliteDriver(':memory:');
    const repository = new SqlRepository(driver, ctx);
    await repository.init();
    drivers.set(repository, driver);
    return repository;
  },
  destroy: async (repository) => {
    await drivers.get(repository as SqlRepository)?.close();
  },
});
