/**
 * The SQLite implementation against the shared contract, backed by a real
 * SQLite engine (`node:sqlite`) rather than a fake.
 *
 * The contract is the whole of what this engine has to answer. What is left
 * over and lives at the bottom of this file is one thing it cannot see: how
 * large a statement this engine is asked to run. SQLite refuses one carrying
 * more host parameters than it allows, and the contract runs on a handful of
 * rows, where no statement ever gets near the limit.
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

describe('a log too big for one statement', () => {
  const T0 = 1_700_000_000_000;

  it('asks in several rather than being refused', async () => {
    // `attachChildren` builds one placeholder per session it is handed, and
    // `listSessions()` hands it the whole log. Past SQLITE_MAX_VARIABLE_NUMBER
    // that statement is refused outright -- "too many SQL variables" --
    // reproduced at exactly 32767 sessions on node:sqlite, and at 1000 on a
    // build with the older limit of 999. Either way the sessions list throws
    // with every session on the device intact behind it.
    //
    // Counting parameters rather than building 32767 sessions: the limit that
    // matters is the smallest one any build sets, this suite cannot reach even
    // the largest in reasonable time, and the property worth holding is that no
    // statement grows with the log at all.
    const driver = new NodeSqliteDriver(':memory:');
    let ids = 0;
    const repository = new SqlRepository(driver, {
      clock: { now: () => T0 },
      ids: { next: () => `id-${++ids}` },
    });
    await repository.init();

    const venue = await repository.createVenue({ name: 'Aria', isHomeGame: false });
    const sessions = await repository.createSessions(
      Array.from({ length: 1000 }, (_, i) => ({
        venueId: venue.id,
        format: 'cash' as const,
        gameType: 'NLHE' as const,
        stakes: { smallBlind: 100, bigBlind: 200 },
        currency: 'USD',
        buyIn: 30_000,
        startedAt: T0 + i,
      })),
    );
    // On a session in what has to be the second batch, so the grouping is
    // proved across the seam rather than only inside one statement.
    const late = sessions[sessions.length - 1];
    await repository.addRebuy({ sessionId: late.id, amount: 20_000, at: T0 + 2 });
    await repository.addRebuy({ sessionId: late.id, amount: 10_000, at: T0 + 1 });

    const widest = { params: 0 };
    const all = driver.all.bind(driver);
    jest.spyOn(driver, 'all').mockImplementation((sql, params) => {
      widest.params = Math.max(widest.params, params ? params.length : 0);
      return all(sql, params);
    });

    const read = await repository.listSessions();

    expect(read).toHaveLength(1000);
    expect(widest.params).toBeLessThanOrEqual(900);
    // Still one answer: every session keeps its venue, and the rebuys on the
    // one in the later batch arrive on it, in the order they were taken.
    expect(read.every((session) => session.venue?.name === 'Aria')).toBe(true);
    expect(read.find((session) => session.id === late.id)?.rebuys.map((r) => r.at)).toEqual([
      T0 + 1,
      T0 + 2,
    ]);

    jest.restoreAllMocks();
    await driver.close();
  }, 60_000);
});
