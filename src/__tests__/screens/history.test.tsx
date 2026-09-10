/**
 * The session list: what it shows, what the filters do to it, and how much of
 * it is actually mounted.
 *
 * The last of those is the reason this file exists. The list renders every
 * session the player has ever logged, and the data layer is built explicitly
 * for a log that grows for years -- so the screen was mounting a component per
 * session with nothing to stop it. Virtualizing that is a change to how the
 * list is built rather than to what it does, which is exactly the kind of
 * change that wants tests written first.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session, sessions, venue } from '../support/sessions';
import HistoryScreen from '../../../app/(tabs)/history';
import { useLogStore } from '../../store/useLogStore';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const load = (state: Partial<ReturnType<typeof useLogStore.getState>>) =>
  useLogStore.setState({ status: 'ready', sessions: [], venues: [], ...state });

beforeEach(() => {
  mockPush.mockClear();
  load({});
});

describe('the session list', () => {
  it('says how many sessions are in view', async () => {
    load({ sessions: sessions(3) });
    await renderScreen(<HistoryScreen />);
    expect(screen.getByText('3 sessions')).toBeTruthy();
  });

  it('counts one session in the singular', async () => {
    load({ sessions: sessions(1) });
    await renderScreen(<HistoryScreen />);
    expect(screen.getByText('1 session')).toBeTruthy();
  });

  it('shows a session it has, by the room it was played in', async () => {
    load({ sessions: [session('s1', { venue: venue('v9', 'Bellagio') })] });
    await renderScreen(<HistoryScreen />);
    expect(screen.getByText('Bellagio')).toBeTruthy();
  });

  it('opens the session that was tapped', async () => {
    load({ sessions: [session('s-tapped', { venue: venue('v9', 'Bellagio') })] });
    await renderScreen(<HistoryScreen />);

    await userEvent.press(screen.getByText('Bellagio'));
    expect(mockPush).toHaveBeenCalledWith('/session/s-tapped');
  });

  it('offers to start one when there is nothing logged at all', async () => {
    await renderScreen(<HistoryScreen />);
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
  });

  it('and says something different when the filters are what emptied it', async () => {
    // The distinction is the whole point of the two messages: "go play some
    // poker" is wrong advice for somebody with a year of sessions behind a
    // filter that matches none of them.
    load({ sessions: sessions(5) });
    await renderScreen(<HistoryScreen />);

    await userEvent.press(screen.getByText('PLO'));
    expect(screen.getByText('No sessions match')).toBeTruthy();
    expect(screen.queryByText('Nothing logged yet')).toBeNull();
  });

  it('narrows to the game that was picked', async () => {
    load({
      sessions: [
        session('a', { gameType: 'NLHE', venue: venue('v1', 'Aria') }),
        session('b', { gameType: 'PLO', venue: venue('v2', 'Bellagio') }),
      ],
    });
    await renderScreen(<HistoryScreen />);
    expect(screen.getByText('2 sessions')).toBeTruthy();

    await userEvent.press(screen.getByText('PLO'));
    expect(screen.getByText('1 session')).toBeTruthy();
    expect(screen.getByText('Bellagio')).toBeTruthy();
    expect(screen.queryByText('Aria')).toBeNull();
  });
});

describe('how much of the list is mounted', () => {
  it('does not mount a row for every session in a long history', async () => {
    // Five years of a heavy live player. The data layer is designed for this
    // and the list was not: every one of these used to become a mounted
    // component, on a screen that is one of four tabs and stays mounted.
    load({ sessions: sessions(600) });
    await renderScreen(<HistoryScreen />);

    // The count above the list is computed from all of them and is not the
    // question here; what is mounted below it is.
    expect(screen.getByText('600 sessions')).toBeTruthy();
    expect(screen.queryAllByTestId('session-row').length).toBeLessThan(100);
  });

  it('still mounts the ones at the top, so the screen is not merely empty', async () => {
    load({ sessions: sessions(600) });
    await renderScreen(<HistoryScreen />);
    expect(screen.queryAllByTestId('session-row').length).toBeGreaterThan(0);
  });
});
