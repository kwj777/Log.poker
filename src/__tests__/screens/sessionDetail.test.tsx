/**
 * One session, its numbers, and its hands.
 *
 * The hands are the reason this exists. They used to come from an array of
 * every hand in the log, held in the store so that one line of Settings could
 * count it, and filtered here -- which is what made a hand write the most
 * expensive write in the app. They are read per session now, which means the
 * screen renders at least once before it has them.
 *
 * That gap is the thing to be careful about, and the last two tests are about
 * it: "no hands logged for this session" is a true sentence about a session
 * with no hands and a false one about a session whose hands have not arrived,
 * and they are one frame apart.
 */

import { screen } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import type { Hand } from '../../domain/types';
import SessionDetailScreen from '../../../app/session/[id]';
import { useLogStore } from '../../store/useLogStore';

const viewing = { id: 's1' };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: viewing.id }),
}));

/**
 * The hook reads through the repository now, so the mock has to answer.
 *
 * `held` is what the database contains; `gate` holds the read open when a test
 * wants to see the screen before its hands arrive.
 */
const held: { hands: Hand[]; gate: Promise<void> | null } = { hands: [], gate: null };

jest.mock('../../data', () => ({
  getRepository: async () => ({
    listHands: async (sessionId?: string) => {
      if (held.gate) await held.gate;
      return held.hands.filter((h) => sessionId === undefined || h.sessionId === sessionId);
    },
  }),
  onSyncApplied: () => () => undefined,
}));

const T0 = Date.UTC(2026, 0, 1);

const hand = (id: string, over: Partial<Hand> = {}): Hand => ({
  id,
  sessionId: 's1',
  holeCards: 'AsKd',
  position: 'BTN',
  note: null,
  tags: [],
  amount: 12_000,
  at: T0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const load = (hands: Hand[]) => {
  viewing.id = 's1';
  held.hands = hands;
  held.gate = null;
  useLogStore.setState({
    status: 'ready',
      sessions: [session('s1'), session('s2')],
    venues: [],
    moodEntries: [],
    handCount: hands.length,
    handsVersion: 0,
  });
};

describe('a session and its hands', () => {
  it('counts the hands belonging to this session', async () => {
    load([hand('h1'), hand('h2')]);
    await renderScreen(<SessionDetailScreen />);
    expect(screen.getByText('Hands (2)')).toBeTruthy();
  });

  it('and counts only this session, not every hand in the log', async () => {
    // The hook asks for one session's hands. If it ever stops passing the id
    // through, this is the assertion that notices.
    load([hand('h1'), hand('elsewhere', { sessionId: 's-other' })]);
    await renderScreen(<SessionDetailScreen />);
    expect(screen.getByText('Hands (1)')).toBeTruthy();
  });

  it('shows the cards that were logged, in the notation the app reads back', async () => {
    load([hand('h1', { holeCards: 'AsKd' })]);
    await renderScreen(<SessionDetailScreen />);
    expect(screen.getByText('A\u2660 K\u2666')).toBeTruthy();
  });

  it('and a dash where a hand was logged without them', async () => {
    load([hand('h1', { holeCards: null })]);
    await renderScreen(<SessionDetailScreen />);
    expect(screen.getByText('--')).toBeTruthy();
  });

  it('says so plainly when no hands were logged', async () => {
    load([]);
    await renderScreen(<SessionDetailScreen />);
    expect(screen.getByText('No hands logged for this session.')).toBeTruthy();
    expect(screen.getByText('Hands (0)')).toBeTruthy();
  });
});

describe('before the hands have been read', () => {
  it('does not claim there are none', async () => {
    // The wrong sentence, one frame early. A player opening a session with
    // twenty hands in it must never be told it has none.
    load([hand('h1'), hand('h2')]);
    let open: () => void = () => undefined;
    held.gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    await renderScreen(<SessionDetailScreen />);
    expect(screen.queryByText('No hands logged for this session.')).toBeNull();
    expect(screen.queryByText('Hands (0)')).toBeNull();

    // Let the read finish inside the test rather than after it, so the state
    // it sets is not an update landing on a torn-down tree.
    open();
    expect(await screen.findByText('Hands (2)')).toBeTruthy();
  });

  it('and shows them once the read lands', async () => {
    load([hand('h1'), hand('h2')]);
    let open: () => void = () => undefined;
    held.gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    await renderScreen(<SessionDetailScreen />);
    open();
    expect(await screen.findByText('Hands (2)')).toBeTruthy();
  });
});

describe('moving from one session to another', () => {
  it('never shows the hands that belonged to the last one', async () => {
    // The hazard the derived answer removes. Holding the hands in state and
    // replacing them when the next read lands means a render in between where
    // this session is described by the previous session's hands -- and the two
    // are indistinguishable on screen, because a hand does not say which
    // session it came from.
    load([
      hand('h1', { sessionId: 's1' }),
      hand('h2', { sessionId: 's1' }),
      hand('other', { sessionId: 's2' }),
    ]);

    const view = await renderScreen(<SessionDetailScreen />);
    expect(await screen.findByText('Hands (2)')).toBeTruthy();

    // The next session's read is held open, so this is exactly the window.
    let open: () => void = () => undefined;
    held.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    viewing.id = 's2';
    await view.rerender(<SessionDetailScreen />);

    expect(screen.queryByText('Hands (2)')).toBeNull();

    open();
    expect(await screen.findByText('Hands (1)')).toBeTruthy();
  });
});
