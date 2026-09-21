/**
 * Every hand, which had nowhere to be read.
 *
 * Logging a hand is the most expensive thing Log asks for, and all of it was
 * read back by exactly one kind of screen: the one about a single session. So
 * there was no way to see your hands, and `position` was collected on every
 * hand and read by nothing anywhere in the app.
 *
 * What is worth pinning is the retrieval, since that is the point: the filters
 * narrow to the hand somebody is looking for, and tapping it opens the screen
 * that can change it. Plus the three empty states, because "the read has not
 * landed" and "you have logged none" want opposite things on screen and used
 * to be the same thing.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session, venue } from '../support/sessions';
import HandsScreen from '../../../app/hands';
import { useLogStore } from '../../store/useLogStore';
import type { Hand } from '../../domain/types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  },
}));

// `mock`-prefixed so the factory below may reach it: babel hoists jest.mock
// above the declarations, and that prefix is the escape hatch for a handle the
// factory and the tests both need.
const mockRepository = { listHands: jest.fn() };

jest.mock('../../data', () => ({
  getRepository: async () => mockRepository,
  onSyncApplied: () => () => undefined,
}));

const T0 = Date.UTC(2026, 2, 14, 19, 30);
const DAY = 86_400_000;

const hand = (over: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  sessionId: 's1',
  holeCards: 'AsKd',
  board: null,
  position: null,
  note: null,
  tags: [],
  amount: null,
  at: T0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

/**
 * A filter chip, by role.
 *
 * The chip and the thing it filters for often carry the same words -- the tag
 * chip says "bad beat" and so does the pill on every row it matches -- so a
 * plain text query finds both. The chip is the only one of the two that is a
 * button.
 */
const chip = (label: string) => screen.getByRole('button', { name: label });

const load = (hands: Hand[]) => {
  mockRepository.listHands.mockImplementation(async () => hands);
  mockPush.mockClear();
  useLogStore.setState({
    status: 'ready',
    sessions: [
      session('s1', { venueId: 'v1', venue: venue('v1', 'Aria') }),
      session('s2', { venueId: 'v2', venue: venue('v2', 'Bellagio') }),
    ],
    venues: [venue('v1', 'Aria'), venue('v2', 'Bellagio')],
    moodEntries: [],
    activeSession: null,
    handCount: hands.length,
    handsVersion: 0,
  });
};

describe('the list itself', () => {
  it('shows every hand, not one session worth', async () => {
    load([
      hand({ id: 'a', sessionId: 's1', holeCards: 'AsKd' }),
      hand({ id: 'b', sessionId: 's2', holeCards: 'QhQc' }),
    ]);
    await renderScreen(<HandsScreen />);
    expect(await screen.findByText('2 hands')).toBeTruthy();
  });

  it('counts one hand in the singular', async () => {
    load([hand()]);
    await renderScreen(<HandsScreen />);
    expect(await screen.findByText('1 hand')).toBeTruthy();
  });

  it('opens the hand that was tapped, on the screen that can change it', async () => {
    load([hand({ id: 'a', note: 'Flopped a set and lost it' })]);
    await renderScreen(<HandsScreen />);

    await userEvent.press(await screen.findByText('Flopped a set and lost it'));
    expect(mockPush).toHaveBeenCalledWith('/session/hand?id=a');
  });

  it('puts the newest first, since that is the one being looked for', async () => {
    load([
      hand({ id: 'old', note: 'Older hand', at: T0 - 5 * DAY }),
      hand({ id: 'new', note: 'Newer hand', at: T0 }),
    ]);
    const view = await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    const notes = view.getAllByText(/hand$/);
    expect(notes[0]).toHaveTextContent('Newer hand');
  });
});

describe('finding one hand in a season of them', () => {
  it('narrows to a tag', async () => {
    load([
      hand({ id: 'a', tags: ['bad_beat'], note: 'The bad one' }),
      hand({ id: 'b', tags: ['bluff'], note: 'The bluff' }),
    ]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    await userEvent.press(chip('bad beat'));
    expect(screen.getByText('1 hand')).toBeTruthy();
    expect(screen.queryByText('The bluff')).toBeNull();
  });

  it('and to a seat, which nothing in the app could do before', async () => {
    load([
      hand({ id: 'a', position: 'BTN', note: 'On the button' }),
      hand({ id: 'b', position: 'BB', note: 'In the big blind' }),
    ]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    await userEvent.press(chip('BTN'));
    expect(screen.getByText('1 hand')).toBeTruthy();
    expect(screen.queryByText('In the big blind')).toBeNull();
  });

  it('and to the room it was played in, which lives on the session', async () => {
    load([
      hand({ id: 'a', sessionId: 's1', note: 'At Aria' }),
      hand({ id: 'b', sessionId: 's2', note: 'At Bellagio' }),
    ]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    await userEvent.press(chip('Bellagio'));
    expect(screen.getByText('1 hand')).toBeTruthy();
    expect(screen.queryByText('At Aria')).toBeNull();
  });

  it('and hands the filters back when they have emptied the list', async () => {
    load([hand({ id: 'a', tags: ['bad_beat'] })]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('1 hand');

    await userEvent.press(chip('bluff'));
    expect(screen.getByText('No hands match')).toBeTruthy();

    await userEvent.press(chip('Clear filters'));
    expect(screen.getByText('1 hand')).toBeTruthy();
  });
});

describe('the three ways it can be empty', () => {
  it('says nothing at all while the read is outstanding', async () => {
    // An empty state drawn during the read is one that flashes and then
    // fills, which reads as a bug on a log that has hands in it.
    load([]);
    // A read that never answers, which is what a slow database looks like.
    mockRepository.listHands.mockImplementation(() => new Promise<Hand[]>(() => undefined));
    await renderScreen(<HandsScreen />);
    expect(screen.queryByText('No hands logged yet')).toBeNull();
    expect(screen.queryByText('No hands match')).toBeNull();
  });

  it('tells a player with none where hands are logged from', async () => {
    load([]);
    await renderScreen(<HandsScreen />);
    expect(await screen.findByText('No hands logged yet')).toBeTruthy();
  });

  it('and says something different when the filters are what emptied it', async () => {
    load([hand({ id: 'a', position: 'BTN' })]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('1 hand');

    await userEvent.press(chip('UTG'));
    expect(screen.getByText('No hands match')).toBeTruthy();
  });
});

/**
 * Finding one hand by what was written about it.
 *
 * The note on a hand is the one field a player writes in their own words, and
 * it was readable only on the session that hand belongs to. The cards are
 * searchable too, because somebody who remembers the hand remembers the hand.
 */
describe('searching the hands', () => {
  const box = () => screen.getByLabelText('Search hands');

  it('finds one by its note', async () => {
    load([
      hand({ id: 'a', note: 'Flopped a set and lost it' }),
      hand({ id: 'b', note: 'Folded the river' }),
    ]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    await userEvent.type(box(), 'set');
    expect(screen.getByText('1 hand')).toBeTruthy();
  });

  it('and by the cards, which is how somebody remembers a hand', async () => {
    load([
      hand({ id: 'a', holeCards: 'AsKd', note: 'The big one' }),
      hand({ id: 'b', holeCards: 'QhQc', note: 'The other one' }),
    ]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    await userEvent.type(box(), 'qhqc');
    expect(screen.getByText('1 hand')).toBeTruthy();
    expect(screen.queryByText('The big one')).toBeNull();
  });

  it('and by the board, for the runout that made the night', async () => {
    load([
      hand({ id: 'a', board: '7c2sKh', note: 'On that board' }),
      hand({ id: 'b', board: null, note: 'No board' }),
    ]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('2 hands');

    await userEvent.type(box(), '7c2s');
    expect(screen.getByText('1 hand')).toBeTruthy();
  });

  it('counts as a filter, so Clear filters empties it too', async () => {
    load([hand({ id: 'a', note: 'Flopped a set' })]);
    await renderScreen(<HandsScreen />);
    await screen.findByText('1 hand');

    await userEvent.type(box(), 'nothing matches');
    expect(screen.getByText('No hands match')).toBeTruthy();

    await userEvent.press(chip('Clear filters'));
    expect(screen.getByText('1 hand')).toBeTruthy();
  });
});
