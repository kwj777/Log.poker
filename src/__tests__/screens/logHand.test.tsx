/**
 * Logging a hand, and the board that is now optional on it.
 *
 * The rule this screen is built around is that the default path does not get
 * slower: two cards, a tag, a line, save. The board sits behind a disclosure
 * beside the pot swing, which was already there and already optional, so the
 * hand somebody logs at a table is the hand they logged before.
 *
 * What is worth testing is the two ways it can go wrong: a board that repeats
 * a card the player is holding, and a board that is one or two cards, which is
 * not an early runout but somebody who stopped tapping.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import LogHandScreen from '../../../app/session/hand';
import { useLogStore } from '../../store/useLogStore';

const mockLogged: unknown[] = [];

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

/** Two taps: the rank, then that rank in a suit. */
const pickCard = async (rank: string, suitLabel: string) => {
  await userEvent.press(screen.getByLabelText(`Rank ${rank}`));
  await userEvent.press(screen.getByLabelText(`${rank} of ${suitLabel}`));
};

beforeEach(() => {
  mockLogged.length = 0;
  useLogStore.setState({
    status: 'ready',
    activeSession: session('s1'),
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    logHand: (async (input: unknown) => {
      mockLogged.push(input);
      return { id: 'h1' };
    }) as never,
  });
});

describe('the board is optional', () => {
  it('is not asked for until it is asked for', async () => {
    await renderScreen(<LogHandScreen />);
    expect(screen.getByText('Board (optional)')).toBeTruthy();
    // Collapsed: no slots on screen until the player opens it.
    expect(screen.queryByLabelText('Card 5, empty')).toBeNull();
  });

  it('saves a hand without one, which is the ordinary hand', async () => {
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByText('Save hand'));

    expect(mockLogged).toHaveLength(1);
    expect(mockLogged[0]).toMatchObject({ holeCards: 'AsKd', board: null });
  });

  it('and carries one when it was opened and filled', async () => {
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');

    await userEvent.press(screen.getByLabelText('Add a board'));
    await pickCard('7', 'clubs');
    await pickCard('2', 'spades');
    await pickCard('K', 'hearts');
    await userEvent.press(screen.getByText('Save hand'));

    expect(mockLogged[0]).toMatchObject({ holeCards: 'AsKd', board: '7c2sKh' });
  });
});

describe('what the board refuses', () => {
  it('will not deal a card the player is already holding', async () => {
    // One deck. `parseNotation` refuses a repeat inside one string and cannot
    // see across two, so the board has to be told the hole cards.
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByLabelText('Add a board'));

    await userEvent.press(screen.getByLabelText('Rank A'));
    expect(screen.getByLabelText('A of spades')).toBeDisabled();
    // The other three aces are still there to take.
    expect(screen.getByLabelText('A of hearts')).not.toBeDisabled();
  });

  it('holds the save while the board is half typed', async () => {
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByLabelText('Add a board'));
    await pickCard('7', 'clubs');

    expect(
      screen.getByText('A board is three cards, four or five. Add the rest of the flop, or clear it.'),
    ).toBeTruthy();
    await userEvent.press(screen.getByText('Save hand'));
    expect(mockLogged).toHaveLength(0);
  });

  it('and lets it go once the flop is whole', async () => {
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByLabelText('Add a board'));
    await pickCard('7', 'clubs');
    await pickCard('2', 'spades');
    await pickCard('K', 'hearts');

    await userEvent.press(screen.getByText('Save hand'));
    expect(mockLogged).toHaveLength(1);
    expect(mockLogged[0]).toMatchObject({ board: '7c2sKh' });
  });

  it('forgets a board the player collapsed, because they took it back', async () => {
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByLabelText('Add a board'));
    await pickCard('7', 'clubs');
    await pickCard('2', 'spades');
    await pickCard('K', 'hearts');
    await userEvent.press(screen.getByLabelText('Hide the board'));

    await userEvent.press(screen.getByText('Save hand'));
    expect(mockLogged[0]).toMatchObject({ board: null });
  });
});
