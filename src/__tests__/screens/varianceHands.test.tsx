/**
 * The hands breakdown, and the sentence that has to come before it.
 *
 * Grouping logged hands by seat and drawing bars produces something that looks
 * exactly like a positional win rate and is not one: a win rate is over every
 * hand dealt, and this is over the handful that were worth typing out at a
 * table. A bad beat is memorable and a folded blind is not.
 *
 * So the caveat is not decoration and is not in small print at the bottom.
 * These check that it is on screen, that every row carries its count, and that
 * a player who has never written a hand down is not shown a section explaining
 * an empty chart.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import VarianceScreen from '../../../app/(tabs)/variance';
import { useLogStore } from '../../store/useLogStore';
import type { Hand, SessionWithChildren } from '../../domain/types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  // The screen reads the journal only while it is the tab in front, because a
  // bottom tab stays mounted once visited. Under test it always is.
  useIsFocused: () => true,
}));

const mockRepository = { listHands: jest.fn() };

jest.mock('../../data', () => ({
  getRepository: async () => mockRepository,
  onSyncApplied: () => () => undefined,
}));

const T = Date.UTC(2026, 0, 10);
const DAY = 86_400_000;
const HOUR = 3_600_000;

const hand = (over: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  sessionId: 's1',
  holeCards: 'AsKd',
  board: null,
  position: null,
  note: null,
  tags: [],
  amount: null,
  at: T,
  createdAt: T,
  updatedAt: T,
  ...over,
});

/** Enough cash sessions that the screen has something to say about variance. */
const cashSessions = (): SessionWithChildren[] =>
  Array.from({ length: 12 }, (_, i) =>
    session(`s${i}`, {
      startedAt: T - i * DAY,
      endedAt: T - i * DAY + 4 * HOUR,
      cashOut: i % 2 === 0 ? 40_000 : 20_000,
    }),
  );

const load = (hands: Hand[], sessions = cashSessions()) => {
  mockRepository.listHands.mockImplementation(async () => hands);
  mockPush.mockClear();
  useLogStore.setState({
    status: 'ready',
    sessions,
    venues: [],
    moodEntries: [],
    activeSession: null,
    handCount: hands.length,
    handsVersion: 0,
  });
};

describe('the caveat above the bars', () => {
  it('says these are the hands you wrote down, not the hands you played', async () => {
    load([hand({ id: 'a', tags: ['bad_beat'], amount: -20_000 })]);
    await renderScreen(<VarianceScreen />);
    expect(
      await screen.findByText(/you chose to write down, not the hands you played/),
    ).toBeTruthy();
  });

  it('and counts them, so nobody reads a bar as a sample of their game', async () => {
    load([
      hand({ id: 'a', tags: ['bad_beat'], amount: -20_000 }),
      hand({ id: 'b', tags: ['bad_beat'] }),
      hand({ id: 'c', tags: ['cooler'] }),
    ]);
    await renderScreen(<VarianceScreen />);
    expect(await screen.findByText(/3 hands so far/)).toBeTruthy();
  });
});

describe('what the rows say', () => {
  it('carries the count on every group, beside the money', async () => {
    load([
      hand({ id: 'a', tags: ['bad_beat'], amount: -20_000 }),
      hand({ id: 'b', tags: ['bad_beat'], amount: -10_000 }),
    ]);
    await renderScreen(<VarianceScreen />);
    await screen.findByText(/2 hands so far/);
    expect(screen.getByText('2 hands')).toBeTruthy();
    expect(screen.getByText('-$300')).toBeTruthy();
  });

  it('says how many carried a pot when it is not all of them', async () => {
    // The caveat that stops one priced hand inside three being read as three
    // hands' worth of money.
    load([
      hand({ id: 'a', tags: ['bad_beat'], amount: -20_000 }),
      hand({ id: 'b', tags: ['bad_beat'] }),
      hand({ id: 'c', tags: ['bad_beat'] }),
    ]);
    await renderScreen(<VarianceScreen />);
    await screen.findByText(/3 hands so far/);
    expect(screen.getByText('1 of 3 with a pot recorded')).toBeTruthy();
  });

  it('draws no figure at all for a group where none did', async () => {
    load([hand({ id: 'a', tags: ['bluff'] })]);
    await renderScreen(<VarianceScreen />);
    await screen.findByText(/1 hand so far/);
    expect(screen.getByText('--')).toBeTruthy();
  });

  it('groups by seat as well, which nothing in the app did before', async () => {
    load([hand({ id: 'a', position: 'BTN', amount: 15_000 })]);
    await renderScreen(<VarianceScreen />);
    await screen.findByText(/1 hand so far/);
    expect(screen.getByText('By seat')).toBeTruthy();
    expect(screen.getByText('BTN')).toBeTruthy();
  });
});

describe('who does not get the card at all', () => {
  it('a player who has never written a hand down', async () => {
    // A section explaining an empty chart is worse than no section: this page
    // is long already and every card on it is meant to be about them.
    load([]);
    await renderScreen(<VarianceScreen />);
    expect(screen.queryByText('The hands you wrote down')).toBeNull();
  });

  it('and the hands are scoped to the currency on screen, like everything else', async () => {
    // A euro hand must not land in a dollar pile just because the pile is
    // drawn from a list the currency filter never reached.
    const mixed = [
      ...cashSessions(),
      session('eu', { currency: 'EUR', startedAt: T - 40 * DAY, endedAt: T - 40 * DAY + 4 * HOUR }),
    ];
    load(
      [
        hand({ id: 'usd', sessionId: 's0', tags: ['bad_beat'], amount: -20_000 }),
        hand({ id: 'eur', sessionId: 'eu', tags: ['bad_beat'], amount: -50_000 }),
      ],
      mixed,
    );
    await renderScreen(<VarianceScreen />);
    expect(await screen.findByText(/1 hand so far/)).toBeTruthy();
    expect(screen.getByText('-$200')).toBeTruthy();
  });
});

describe('the way through to the list', () => {
  it('opens the hands screen', async () => {
    load([hand({ id: 'a', tags: ['bad_beat'] })]);
    await renderScreen(<VarianceScreen />);
    await userEvent.press(await screen.findByText('Open your hands'));
    expect(mockPush).toHaveBeenCalledWith('/hands');
  });
});
