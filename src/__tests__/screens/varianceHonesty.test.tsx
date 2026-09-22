/**
 * The two sentences on the Variance tab that could deny themselves.
 *
 * This screen's whole argument is that it does not manufacture confidence, so
 * a claim that is subtly wrong here is worse than no claim. Both of these were
 * arithmetic rather than judgment, and both contradicted the card they sit in.
 */

import { screen } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import VarianceScreen from '../../../app/(tabs)/variance';
import { useLogStore } from '../../store/useLogStore';
import type { SessionWithChildren } from '../../domain/types';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useIsFocused: () => true,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

const DAY = 86_400_000;
const T = Date.UTC(2026, 0, 10);
const BUY_IN = 30_000;
const BIG_BLIND = 200;

/** A finished $1/$2 night returning exactly `resultBb` over `hours`. */
const night = (id: string, resultBb: number, hours: number, index: number): SessionWithChildren =>
  session(id, {
    startedAt: T + index * DAY,
    endedAt: T + index * DAY + hours * 3_600_000,
    buyIn: BUY_IN,
    cashOut: Math.round(BUY_IN + resultBb * BIG_BLIND),
    stakes: { smallBlind: 100, bigBlind: BIG_BLIND },
  });

/** A finished tournament: an entry, a fee, and no blinds to measure in. */
const tourney = (id: string, cashOut: number, index: number): SessionWithChildren =>
  session(id, {
    format: 'tournament',
    stakes: null,
    fee: 1_000,
    buyIn: 10_000,
    cashOut,
    startedAt: T + index * DAY,
    endedAt: T + index * DAY + 4 * 3_600_000,
  });

const load = (list: SessionWithChildren[]) =>
  useLogStore.setState({
    status: 'ready',
    sessions: list,
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });

/** What the band chart is called, which is all a screen reader gets of it. */
const chartName = (): string =>
  String(
    screen.getByLabelText(/big blinds against an expected/).props.accessibilityLabel,
  );

describe('what the band chart says it is', () => {
  it('agrees with the headline above it, rather than with floating-point dust', async () => {
    // The band closes at its final point by construction -- `confidenceBand`
    // shares the whole of the fitted hours there, so upper, lower and expected
    // are one number. Deciding "inside" by comparing `actual` against that left
    // the answer to the last bits of a running sum, and results that do not
    // terminate in binary put it on the wrong side: the only description a
    // screen reader gets of this chart said the player was outside their own
    // 95% range, under a headline saying they were right where they should be.
    const bbs = [122.5, -100, 205, 28.3, -61.7, 150.9, 44.4, -12.2, 310.1, 75.5, -33.3, 199.9];
    load(bbs.map((bb, index) => night(`s${index}`, bb, 4.5, index)));
    await renderScreen(<VarianceScreen />);

    expect(chartName()).toContain('inside the 95% range');
    expect(chartName()).not.toContain('outside');
  });

  it('and still says outside when the stretch really is', async () => {
    // Which is what stops the fix above from being "always say inside".
    // `running_bad` is a stretch in the coldest 2.5% *for this player*, so it
    // takes a good history and then a bad run -- a player who simply loses has
    // a losing win rate and is at expectation, not below it.
    const good = Array.from({ length: 30 }, (_, index) => night(`w${index}`, 110, 4.5, index));
    const cold = Array.from({ length: 10 }, (_, index) =>
      night(`c${index}`, -520, 4.5, 30 + index),
    );
    load([...good, ...cold]);
    await renderScreen(<VarianceScreen />);

    expect(chartName()).toContain('outside the 95% range');
  });
});

describe('how often a stretch like this finishes in the red', () => {
  it('never says about 0%, on the card whose job is to settle somebody down', async () => {
    // A steady winner: twelve $1/$2 nights, modest swings. The real figure is
    // about five in a hundred thousand, and rounding it to a whole percent
    // printed "finishes in the red about 0% of the time" directly above
    // "Losing stretches are part of a winning player's results".
    const bbs = [90, -20, 110, 47, 70, -30, 105, 35, 80, 65, -15, 95];
    const hours = [5, 4, 6, 4.5, 5, 4, 5.5, 4, 5, 4.5, 4, 5.5];
    load(bbs.map((bb, index) => night(`s${index}`, bb, hours[index], index)));
    await renderScreen(<VarianceScreen />);

    expect(screen.getByText('The part nobody tells you')).toBeTruthy();
    expect(screen.queryByText(/about 0% of the time/)).toBeNull();
    expect(screen.getByText(/less than 1% of the time/)).toBeTruthy();
  });
});

describe('what this page says to somebody who only plays tournaments', () => {
  it('does not ask for a game they do not play', async () => {
    // `toObservations` drops every tournament, so the cash estimate stays at
    // zero sessions and zero hours no matter how many are logged, and the
    // shortfall copy read "Log 8 more sessions and around 20 more hours" --
    // byte for byte what a device with nothing on it shows. Playing more
    // never moved it, because the count is taken after the drop.
    load(Array.from({ length: 20 }, (_, i) => tourney(`t${i}`, i % 4 === 0 ? 40_000 : 0, i)));
    await renderScreen(<VarianceScreen />);

    expect(screen.queryByText(/Log 8 more sessions/)).toBeNull();
    expect(screen.getByText(/no blinds to measure in/i)).toBeTruthy();
    // And the card that does have something to say about them is still there,
    // which is what the new copy points at.
    expect(screen.getByText('Tournaments')).toBeTruthy();
    expect(screen.getByText('5 of 20')).toBeTruthy();
  });

  it('and still asks for more from somebody who has started logging cash', async () => {
    // The shortfall is the honest answer here, so it has to survive: this
    // player has readable sessions and simply not enough of them.
    load([night('s1', 10, 4, 0), night('s2', -20, 5, 1)]);
    await renderScreen(<VarianceScreen />);

    expect(screen.getByText(/more session/)).toBeTruthy();
    expect(screen.queryByText(/no blinds to measure in/i)).toBeNull();
  });
});
