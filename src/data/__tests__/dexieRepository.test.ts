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

describe('what a limited list reads', () => {
  it('stops at the limit instead of reading the log and slicing it', async () => {
    // `limit` used to bound what came back and not what it cost: the whole
    // table was read and deserialized and then sliced. The SQLite side has
    // always put the LIMIT in the statement. The caller that wants this most is
    // app/claim.tsx, asking for one session to find out whether this device has
    // a log at all -- and the hand-off is web only, so the one caller with a
    // limit ran exclusively on the engine that ignored it.
    const db = createDatabase(`log-poker-test-limit-${++counter}`);
    const repository = new DexieRepository(db, {
      clock: { now: () => T0 },
      ids: { next: () => `id-${++ids}` },
    });
    await repository.init();

    // Fifty nights at one room and the most recent at another. The answer is
    // the one at the other room, so the fifty are what a limit is supposed to
    // stop this from touching -- and counting a venue's sessions, which
    // `attachChildren` does afterwards, only reaches the one it is about.
    const old = await repository.createVenue({ name: 'Aria', isHomeGame: false });
    const newest = await repository.createVenue({ name: 'Bellagio', isHomeGame: false });
    const night = (venueId: string, at: number) => ({
      venueId,
      format: 'cash' as const,
      gameType: 'NLHE' as const,
      stakes: { smallBlind: 100, bigBlind: 200 },
      currency: 'USD',
      buyIn: 30_000,
      startedAt: at,
    });
    await repository.createSessions(
      Array.from({ length: 50 }, (_, i) => night(old.id, T0 + i)),
    );
    await repository.createSession(night(newest.id, T0 + 1000));

    // Dexie's own count of records handed out of the store, which is the cost
    // this is about: a timer would say the same thing less reliably.
    let read = 0;
    const counting = (record: unknown) => {
      read += 1;
      return record;
    };
    db.sessions.hook('reading', counting);

    const sessions = await repository.listSessions({ limit: 1 });
    expect(sessions.map((session) => session.venue?.name)).toEqual(['Bellagio']);
    // The one session, and the one session behind its venue's count. Not the
    // fifty at the other room.
    expect(read).toBeLessThan(5);

    db.sessions.hook('reading').unsubscribe(counting);
    db.close();
    await db.delete();
  });
});

describe('what counting the hands reads', () => {
  it('counts keys rather than cursoring every hand in the log', async () => {
    // The old version cursored the table and counted what survived `isLive`,
    // under a comment claiming it was "one pass over keys". `Table.each`
    // cursors values, so every hand came back out of IndexedDB as a structured
    // clone -- for a number, on every refresh, after every hand written at the
    // table and after every sync pull.
    const db = createDatabase(`log-poker-test-count-${++counter}`);
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
    const hands = [];
    for (let i = 0; i < 5; i += 1) {
      hands.push(await repository.createHand({ sessionId: session.id, at: T0 + i }));
    }
    await repository.deleteHand(hands[0].id);
    await repository.deleteHand(hands[1].id);

    let whole = 0;
    const readAll = db.hands.toArray.bind(db.hands);
    const cursorAll = db.hands.each.bind(db.hands);
    jest.spyOn(db.hands, 'toArray').mockImplementation(() => {
      whole += 1;
      return readAll();
    });
    jest.spyOn(db.hands, 'each').mockImplementation((callback) => {
      whole += 1;
      return cursorAll(callback);
    });

    // Three live of five, so the tombstones are really being taken off rather
    // than the whole table being reported.
    expect(await repository.countHands()).toBe(3);
    expect(whole).toBe(0);

    jest.restoreAllMocks();
    db.close();
    await db.delete();
  });
});

describe('what reading one session reads', () => {
  it('counts the venues in hand rather than walking every session in the log', async () => {
    // `attachChildren` fills in each session's venue, and a venue carries how
    // many sessions are at it. It got that from the whole-log count, so reading
    // ONE session -- which `getActiveSession` does on every refresh, after every
    // write and every sync pull -- walked every session there is to fill in one
    // number. The SQLite side has always counted only the venues it was asked
    // about.
    const db = createDatabase(`log-poker-test-counts-${++counter}`);
    const repository = new DexieRepository(db, {
      clock: { now: () => T0 },
      ids: { next: () => `id-${++ids}` },
    });
    await repository.init();

    const here = await repository.createVenue({ name: 'Aria', isHomeGame: false });
    const elsewhere = await repository.createVenue({ name: 'Bellagio', isHomeGame: false });
    const at = async (venueId: string) =>
      repository.createSession({
        venueId,
        format: 'cash',
        gameType: 'NLHE',
        stakes: { smallBlind: 100, bigBlind: 200 },
        currency: 'USD',
        buyIn: 30_000,
        startedAt: T0,
      });
    const mine = await at(here.id);
    await at(here.id);
    for (let other = 0; other < 6; other += 1) await at(elsewhere.id);

    // Both ways the table can be read end to end: `toArray` materializes it and
    // `each` cursors it, and the whole-log count used the second.
    let whole = 0;
    const readAll = db.sessions.toArray.bind(db.sessions);
    const cursorAll = db.sessions.each.bind(db.sessions);
    jest.spyOn(db.sessions, 'toArray').mockImplementation(() => {
      whole += 1;
      return readAll();
    });
    jest.spyOn(db.sessions, 'each').mockImplementation((callback) => {
      whole += 1;
      return cursorAll(callback);
    });

    const read = await repository.getSession(mine.id);

    // The number is still right, which is what stops this passing by not
    // counting at all: two sessions at Aria, and the six at Bellagio are
    // nobody's business here.
    expect(read?.venue?.name).toBe('Aria');
    expect(read?.venue?.sessionCount).toBe(2);
    expect(whole).toBe(0);

    jest.restoreAllMocks();
    db.close();
    await db.delete();
  });
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

describe('what applying a sync answer reads', () => {
  it('looks up the rows the answer names, rather than the tables they are in', async () => {
    // `applyChanges` read `venues` and `sessions` whole, whatever the change
    // set held -- 600 structured clones to place one rebuy under its parent,
    // and the same 600 for a change set containing nothing at all. The reads
    // it needs are by id, which is what `newerHere` beside them already did.
    //
    // `toArray()` is that read, counted rather than timed, for the same reason
    // as the push test above: it says which of the two shapes the code has.
    const db = createDatabase(`log-poker-test-apply-${++counter}`);
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

    const empty = {
      venues: [],
      sessions: [],
      rebuys: [],
      hands: [],
      moodEntries: [],
    };
    await repository.applyChanges(empty);
    expect(whole).toEqual([]);

    await repository.applyChanges({
      ...empty,
      rebuys: [
        {
          record: {
            id: 'r1',
            sessionId: session.id,
            amount: 10_000,
            at: T0,
            createdAt: T0,
            updatedAt: T0 + 1,
          },
          deletedAt: null,
        },
      ],
    });
    expect(whole).toEqual([]);

    jest.restoreAllMocks();
    // And it landed, which is what stops this passing by doing nothing.
    expect((await repository.getSession(session.id))?.rebuys).toHaveLength(1);
    expect((await repository.listVenues())[0].id).toBe(venue.id);

    db.close();
    await db.delete();
  });
});
