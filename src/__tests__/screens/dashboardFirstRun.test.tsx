/**
 * The dashboard on a log with almost nothing in it.
 *
 * The empty state is gated on there being no session at all, so everything
 * short of that takes the full branch: every card, every heading and both axis
 * captions, drawn whether or not the thing under them has anything to say.
 *
 * Each of these is a label over nothing. That reads as a bug in the app rather
 * than as a stage in filling it up, and it lands on exactly the player least
 * able to tell the difference.
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

const load = (
  sessions: ReturnType<typeof session>[],
  over: Partial<ReturnType<typeof useLogStore.getState>> = {},
) =>
  useLogStore.setState({
    status: 'ready',
    sessions,
    venues: [],
    moodEntries: [],
    activeSession: null,
    startingBalance: null,
    handCount: 0,
    handsVersion: 0,
    ...over,
  });

/** A finished night, won $200. */
const won = (id: string) => session(id, { buyIn: 30_000, cashOut: 50_000 });

const BALANCE = { cents: 500_000, currency: 'USD' };

describe('the bankroll axis, against a chart that refused to draw', () => {
  it('prints nothing under a line that is not there', async () => {
    // Both captions were gated on `curve.length > 0`, and `LineChart` draws
    // when a series has more than one point, because one point is not a line
    // -- which that component's own test pins. `bankrollCurve` emits one point
    // per completed session, so with exactly one the chart body read "Not
    // enough data yet" and the strip beneath it still printed $5k and $5.2k:
    // the two ends of an axis for a curve nobody had drawn.
    load([won('s1')], { startingBalance: BALANCE });
    await renderScreen(<DashboardScreen />);

    expect(screen.getByText('Not enough data yet')).toBeTruthy();
    expect(screen.queryByText('$5k')).toBeNull();
    expect(screen.queryByText('$5.2k')).toBeNull();
  });

  it('and prints both ends once there is one', async () => {
    // The other half, so the gate cannot be fixed by deleting the captions.
    load([won('s1'), won('s2')], { startingBalance: BALANCE });
    await renderScreen(<DashboardScreen />);

    expect(screen.queryByText('Not enough data yet')).toBeNull();
    expect(screen.getByText('$5k')).toBeTruthy();
    expect(screen.getByText('$5.4k')).toBeTruthy();
  });
});

describe('the recent-sessions list, on a log where nothing has finished', () => {
  it('says why it is empty rather than labelling a blank card', async () => {
    // `recent` filters on `endedAt !== null`, while the empty state above this
    // whole branch is gated on there being no session at all. So a player who
    // installed the app, tapped "Start a session" from the empty state and
    // came back to the Dashboard takes the full branch with `recent` empty,
    // and the page ended on an overline with nothing under it: `listCard` is
    // `paddingVertical: 0`, so with no rows the card collapses to about a
    // hairline and the heading labels the bottom of the screen.
    const live = session('s1', { endedAt: null, cashOut: null });
    load([live], { activeSession: live });
    await renderScreen(<DashboardScreen />);

    expect(screen.getByText('Recent sessions')).toBeTruthy();
    expect(screen.getByText(/Nothing finished yet/)).toBeTruthy();
  });

  it('and says nothing of the kind once one has', async () => {
    load([won('s1')]);
    await renderScreen(<DashboardScreen />);

    expect(screen.queryByText(/Nothing finished yet/)).toBeNull();
  });
});
