/**
 * The word over the biggest number in the app.
 *
 * It said "Bankroll" over cumulative profit from zero for as long as this
 * screen has existed. A bankroll is a balance: for a winning player the two
 * differ by whatever they sat down with, and for a losing one the headline was
 * negative, which no bankroll has ever been. The app even ships a guide about
 * how big a bankroll should be, for a number it did not have.
 *
 * So these are mostly tests about a word. That is the right subject: the
 * arithmetic is four lines and is pinned in `stats.test.ts`, and what could go
 * wrong here is the screen claiming to show something it is not -- including
 * in the case that made this worth doing, a player whose starting balance is
 * in a currency they are not currently looking at.
 */

import { screen } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import DashboardScreen from '../../../app/(tabs)/index';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

jest.mock('../../features/family/FamilyCrossPromo', () => ({ FamilyCrossPromo: () => null }));

/** One session, won 200.00, so the profit figure is easy to read off. */
const WON = session('s1', { buyIn: 30_000, cashOut: 50_000 });
/** One session, lost 300.00, which is where the old headline read worst. */
const LOST = session('s2', { buyIn: 30_000, cashOut: 0, currency: 'USD' });

/**
 * By its label, because the headline figure is not the only place a money
 * amount appears on this screen -- the recent-sessions rows carry their own.
 * The label is the word and the number together, which is the pairing under
 * test.
 */
const headline = () => screen.getByLabelText(/^(Profit|Bankroll): /).props.accessibilityLabel;

const load = (
  sessions = [WON],
  startingBalance: { cents: number; currency: string } | null = null,
) =>
  useLogStore.setState({
    status: 'ready',
    sessions,
    venues: [],
    moodEntries: [],
    activeSession: null,
    startingBalance,
    handCount: 0,
    handsVersion: 0,
  });

describe('with no starting balance', () => {
  it('calls the figure what it is', async () => {
    load();
    await renderScreen(<DashboardScreen />);
    expect(screen.getByText('Profit')).toBeTruthy();
    expect(screen.queryByText('Bankroll')).toBeNull();
  });

  it('shows the same number it always did, signed', async () => {
    load();
    await renderScreen(<DashboardScreen />);
    expect(headline()).toBe('Profit: +$200');
  });
});

describe('with one', () => {
  it('says bankroll, because now it is one', async () => {
    load([WON], { cents: 500_000, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    expect(screen.getByText('Bankroll')).toBeTruthy();
  });

  it('shows the balance, not the profit', async () => {
    load([WON], { cents: 500_000, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    // Unsigned: a bankroll is an amount, not a movement.
    expect(headline()).toBe('Bankroll: $5,200');
  });

  it('keeps the profit underneath, which is what the player is tracking', async () => {
    load([WON], { cents: 500_000, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    expect(screen.getByText('+$200 logged')).toBeTruthy();
  });

  it('stays positive through a losing stretch, which the old headline did not', async () => {
    load([LOST], { cents: 500_000, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    expect(headline()).toBe('Bankroll: $4,700');
    expect(screen.getByText('-$300 logged')).toBeTruthy();
  });

  it('treats a balance of zero as an answer, since somebody can start from nothing', async () => {
    load([WON], { cents: 0, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    // Zero is not the absence of an answer, so this is still a bankroll.
    expect(headline()).toBe('Bankroll: $200');
  });
});

describe('with one in a currency this view is not in', () => {
  it('does not add it to another currency', async () => {
    // The bug this screen has already had once: a figure in one money added
    // to a column in another.
    load([WON], { cents: 500_000, currency: 'EUR' });
    await renderScreen(<DashboardScreen />);
    expect(headline()).not.toContain('5,200');
  });

  it('and says profit rather than claiming a bankroll it cannot show', async () => {
    load([WON], { cents: 500_000, currency: 'EUR' });
    await renderScreen(<DashboardScreen />);
    expect(headline()).toBe('Profit: +$200');
  });
});

describe('the curve under the headline', () => {
  /** The chart's spoken label, which is all a screen reader is given for it. */
  const curveLabel = () => screen.getByLabelText(/^Bankroll over /).props.accessibilityLabel;

  /** Two sessions, because a line needs two points before it is drawn at all. */
  const TWO = [WON, session('s3', { buyIn: 30_000, cashOut: 40_000 })];

  it('ends where the line ends, rather than at the profit', async () => {
    // Two different numbers once there is a balance, and this is the one a
    // screen reader is handed in place of the drawing. It said "ending at
    // +$300" under a headline reading "Bankroll: $5,300", and the line really
    // does end at 5,300.
    load(TWO, { cents: 500_000, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    expect(curveLabel()).toBe('Bankroll over 2 sessions, ending at $5,300.');
  });

  it('keeps the sign when the figure is a profit rather than a balance', async () => {
    load(TWO);
    await renderScreen(<DashboardScreen />);
    expect(curveLabel()).toBe('Bankroll over 2 sessions, ending at +$300.');
  });

  it('names where the line starts on the axis under it', async () => {
    // Hard-coded, the left caption read $0 under a curve based at $5,000
    // while the caption at the other end of the same axis read $5.3k.
    load(TWO, { cents: 500_000, currency: 'USD' });
    await renderScreen(<DashboardScreen />);
    expect(screen.getByText('$5k')).toBeTruthy();
    expect(screen.getByText('$5.3k')).toBeTruthy();
  });

  it('still starts at zero for somebody who has not set one', async () => {
    load(TWO);
    await renderScreen(<DashboardScreen />);
    expect(screen.getByText('$0')).toBeTruthy();
  });
});
