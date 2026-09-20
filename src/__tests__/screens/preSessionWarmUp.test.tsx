/**
 * The offer before a session starts, and the one way it must never be wrong.
 *
 * `postSessionReset.test.tsx` next door guards three failures about what
 * reaches the screen and when, and the same two apply here: a player who has
 * bought the pass should not be told to go and get it, and neither sentence
 * should appear before the read that decides which is true.
 *
 * The third is this screen's own and is the reason the card is rendered in a
 * test rather than read as source. The mood picker on this screen is where the
 * `start` scores come from, and `mood.ts` computes the whole tilt-cost
 * comparison from them -- so an offer that makes a 5 costlier to tap than a 3
 * corrupts that comparison silently, for as long as it ships. The card must
 * appear on a 4 or a 5, go away again when the answer changes, and never stand
 * between the player and the Start button.
 *
 * What the card *says* is pinned in `features/family/__tests__/handOffs.test.ts`,
 * beside the link it says it about.
 */

import { Linking } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import NewSessionScreen from '../../../app/session/new';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

/** The token store, stood in for, exactly as the after-session test does. */
const held: { tier: 'full' | 'free' | null; gate: Promise<void> | null } = {
  tier: null,
  gate: null,
};

jest.mock('../../auth', () => ({
  getSession: async () => {
    if (held.gate) await held.gate;
    if (held.tier === null) return null;
    return {
      claim: { expiresAt: 1_800_000_000_000, tier: held.tier, subject: 'log_' + 'e'.repeat(32) },
      syncs: true,
    };
  },
  hasPass: (claim: { tier: string } | null) => claim !== null && claim.tier === 'full',
}));

const load = (over: { tier?: 'full' | 'free' | null } = {}) => {
  held.tier = over.tier ?? null;
  held.gate = null;
  useLogStore.setState({
    status: 'ready',
    sessions: [],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
};

/** The picker's own labels, which are what a player actually taps. */
const feel = async (label: string) => {
  await userEvent.press(screen.getByText(label));
};

const CARD = 'Rough day already?';
const PASS_LINE = /Your pass covers them/;
const OFFER_LINE = /inside its pass/;

describe('sitting down rattled', () => {
  it('is offered the lane for the minutes before you play', async () => {
    load();
    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    expect(await screen.findByText(CARD)).toBeTruthy();
  });

  it('and opens Untilt on that lane when the offer is taken', async () => {
    const opened: string[] = [];
    jest.spyOn(Linking, 'openURL').mockImplementation(async (url: string) => {
      opened.push(url);
      return true;
    });

    load();
    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    await userEvent.press(await screen.findByText('Find a warm-up'));

    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('lane=preflight');
  });
});

describe('sitting down fine, which is most nights', () => {
  it('is offered nothing at all', async () => {
    load();
    await renderScreen(<NewSessionScreen />);
    await feel('Edgy');
    expect(screen.queryByText(CARD)).toBeNull();
  });

  it('nor is somebody who skipped the question', async () => {
    // Every field on this screen is optional and the mood is the one nobody
    // owes an answer to. Nothing may appear for a player who did not answer.
    load();
    await renderScreen(<NewSessionScreen />);
    expect(screen.queryByText(CARD)).toBeNull();
  });
});

describe('what the card may not cost a player', () => {
  it('goes away by itself when the answer changes', async () => {
    // The only interaction it has. There is deliberately no dismiss control:
    // a card you have to tap past is a card that teaches people to answer the
    // picker with a 3 to be left alone, and the start scores are what the
    // whole tilt-cost comparison is computed from.
    load();
    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    expect(await screen.findByText(CARD)).toBeTruthy();

    await feel('Calm');
    expect(screen.queryByText(CARD)).toBeNull();
  });

  it('and never stands between the player and Start', async () => {
    load();
    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    expect(await screen.findByText(CARD)).toBeTruthy();
    // Still one tap away from the thing this screen exists for.
    expect(screen.getByText(/Start/)).toBeTruthy();
  });
});

describe('a player who has already bought the pass', () => {
  it('is not sold what they own', async () => {
    load({ tier: 'full' });
    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    expect(await screen.findByText(PASS_LINE)).toBeTruthy();
    expect(screen.queryByText(OFFER_LINE)).toBeNull();
    expect(screen.getByText('Open your warm-up')).toBeTruthy();
  });

  it('while everybody else is told what is free on that screen', async () => {
    load({ tier: 'free' });
    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    expect(await screen.findByText(OFFER_LINE)).toBeTruthy();
    expect(screen.queryByText(PASS_LINE)).toBeNull();
  });
});

describe('before the token has been read', () => {
  it('says neither sentence rather than the wrong one', async () => {
    load({ tier: 'full' });
    let open: () => void = () => undefined;
    held.gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    await renderScreen(<NewSessionScreen />);
    await feel('Tilted');
    expect(screen.queryByText(CARD)).toBeNull();

    // Let the read finish inside the test rather than after it, so the state
    // it sets is not an update landing on a torn-down tree.
    open();
    expect(await screen.findByText(PASS_LINE)).toBeTruthy();
  });
});
