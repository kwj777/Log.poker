/**
 * What the New session screen claims its form was filled in from.
 *
 * `deriveDefaults` answers an empty log with `STARTER_DEFAULTS` -- $1/$2 NLHE,
 * a $300 buy-in, USD -- and a log with anything in it with a copy of the
 * newest session. Its own header draws the line: "the defaults come from their
 * last session, and only a first-time user sees generic ones."
 *
 * The screen has to draw the same line, because it is the screen that says
 * out loud where the numbers came from, and it is the first one behind the
 * empty state's primary button.
 */

import { screen } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import NewSessionScreen from '../../../app/session/new';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

jest.mock('../../auth', () => ({
  getSession: async () => null,
  hasPass: () => false,
}));

const load = (sessions: ReturnType<typeof session>[]) =>
  useLogStore.setState({
    status: 'ready',
    sessions,
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });

describe('a player who has logged nothing', () => {
  it('is not told the form holds their last session', async () => {
    // It held $1/$2 NLHE and a $300 buy-in, which are constants in
    // `defaults.ts`, and the sentence over them said they were history.
    load([]);
    await renderScreen(<NewSessionScreen />);

    expect(screen.queryByText(/your last session/i)).toBeNull();
    expect(screen.getByText(/common live game/i)).toBeTruthy();
    // The values the sentence is about, so this cannot pass by the screen
    // having quietly stopped pre-filling anything.
    expect(screen.getByText('$1/$2')).toBeTruthy();
  });
});

describe('a player who has logged one', () => {
  it('is told exactly that, because now it is true', async () => {
    load([
      session('s1', {
        buyIn: 100_000,
        cashOut: 120_000,
        stakes: { smallBlind: 500, bigBlind: 1_000 },
      }),
    ]);
    await renderScreen(<NewSessionScreen />);

    expect(screen.getByText(/your last session/i)).toBeTruthy();
    expect(screen.queryByText(/common live game/i)).toBeNull();
    expect(screen.getByText('$5/$10')).toBeTruthy();
  });
});
