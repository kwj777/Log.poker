/**
 * Getting off the live session screen without ending the night.
 *
 * The live session is the one screen in the app that the tab bar does not
 * reach and that drew no control of its own to leave by. Every other stack
 * screen has one -- session detail, edit, the hand form, import, the hands
 * list -- and this one had a single footer button, "Cash out & end session".
 * So opening a running session to check the clock, or to count the rebuys,
 * meant ending the session to get out of it again.
 *
 * The way out has to leave the session running, which is the whole point of
 * it, so that is asserted too: nothing here may reach `endSession`. The
 * dashboard's own "Resume session" button is what brings the player back.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import ActiveSessionScreen from '../../../app/session/active';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  useLocalSearchParams: () => ({}),
}));

const { back, replace, canGoBack } = jest.requireMock('expo-router').router as {
  back: jest.Mock;
  replace: jest.Mock;
  canGoBack: jest.Mock;
};

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

/** Signed out. The check-in card on this screen asks on mount and has to be answered. */
jest.mock('../../auth', () => ({
  getSession: async () => null,
  hasPass: () => false,
}));

const endSession = jest.fn();

const live = (): void => {
  back.mockClear();
  replace.mockClear();
  endSession.mockClear();
  canGoBack.mockReturnValue(true);
  useLogStore.setState({
    status: 'ready',
    activeSession: session('s1'),
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    endSession: endSession as never,
  });
};

describe('a session that is still running', () => {
  it('can be left, which it could not be', async () => {
    live();
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Back'));

    expect(back).toHaveBeenCalled();
    // The half that makes it a way out rather than a way to lose the night.
    expect(endSession).not.toHaveBeenCalled();
  });

  it('and lands on the dashboard when there is nothing behind it', async () => {
    // Which is the ordinary case: starting a session `replace`s the form with
    // this screen, so the entry that was pushed is gone by the time anybody
    // is looking for a way back.
    live();
    canGoBack.mockReturnValue(false);
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Back'));

    expect(replace).toHaveBeenCalledWith('/');
    expect(endSession).not.toHaveBeenCalled();
  });
});
