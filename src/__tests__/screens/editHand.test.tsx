/**
 * Fixing a hand that was logged wrong.
 *
 * The repository and the store have been able to update and delete a hand
 * since they were written, and both are covered by their own tests. Nothing on
 * screen called either: `HandRow` took an `onPress` no caller passed, and the
 * row was not pressable anyway, so a hand logged with the wrong cards stayed
 * wrong for as long as the log lasted.
 *
 * These are about the screen that fixes it, which is the screen that logs one
 * with an `id` on the route. Three things matter and they are what is asserted
 * here: it opens on what was logged rather than on an empty form, it writes
 * over the hand rather than adding a second one, and it reads its session from
 * the hand rather than from whatever is live -- because a hand being corrected
 * is usually from a night that ended weeks ago.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import LogHandScreen from '../../../app/session/hand';
import { useLogStore } from '../../store/useLogStore';
import type { Hand } from '../../domain/types';

const params: { id?: string } = { id: 'h1' };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => params,
}));

const back = jest.requireMock('expo-router').router.back as jest.Mock;

/** What the repository holds, keyed by id, for `useHandById` to read. */
const held: { hands: Hand[] } = { hands: [] };

jest.mock('../../data', () => ({
  getRepository: async () => ({
    getHand: async (id: string) => held.hands.find((hand) => hand.id === id) ?? null,
    listHands: async () => held.hands,
  }),
  onSyncApplied: () => () => undefined,
}));

const T0 = Date.UTC(2026, 0, 1);

const hand = (over: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  sessionId: 's1',
  holeCards: 'AsKd',
  board: null,
  position: 'BTN',
  note: 'Ran into aces.',
  tags: ['cooler'],
  amount: -12_000,
  at: T0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const updated: { id: string; patch: Record<string, unknown> }[] = [];
const deleted: string[] = [];

const load = (
  rows: Hand[],
  over: Partial<ReturnType<typeof useLogStore.getState>> = {},
) => {
  params.id = 'h1';
  held.hands = rows;
  back.mockClear();
  updated.length = 0;
  deleted.length = 0;
  useLogStore.setState({
    status: 'ready',
    // No live session: the ordinary case is a hand from a night that is over.
    activeSession: null,
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: rows.length,
    handsVersion: 0,
    updateHand: (async (id: string, patch: Record<string, unknown>) => {
      updated.push({ id, patch });
    }) as never,
    deleteHand: (async (id: string) => {
      deleted.push(id);
    }) as never,
    logHand: (async () => {
      throw new Error('editing must never create a second hand');
    }) as never,
    ...over,
  });
};

describe('opening a hand that was logged wrong', () => {
  it('shows what was logged rather than an empty form', async () => {
    load([hand()]);
    await renderScreen(<LogHandScreen />);

    expect(await screen.findByDisplayValue('Ran into aces.')).toBeTruthy();
    expect(screen.getByText('Edit hand')).toBeTruthy();
  });

  it('and says it is editing, not logging', async () => {
    // The two screens are otherwise identical, and a form that silently
    // overwrites is worse than one that says it will.
    load([hand()]);
    await renderScreen(<LogHandScreen />);

    expect(await screen.findByText('Save changes')).toBeTruthy();
    expect(screen.queryByText('Save hand')).toBeNull();
  });

  it('opens the pot swing already showing, because there is one', async () => {
    // It is behind a disclosure when logging, which is right for a hand nobody
    // has typed yet and wrong for one that already carries a number: collapsed
    // means "not logged", and the save would then take it back out.
    load([hand({ amount: -12_000 })]);
    await renderScreen(<LogHandScreen />);

    expect(await screen.findByDisplayValue('-120')).toBeTruthy();
  });

  it('and the board too, on a hand that has one', async () => {
    load([hand({ board: 'AhKsQd' })]);
    await renderScreen(<LogHandScreen />);

    expect(await screen.findByText('Stop at the flop if that is where the hand did.')).toBeTruthy();
  });

  it('says so plainly when the hand is gone', async () => {
    // Deleted in another tab, or on another device and synced away while this
    // was open. An empty form here would write the hand back.
    load([]);
    await renderScreen(<LogHandScreen />);

    expect(await screen.findByText('Hand not found')).toBeTruthy();
  });
});

describe('saving the correction', () => {
  it('writes over the hand instead of logging a second one', async () => {
    // `logHand` throws in this suite, so creating one fails the test loudly.
    load([hand()]);
    await renderScreen(<LogHandScreen />);

    await userEvent.type(await screen.findByLabelText('Hand note'), ' Again.');
    await userEvent.press(screen.getByText('Save changes'));

    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('h1');
    expect(updated[0].patch.note).toBe('Ran into aces. Again.');
  });

  it('keeps the fields nobody touched', async () => {
    load([hand()]);
    await renderScreen(<LogHandScreen />);

    await userEvent.type(await screen.findByLabelText('Hand note'), '!');
    await userEvent.press(screen.getByText('Save changes'));

    expect(updated[0].patch).toMatchObject({
      holeCards: 'AsKd',
      position: 'BTN',
      tags: ['cooler'],
      amount: -12_000,
    });
  });

  it('and goes back, rather than offering a reset', async () => {
    // The table offer belongs to the minute after a hand happened. A cooler
    // being corrected three weeks later is not that minute.
    load([hand({ tags: ['cooler'] })]);
    await renderScreen(<LogHandScreen />);

    await userEvent.type(await screen.findByLabelText('Hand note'), '!');
    await userEvent.press(screen.getByText('Save changes'));

    expect(back).toHaveBeenCalled();
    expect(screen.queryByText('That one is logged.')).toBeNull();
  });

  it('says so when the write fails, and stays put', async () => {
    load([hand()], {
      updateHand: (async () => {
        throw new Error('The database is full.');
      }) as never,
    });
    await renderScreen(<LogHandScreen />);

    await userEvent.type(await screen.findByLabelText('Hand note'), '!');
    await userEvent.press(screen.getByText('Save changes'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

describe('deleting the hand', () => {
  it('asks first', async () => {
    load([hand()]);
    await renderScreen(<LogHandScreen />);

    await userEvent.press(await screen.findByText('Delete hand'));
    expect(screen.getByText('Delete this hand? This can’t be undone.')).toBeTruthy();
    expect(deleted).toHaveLength(0);
  });

  it('and deletes it once asked twice', async () => {
    load([hand()]);
    await renderScreen(<LogHandScreen />);

    await userEvent.press(await screen.findByText('Delete hand'));
    await userEvent.press(screen.getByText('Delete'));

    expect(deleted).toEqual(['h1']);
    expect(back).toHaveBeenCalled();
  });

  it('offers nothing to delete when logging a new hand', async () => {
    load([hand()]);
    delete params.id;
    useLogStore.setState({ activeSession: session('s1') });
    await renderScreen(<LogHandScreen />);

    expect(screen.queryByText('Delete hand')).toBeNull();
  });
});

describe('the session the hand belongs to', () => {
  it('is the hand’s own, not whatever happens to be live', async () => {
    // A PLO hand being corrected during a hold'em session still has four hole
    // cards, and the picker has to keep asking for them.
    load([hand({ sessionId: 'plo-night', holeCards: 'AsKdQcJh' })], {
      activeSession: session('holdem-now', { gameType: 'NLHE' }),
      sessions: [
        session('holdem-now', { gameType: 'NLHE' }),
        session('plo-night', { gameType: 'PLO' }),
      ],
    });
    await renderScreen(<LogHandScreen />);

    // Four filled slots, which only a PLO session asks the picker for. Reading
    // the live NLHE session instead would give two, and the two cards past
    // them would be gone the moment this saved.
    expect(await screen.findByLabelText('A of spades, tap to remove')).toBeTruthy();
    expect(screen.getByLabelText('K of diamonds, tap to remove')).toBeTruthy();
    expect(screen.getByLabelText('Q of clubs, tap to remove')).toBeTruthy();
    expect(screen.getByLabelText('J of hearts, tap to remove')).toBeTruthy();
  });
});
