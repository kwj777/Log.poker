/**
 * The flagged-hand review card, on the dashboard.
 *
 * Three ways this could be wrong, and all three are about what reaches the
 * screen rather than about what the prompt computes:
 *
 *  - It could appear at a table. `HandRow` hides its drill link during a live
 *    session because sending somebody to a training app mid-hand is the last
 *    thing this app should do, and a dashboard card that ignored that would be
 *    the same mistake on a bigger surface.
 *  - It could appear on an ordinary night, which is most nights, and become
 *    the badge-and-interstitial clutter `FamilyCrossPromo` promises this app
 *    does not do.
 *  - It could send a player to the wrong hand, or to an address TiltProof does
 *    not serve, neither of which raises anything on this side.
 *
 * Rendered rather than read as source, for the reason `postSessionReset`'s
 * tests are: all three are about the screen. What the card *says*, and which
 * flagged hand it leads with, are pinned in
 * `features/family/__tests__/reviewPrompt.test.ts` beside the functions that
 * decide them.
 */

import { Linking } from 'react-native';
import { act, screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import DashboardScreen from '../../../app/(tabs)/index';
import type { Hand, HandTag } from '../../domain/types';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

/** The hands the repository hands back for whichever session is asked for. */
const stored: { hands: Hand[] } = { hands: [] };

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => stored.hands }),
  onSyncApplied: () => () => undefined,
}));

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Read before the timers are faked, so `load` states its case against it. */
const REAL_NOW = Date.now();

const hand = (over: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  sessionId: 's1',
  holeCards: 'AsKd',
  board: 'Kh7d2c',
  position: 'BTN',
  note: null,
  tags: ['misplayed'] as HandTag[],
  amount: null,
  at: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

/**
 * A dashboard with one finished session that ended `endedAgo` ago.
 *
 * The clock is the real one rather than a frozen fixture, and every case here
 * is stated relative to now, which is how the window is stated too.
 */
const load = (over: { endedAgo?: number; live?: boolean; hands?: Hand[] } = {}) => {
  const endedAt = Date.now() - (over.endedAgo ?? HOUR);
  const finished = session('s1', { startedAt: endedAt - 4 * HOUR, endedAt });
  const active = over.live
    ? session('s2', { startedAt: Date.now() - HOUR, endedAt: null, cashOut: null })
    : null;

  stored.hands = over.hands ?? [hand()];
  useLogStore.setState({
    status: 'ready',
    sessions: active === null ? [finished] : [active, finished],
    venues: [],
    moodEntries: [],
    activeSession: active,
    handsVersion: 0,
  });
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('the flagged-hand review card', () => {
  it('offers the hands the player flagged on the night they just finished', async () => {
    load({ hands: [hand(), hand({ id: 'h2', holeCards: 'QhQs' })] });
    await renderScreen(<DashboardScreen />);

    expect(await screen.findByText('You flagged 2 hands')).toBeTruthy();
  });

  it('says nothing on an ordinary night, which is most of them', async () => {
    // Nothing dismisses this card, so the silence has to be the default rather
    // than something the player earns by tapping it away.
    load({ hands: [hand({ tags: [] }), hand({ id: 'h2', tags: ['cooler'] })] });
    await renderScreen(<DashboardScreen />);

    expect(screen.queryByText(/You flagged/)).toBeNull();
  });

  it('stays off the screen while a session is running', async () => {
    // The same rule as `HandRow`'s `showDrillLink`, on a bigger surface. The
    // flagged hand is still there afterwards; a player at a table is not.
    load({ live: true });
    await renderScreen(<DashboardScreen />);

    expect(screen.queryByText(/You flagged/)).toBeNull();
  });

  it('goes quiet once the session is past the window, with nothing to dismiss', async () => {
    // This is the whole no-nagging argument, and it is the one thing here that
    // cannot be checked by looking at the card: it is checked by waiting.
    load({ endedAgo: 8 * DAY });
    await renderScreen(<DashboardScreen />);

    expect(screen.queryByText(/You flagged/)).toBeNull();
  });

  it('and goes quiet under a screen that is already open, rather than at the next launch', async () => {
    // The dashboard used to read the clock once on mount, under a comment
    // saying "the one boundary it could cross is a week away". The boundary is
    // a week from the session's end, so what is left of it is whatever is
    // left. `(tabs)` never unmounts a screen it has focused, so a card shown
    // an hour before its window closed stayed up until the app was relaunched
    // -- on a laptop with the tab open, indefinitely.
    jest.useFakeTimers();
    jest.setSystemTime(REAL_NOW);
    try {
      load({ endedAgo: 7 * DAY - HOUR });
      await renderScreen(<DashboardScreen />);
      expect(await screen.findByText(/You flagged/)).toBeTruthy();

      await act(async () => {
        jest.setSystemTime(REAL_NOW + 2 * HOUR);
        jest.advanceTimersByTime(2 * HOUR);
      });

      expect(screen.queryByText(/You flagged/)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens that hand’s own review, with its cards, its seat and its runout', async () => {
    // A wrong address raises nothing here and renders TiltProof's 404 over
    // there, which is why the whole thing is pinned rather than sampled.
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    load({ hands: [hand({ holeCards: 'AsKd', board: 'Kh7d2c', position: 'UTG1' })] });
    await renderScreen(<DashboardScreen />);

    await userEvent.press(await screen.findByLabelText('Drill AKo in TiltProof'));

    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://tiltproof.poker/app/review');
    expect(url.searchParams.get('hand')).toBe('AsKd');
    expect(url.searchParams.get('board')).toBe('Kh7d2c');
    // Spelled the way that app spells it, which is not the way Log stores it.
    expect(url.searchParams.get('position')).toBe('UTG+1');
    expect(url.searchParams.get('source')).toBe('log');
  });

  it('and carries nothing the player wrote about their own play', async () => {
    // Same call as the mood on the Untilt hand-offs: a query string lands in
    // browser history and in every log that sees the URL, and the review works
    // without it.
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    load({ hands: [hand({ note: 'called off my stack like an idiot' })] });
    await renderScreen(<DashboardScreen />);

    await userEvent.press(await screen.findByLabelText('Drill AKo in TiltProof'));

    const url = open.mock.calls[0][0] as string;
    expect(url).not.toMatch(/idiot/i);
    expect(new URL(url).searchParams.get('note')).toBeNull();
  });

  it('names three at most and counts the rest, so the card cannot grow', async () => {
    load({
      hands: Array.from({ length: 5 }, (_, at) => hand({ id: `h${at}` })),
    });
    await renderScreen(<DashboardScreen />);

    expect(await screen.findByText('You flagged 5 hands')).toBeTruthy();
    expect(screen.getByText('2 more are on that session.')).toBeTruthy();
    expect(screen.getAllByLabelText('Drill AKo in TiltProof')).toHaveLength(3);
  });
});
