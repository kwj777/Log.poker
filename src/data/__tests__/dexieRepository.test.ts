/**
 * The IndexedDB implementation against the shared contract, backed by
 * fake-indexeddb -- a real IndexedDB engine running in Node, so Dexie's actual
 * transaction and index behavior is exercised.
 *
 * The contract is the whole of what this engine has to do. What is left over
 * and lives at the bottom of this file is one thing the contract cannot see:
 * how much of the database a read touches. Two engines can agree on every
 * answer and disagree about the cost of giving it.
 */

import 'fake-indexeddb/auto';

import { createDatabase, type LogDatabase } from '../dexie/db';
import { DexieRepository } from '../dexie/DexieRepository';
import { runRepositoryContract } from './repositoryContract';

const databases = new WeakMap<DexieRepository, LogDatabase>();
let counter = 0;
let ids = 0;
const T0 = 1_700_000_000_000;

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

describe('what a sync push reads', () => {
  it('goes to the index rather than pulling every table into memory', async () => {
    // `listChangedSince` runs after every write and answers with nothing
    // nearly every time. It used to get there by reading every venue, session,
    // rebuy, hand and mood entry -- a structured clone per record on this
    // engine -- and filtering them in JavaScript, so the cost was the size of
    // the log rather than the size of the answer.
    //
    // `toArray()` on the table is that read. Counting it rather than timing it
    // says which of the two shapes the code has, which is the finding.
    const db = createDatabase(`log-poker-test-reads-${++counter}`);
    const repository = new DexieRepository(db, {
      clock: { now: () => T0 },
      ids: { next: () => `id-${++ids}` },
    });
    await repository.init();

    const venue = await repository.createVenue({ name: 'Aria', isHomeGame: false });
    const session = await repository.createSession({
      venueId: venue.id,
      format: 'cash',
      gameType: 'NLHE',
      stakes: { smallBlind: 100, bigBlind: 200 },
      currency: 'USD',
      buyIn: 30_000,
      startedAt: T0,
    });
    await repository.createHand({ sessionId: session.id, at: T0 });

    const whole: string[] = [];
    for (const [name, table] of [
      ['venues', db.venues],
      ['sessions', db.sessions],
      ['rebuys', db.rebuys],
      ['hands', db.hands],
      ['moodEntries', db.moodEntries],
    ] as const) {
      const real = table.toArray.bind(table);
      jest.spyOn(table, 'toArray').mockImplementation(() => {
        whole.push(name);
        return real();
      });
    }

    // Nothing has moved since this cursor, so the answer is empty and the
    // right read is five index lookups that find nothing.
    const nothing = await repository.listChangedSince(T0 + 1);
    expect(nothing).toEqual({
      venues: [],
      sessions: [],
      rebuys: [],
      hands: [],
      moodEntries: [],
    });
    expect(whole).toEqual([]);

    // And the answer is still right when there is one, which is what stops
    // this passing by reading nothing at all.
    const everything = await repository.listChangedSince(0);
    expect(everything.hands).toHaveLength(1);
    expect(everything.sessions).toHaveLength(1);
    expect(everything.venues[0].record.sessionCount).toBe(1);

    jest.restoreAllMocks();
    db.close();
    await db.delete();
  });
});
