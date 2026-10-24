/**
 * The recent-stretch verdict, on the dashboard.
 *
 * The verdict itself is pinned in `domain/__tests__/variance.test.ts`, beside
 * the function that writes it. What is only true on this screen, and what
 * these cases are about, is when it reaches a player at all:
 *
 *  - It has to be there once there is a sample, because that sentence is the
 *    reason this app exists and it spent 1.0 one tap away on another tab.
 *  - It has to be *absent* before there is one. The Variance tab answers that
 *    case with an empty state, an explanation and a link to the guide; the
 *    dashboard has nowhere to put any of that, and an app that opens on "not
 *    enough data yet" has spent its best line on an apology.
 *  - A tap has to reach the working, or the card is a claim with no evidence
 *    behind it.
 *
 * The headline is read from the domain rather than typed in, so this file
 * asserts that the screen shows the verdict that was computed and never
 * becomes a second place the copy is written down.
 */

import { screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import DashboardScreen from '../../../app/(tabs)/index';
import { recentStretchFrom } from '../../features/variance/recentStretch';
import type { SessionWithChildren } from '../../domain/types';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/**
 * `count` four-hour sessions with results that actually differ.
 *
 * Four hours rather than one because the estimate wants twenty hours as well
 * as eight sessions, and differing results because a player whose every night
 * came out identically has a standard deviation of zero, which
 * `assessRecentStretch` treats as nothing to measure against.
 *
 * More than `RECENT_SESSIONS` of them, for the same reason: with ten or fewer,
 * the recent stretch is the whole of what the rate was fitted to and the
 * verdict says so instead of judging it.
 */
const history = (count: number): SessionWithChildren[] =>
  Array.from({ length: count }, (_, i) => {
    const startedAt = T0 - i * DAY;
    return session(`s${i}`, {
      startedAt,
      endedAt: startedAt + 4 * HOUR,
      buyIn: 30_000,
      // A spread of results, losing nights included, so sigma is a real number.
      cashOut: 30_000 + ((i % 5) - 2) * 12_000,
    });
  });

const load = (sessions: SessionWithChildren[]) => {
  useLogStore.setState({
    status: 'ready',
    sessions,
    venues: [],
    moodEntries: [],
    activeSession: null,
    handsVersion: 0,
  });
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('the verdict on the dashboard', () => {
  it('shows the verdict the player has earned a sample for', async () => {
    const sessions = history(20);
    const expected = recentStretchFrom(sessions);
    // Guards the fixture rather than the screen: a history that produced no
    // reading would make the assertion below pass for the wrong reason.
    expect(expected.verdict).not.toBe('insufficient_data');

    load(sessions);
    await renderScreen(<DashboardScreen />);

    expect(await screen.findByText(expected.headline)).toBeTruthy();
  });

  it('says nothing at all before there is a sample', async () => {
    const sessions = history(3);
    const expected = recentStretchFrom(sessions);
    expect(expected.verdict).toBe('insufficient_data');

    load(sessions);
    await renderScreen(<DashboardScreen />);

    expect(screen.queryByText(expected.headline)).toBeNull();
  });

  it('opens the page that shows the working', async () => {
    const sessions = history(20);
    load(sessions);
    await renderScreen(<DashboardScreen />);

    const user = userEvent.setup();
    await user.press(await screen.findByText(recentStretchFrom(sessions).headline));

    expect(router.push).toHaveBeenCalledWith('/variance');
  });
});
