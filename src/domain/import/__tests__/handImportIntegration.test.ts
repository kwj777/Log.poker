/**
 * Hand histories, end to end: parse a file, let the store write it, read the
 * log back, against a real SQLite engine.
 *
 * The first case is the one a player asked about in so many words: a session
 * started on the phone and still running, a night of play-money hands at
 * PokerStars saved on the laptop, imported before the session is ended.
 */

import { SqlRepository } from '../../../data/sql/SqlRepository';
import { NodeSqliteDriver } from '../../../data/__tests__/support/nodeSqliteDriver';
import type { Repository } from '../../../data/repository';
import {
  defaultDestination,
  groupSittings,
  parseHandHistory,
  type Destination,
  type Sitting,
} from '../handHistory';
import {
  ACR_SET,
  STARS_PLAY_MONEY,
  STARS_PLAY_MONEY_SMALL,
} from '../handHistory/__tests__/fixtures';

const live: { repository: Repository | null } = { repository: null };

jest.mock('../../../data', () => ({
  getRepository: async () => live.repository as Repository,
  onSyncApplied: () => () => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useLogStore } = require('../../../store/useLogStore') as typeof import('../../../store/useLogStore');

const MIN = 60_000;
/** When the play-money hands were dealt, from their headers. */
const FIRST_HAND = Date.UTC(2026, 8, 23, 12, 2, 11);

const read = (text: string): Sitting[] => groupSittings(parseHandHistory(text).hands);

/** Where the preview would send each sitting, with nothing changed by the player. */
const defaults = async (sittings: readonly Sitting[], now: number) => {
  const sessions = await (live.repository as Repository).listSessions();
  return new Map<string, Destination>(
    sittings.map((sitting) => [sitting.key, defaultDestination(sitting, sessions, now)]),
  );
};

describe('importing hand histories end to end', () => {
  let driver: NodeSqliteDriver;
  let repository: Repository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    repository = new SqlRepository(driver);
    await repository.init();
    live.repository = repository;
    useLogStore.setState({ status: 'ready', sessions: [], venues: [], moodEntries: [] });
  });

  afterEach(async () => {
    await driver.close();
  });

  it('puts the hands into the session still running on another device', async () => {
    const venue = await repository.createVenue({ name: 'PokerStars', isHomeGame: false });
    const running = await repository.createSession({
      venueId: venue.id,
      gameType: 'NLHE',
      buyIn: 0,
      startedAt: FIRST_HAND - 30 * MIN,
    });

    const sittings = read(`${STARS_PLAY_MONEY}\n\n${STARS_PLAY_MONEY_SMALL}`);
    const summary = await useLogStore
      .getState()
      .importHands(sittings, await defaults(sittings, FIRST_HAND + 10 * MIN), true);

    expect(summary).toMatchObject({ imported: 2, sessionsCreated: 0, duplicates: 0 });
    const hands = await repository.listHands(running.id);
    expect(hands.map((hand) => hand.holeCards).sort()).toEqual(['7s2d', 'QsQd']);
    // Chips are not money: the result is in the note, and the amount is empty.
    expect(hands.every((hand) => hand.amount === null)).toBe(true);
    expect(hands.find((hand) => hand.holeCards === 'QsQd')?.note).toBe(
      'PokerStars hand #250000000001, table Aludra II. +4,250 chips',
    );
    // The session itself is untouched: still running, nothing about its money changed.
    expect(await repository.getActiveSession()).toMatchObject({ id: running.id, buyIn: 0 });
  });

  it('adds nothing the second time the same file is imported', async () => {
    const venue = await repository.createVenue({ name: 'PokerStars', isHomeGame: false });
    await repository.createSession({
      venueId: venue.id,
      gameType: 'NLHE',
      buyIn: 0,
      startedAt: FIRST_HAND - 30 * MIN,
    });
    const sittings = read(`${STARS_PLAY_MONEY}\n\n${STARS_PLAY_MONEY_SMALL}`);
    const to = await defaults(sittings, FIRST_HAND + 10 * MIN);

    await useLogStore.getState().importHands(sittings, to, true);
    const again = await useLogStore.getState().importHands(sittings, to, true);

    expect(again).toMatchObject({ imported: 0, duplicates: 2 });
    expect(await repository.countHands()).toBe(2);
  });

  it('makes a session for real-money hands with none to go into, once', async () => {
    const sittings = read(ACR_SET);
    const now = Date.UTC(2026, 8, 23, 9);

    const first = await useLogStore.getState().importHands(sittings, await defaults(sittings, now), false);
    expect(first).toMatchObject({ imported: 1, sessionsCreated: 1, venuesCreated: ['ACR'] });

    const [made] = await repository.listSessions();
    // Left the table with 10.00 + 8.60; the hand won 8.60.
    expect(made).toMatchObject({ cashOut: 1860, buyIn: 1000, endedAt: made.startedAt });
    expect((await repository.listHands(made.id))[0]).toMatchObject({ amount: 860, holeCards: 'TdTh' });

    // The same file again goes back to the session it made, and adds nothing.
    const second = await useLogStore
      .getState()
      .importHands(sittings, await defaults(sittings, now), false);
    expect(second).toMatchObject({ imported: 0, sessionsCreated: 0, duplicates: 1 });
    expect(await repository.listSessions()).toHaveLength(1);
  });

  it('takes back the session and venue it made when the hands cannot be written', async () => {
    const sittings = read(ACR_SET);
    const now = Date.UTC(2026, 8, 23, 9);
    const to = await defaults(sittings, now);
    jest.spyOn(repository, 'createHands').mockRejectedValueOnce(new Error('disk full'));

    await expect(useLogStore.getState().importHands(sittings, to, false)).rejects.toThrow(
      'disk full',
    );
    expect(await repository.listSessions()).toEqual([]);
    expect(await repository.listVenues()).toEqual([]);
  });
});
