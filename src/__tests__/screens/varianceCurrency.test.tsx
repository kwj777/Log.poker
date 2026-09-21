/**
 * The Variance tab, on a player who plays in two currencies.
 *
 * This screen was the one that did not get scoped when the dashboard and
 * Sessions did, and that is worse than the uniform dollars it replaced: the
 * other two tabs started telling the truth about a player with two currencies
 * and this one went on adding them, so the app contradicted itself on the
 * screen whose entire job is to be believed.
 *
 * The tournament half is where it was plainly wrong -- `tournamentTotals` adds
 * raw cents and the fees tile drew them with a dollar sign whatever they were
 * -- so that is what these check hardest.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import VarianceScreen from '../../../app/(tabs)/variance';
import { useLogStore } from '../../store/useLogStore';
import type { SessionWithChildren } from '../../domain/types';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T = Date.UTC(2026, 0, 10);

/** A tournament entry: a fee that is its own number, and a prize. */
const entry = (
  id: string,
  currency: string,
  over: Partial<SessionWithChildren> = {},
): SessionWithChildren =>
  session(id, {
    format: 'tournament',
    stakes: null,
    currency,
    buyIn: 10_000,
    fee: 1_000,
    cashOut: 0,
    ...over,
  });

const load = (list: SessionWithChildren[]) =>
  useLogStore.setState({
    status: 'ready',
    sessions: list,
    venues: [],
    moodEntries: [],
    activeSession: null,
    handCount: 0,
    handsVersion: 0,
  });

describe('a player who has played a trip abroad', () => {
  it('adds the fees in one currency rather than across both', async () => {
    // Three dollar entries and two euro ones, with fees that add to numbers
    // neither side could reach alone.
    load([
      entry('us-1', 'USD', { startedAt: T, endedAt: T + 4 * HOUR }),
      entry('us-2', 'USD', { startedAt: T - DAY, endedAt: T - DAY + 4 * HOUR }),
      entry('us-3', 'USD', { startedAt: T - 2 * DAY, endedAt: T - 2 * DAY + 4 * HOUR }),
      entry('eu-1', 'EUR', { startedAt: T - 8 * DAY, endedAt: T - 8 * DAY + 4 * HOUR }),
      entry('eu-2', 'EUR', { startedAt: T - 9 * DAY, endedAt: T - 9 * DAY + 4 * HOUR }),
    ]);
    await renderScreen(<VarianceScreen />);

    expect(screen.getByText('$30')).toBeTruthy();
    // What it used to say: every fee added together, drawn as dollars.
    expect(screen.queryByText('$50')).toBeNull();
  });

  it('and redraws in the other one when it is picked', async () => {
    load([
      entry('us-1', 'USD', { startedAt: T, endedAt: T + 4 * HOUR }),
      entry('us-2', 'USD', { startedAt: T - DAY, endedAt: T - DAY + 4 * HOUR }),
      entry('us-3', 'USD', { startedAt: T - 2 * DAY, endedAt: T - 2 * DAY + 4 * HOUR }),
      entry('eu-1', 'EUR', { startedAt: T - 8 * DAY, endedAt: T - 8 * DAY + 4 * HOUR }),
      entry('eu-2', 'EUR', { startedAt: T - 9 * DAY, endedAt: T - 9 * DAY + 4 * HOUR }),
    ]);
    await renderScreen(<VarianceScreen />);

    await userEvent.press(screen.getByText('€ EUR'));
    expect(screen.getByText('€20')).toBeTruthy();
    expect(screen.queryByText('$30')).toBeNull();
  });

  it('counts only the entries it is showing', async () => {
    load([
      entry('us-1', 'USD', { startedAt: T, endedAt: T + 4 * HOUR }),
      entry('us-2', 'USD', { startedAt: T - DAY, endedAt: T - DAY + 4 * HOUR }),
      entry('us-3', 'USD', { startedAt: T - 2 * DAY, endedAt: T - 2 * DAY + 4 * HOUR }),
      entry('eu-1', 'EUR', { startedAt: T - 8 * DAY, endedAt: T - 8 * DAY + 4 * HOUR }),
      entry('eu-2', 'EUR', { startedAt: T - 9 * DAY, endedAt: T - 9 * DAY + 4 * HOUR }),
    ]);
    await renderScreen(<VarianceScreen />);
    expect(screen.getByText('0 of 3')).toBeTruthy();
  });

  it('offers the chips in the not-enough-yet state too, which is reachable per currency', async () => {
    // A season in dollars and a handful of euro entries: the real screen for
    // one and "not enough yet" for the other, so the way back has to be there.
    load([
      entry('eu-1', 'EUR', { startedAt: T - 8 * DAY, endedAt: T - 8 * DAY + 4 * HOUR }),
      entry('us-1', 'USD', { startedAt: T, endedAt: T + 4 * HOUR }),
    ]);
    await renderScreen(<VarianceScreen />);
    expect(screen.getByText('€ EUR')).toBeTruthy();
    expect(screen.getByText('$ USD')).toBeTruthy();
  });
});

describe('a player who has only ever played in one', () => {
  it('is offered no chips, because there is no choice to make', async () => {
    load([
      entry('us-1', 'USD', { startedAt: T, endedAt: T + 4 * HOUR }),
      entry('us-2', 'USD', { startedAt: T - DAY, endedAt: T - DAY + 4 * HOUR }),
    ]);
    await renderScreen(<VarianceScreen />);
    expect(screen.queryByText('$ USD')).toBeNull();
  });
});
