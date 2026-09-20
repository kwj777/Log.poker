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

import { router } from 'expo-router';

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
    tableOfferMadeAt: null,
  });
  (router.back as jest.Mock).mockClear();
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

/**
 * The one hand in a session that does not leave on the way it arrived.
 *
 * Rendered rather than read, because what matters here is the order of two
 * things that happen inside one tap: the hand is written, and only then is
 * anybody offered anything. `handOffs.test.ts` pins that order in the source;
 * this pins that it is what the screen actually does, with a real store and a
 * real renderer in front of it.
 */
describe('the reset offered after a hand the game did to you', () => {
  const tagAndSave = async (label: string) => {
    await renderScreen(<LogHandScreen />);
    await userEvent.press(screen.getByText(label));
    await userEvent.press(screen.getByText('Save hand'));
  };

  it('writes the hand first, and only then offers anything', async () => {
    await tagAndSave('bad beat');
    // The hand is in the log whatever happens next, which is the whole safety
    // of putting a card in this path at all.
    expect(mockLogged).toHaveLength(1);
    expect(mockLogged[0]).toMatchObject({ tags: ['bad_beat'] });
    expect(screen.getByText('That one is logged.')).toBeTruthy();
    expect(screen.getByText('Pick a reset')).toBeTruthy();
  });

  it('and holds the screen rather than navigating out from under it', async () => {
    await tagAndSave('cooler');
    expect(router.back).not.toHaveBeenCalled();
    // The way out is on the card, one tap, no different from Cancel.
    await userEvent.press(screen.getByText('Back to the game'));
    expect(router.back).toHaveBeenCalled();
  });

  it('says nothing after a hand the player thinks they misplayed', async () => {
    // That tag is about their own decision and the dashboard already keeps the
    // app's promise about it, by handing the hand to TiltProof a day later.
    await tagAndSave('misplayed?');
    expect(mockLogged).toHaveLength(1);
    expect(screen.queryByText('That one is logged.')).toBeNull();
    expect(router.back).toHaveBeenCalled();
  });

  it('nor after an ordinary hand, which is most of them', async () => {
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByText('Save hand'));
    expect(screen.queryByText('That one is logged.')).toBeNull();
    expect(router.back).toHaveBeenCalled();
  });

  it('and only once, however the rest of the night goes', async () => {
    // A player taking three bad beats in an hour is who this is for and who a
    // repeat would drive away.
    useLogStore.setState({ tableOfferMadeAt: Date.now() });
    await tagAndSave('bad beat');
    expect(mockLogged).toHaveLength(1);
    expect(screen.queryByText('That one is logged.')).toBeNull();
    expect(router.back).toHaveBeenCalled();
  });
});
