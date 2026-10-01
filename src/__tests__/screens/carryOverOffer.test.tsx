/**
 * The carry-over offer, on the screen where a session starts.
 *
 * `domain/__tests__/carryOver.test.ts` pins when the record says a night is
 * still with somebody, and `features/family/__tests__/handOffs.test.ts` pins
 * what the card says about the pass. What is only true on this screen, and
 * what these cases are for:
 *
 *  - The card has to be there before anything is tapped, because the whole
 *    point is that the player has not told the app how they feel and the
 *    record already knows.
 *  - It has to get out of the way when the player *does* tell the app, or the
 *    screen shows two Untilt cards at once.
 *  - It must not stand between the player and Start, and it must not make one
 *    mood score costlier to tap than another. That failure is silent and
 *    permanent: `mood.ts` computes the entire tilt-cost comparison from the
 *    start scores this picker collects.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import NewSessionScreen from '../../../app/session/new';
import type { SessionWithChildren } from '../../domain/types';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const held: { tier: 'full' | 'free' | null } = { tier: null };

jest.mock('../../auth', () => ({
  getSession: async () => {
    if (held.tier === null) return null;
    return {
      claim: { expiresAt: 1_800_000_000_000, tier: held.tier, subject: 'log_' + 'e'.repeat(32) },
      syncs: true,
    };
  },
  hasPass: (claim: { tier: string } | null) => claim !== null && claim.tier === 'full',
}));

const HOUR = 3_600_000;
const BB = 200;

/**
 * One finished night, two hours ago, that lost or won `resultBb`.
 *
 * A log of exactly one session has no sigma to scale by, so `carryOver` reads
 * it with the fallback: a loss is a loss, and a win has to have more than
 * doubled the buy-in. That is the cheapest way to put this card on screen and
 * the measured path is pinned in the domain test.
 */
const night = (resultBb: number): SessionWithChildren => {
  const endedAt = Date.now() - 2 * HOUR;
  return {
    id: 'last',
    venueId: 'v1',
    format: 'cash',
    gameType: 'NLHE',
    stakes: { smallBlind: 100, bigBlind: BB },
    currency: 'USD',
    buyIn: 30_000,
    fee: null,
    cashOut: 30_000 + resultBb * BB,
    entrants: null,
    finishPosition: null,
    startedAt: endedAt - 4 * HOUR,
    endedAt,
    notes: null,
    importKey: null,
    createdAt: endedAt,
    updatedAt: endedAt,
    rebuys: [],
    venue: null,
  };
};

const load = (over: { last?: SessionWithChildren | null; tier?: 'full' | 'free' | null } = {}) => {
  held.tier = over.tier ?? null;
  const last = over.last === undefined ? night(-60) : over.last;
  useLogStore.setState({
    status: 'ready',
    sessions: last === null ? [] : [last],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
};

const ROUGH = 'Last night was a rough one';
const BIG = 'Last night was a big one';

afterEach(() => {
  jest.clearAllMocks();
});

describe('the carry-over offer', () => {
  it('is there before the player has said anything about how they feel', async () => {
    load({ last: night(-60) });
    await renderScreen(<NewSessionScreen />);

    expect(await screen.findByText(ROUGH)).toBeTruthy();
  });

  it('reads a heater the same way', async () => {
    load({ last: night(200) });
    await renderScreen(<NewSessionScreen />);

    expect(await screen.findByText(BIG)).toBeTruthy();
  });

  it('says nothing after an ordinary night', async () => {
    load({ last: night(0) });
    await renderScreen(<NewSessionScreen />);

    expect(screen.queryByText(ROUGH)).toBeNull();
    expect(screen.queryByText(BIG)).toBeNull();
  });

  it('says nothing to a player with no history at all', async () => {
    load({ last: null });
    await renderScreen(<NewSessionScreen />);

    expect(screen.queryByText(ROUGH)).toBeNull();
  });

  it('stands aside once the player says they are rattled', async () => {
    // Both cards make the same offer about the same lane. The self-report is
    // about right now, where this is an inference from the night before, so
    // the picker wins and the screen never shows two Untilt cards at once.
    load({ last: night(-60) });
    await renderScreen(<NewSessionScreen />);
    expect(await screen.findByText(ROUGH)).toBeTruthy();

    await userEvent.press(screen.getByText('Tilted'));

    expect(screen.queryByText(ROUGH)).toBeNull();
    expect(await screen.findByText('Rough day already?')).toBeTruthy();
  });

  it('comes back when the player changes their answer to a calm one', async () => {
    // Nothing about this card is dismissed, so it cannot be tapped away: it is
    // a function of the record and of the picker, both directions.
    load({ last: night(-60) });
    await renderScreen(<NewSessionScreen />);

    await userEvent.press(screen.getByText('Tilted'));
    await userEvent.press(screen.getByText('Fine'));

    expect(await screen.findByText(ROUGH)).toBeTruthy();
  });

  it('does not tell a player who holds the pass to go and find one', async () => {
    load({ last: night(-60), tier: 'full' });
    await renderScreen(<NewSessionScreen />);

    expect(await screen.findByText(/Your pass covers them/)).toBeTruthy();
    expect(screen.queryByText(/inside its pass/)).toBeNull();
  });

  it('and never leaves Start out of reach', async () => {
    load({ last: night(-60) });
    await renderScreen(<NewSessionScreen />);
    await screen.findByText(ROUGH);

    // The footer is outside this card's reach by construction; this asserts the
    // screen still has its primary action while the card is on it. Matched
    // loosely because the label carries the stakes and the buy-in once there
    // is a session to derive them from, which there is here.
    expect(screen.getByText(/^Start\b/)).toBeTruthy();
  });
});
