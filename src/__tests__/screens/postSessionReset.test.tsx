/**
 * The offer at the end of a session, and the three ways it could be wrong.
 *
 * It could appear on a night the player opened from History, which turns a
 * wind-down into nagging. It could tell somebody who has bought the pass to go
 * and get the pass. Or it could say one of those and then swap to the other a
 * frame later, which is the failure `sessionDetail.test.tsx` already guards
 * one section up: the read that answers "has this person paid" is a promise
 * resolving, and the screen renders before it lands.
 *
 * Rendered rather than read as source, because all three are about what
 * reaches the screen and when. What the card *says* is pinned in
 * `features/family/__tests__/handOffs.test.ts`, beside the link it says it
 * about.
 */

import { Linking } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import SessionDetailScreen from '../../../app/session/[id]';
import { useLogStore } from '../../store/useLogStore';

const viewing: { id: string; ended?: string } = { id: 's1' };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => viewing,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

/**
 * The token store, stood in for.
 *
 * `held` is what this device's token says; `gate` holds the read open when a
 * test wants to see the screen before the answer arrives. The real module
 * reaches `expo-secure-store` on device and `localStorage` on web, and neither
 * is what any of this is about.
 */
const held: { tier: 'full' | 'free' | null; gate: Promise<void> | null } = {
  tier: null,
  gate: null,
};

jest.mock('../../auth', () => ({
  getSession: async () => {
    if (held.gate) await held.gate;
    if (held.tier === null) return null;
    return {
      claim: { expiresAt: 1_800_000_000_000, tier: held.tier, subject: 'log_' + 'd'.repeat(32) },
      syncs: true,
    };
  },
  hasPass: (claim: { tier: string } | null) => claim !== null && claim.tier === 'full',
}));

const load = (over: { ended?: string; tier?: 'full' | 'free' | null } = {}) => {
  viewing.id = 's1';
  viewing.ended = over.ended;
  held.tier = over.tier ?? null;
  held.gate = null;
  useLogStore.setState({
    status: 'ready',
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
};

const PASS_LINE = /Your pass/;
const OFFER_LINE = /inside its pass/;

describe('after a session is closed out', () => {
  it('offers the after-session reset', async () => {
    load({ ended: '1' });
    await renderScreen(<SessionDetailScreen />);
    expect(await screen.findByText(/Win or lose/)).toBeTruthy();
    expect(screen.getByText('That one is logged.')).toBeTruthy();
  });

  it('and opens Untilt when the offer is taken', async () => {
    const opened: string[] = [];
    jest.spyOn(Linking, 'openURL').mockImplementation(async (url: string) => {
      opened.push(url);
      return true;
    });

    load({ ended: '1' });
    await renderScreen(<SessionDetailScreen />);
    await userEvent.press(await screen.findByText('Open Untilt.poker'));

    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('context=post_session');
  });

  it('and goes away when the player says not now', async () => {
    load({ ended: '1' });
    await renderScreen(<SessionDetailScreen />);
    await userEvent.press(await screen.findByText('Not now'));
    expect(screen.queryByText('That one is logged.')).toBeNull();
  });
});

describe('a session opened from History', () => {
  it('is not offered a wind-down for a night three weeks gone', async () => {
    // The whole reason the offer is keyed to the cash-out navigation rather
    // than to the screen it lands on.
    load({});
    await renderScreen(<SessionDetailScreen />);
    expect(screen.queryByText('That one is logged.')).toBeNull();
  });

  it('and neither is one that has not finished yet', async () => {
    load({ ended: '1' });
    useLogStore.setState({ sessions: [session('s1', { endedAt: null, cashOut: null })] });
    await renderScreen(<SessionDetailScreen />);
    expect(screen.queryByText('That one is logged.')).toBeNull();
  });
});

describe('a player who has already bought the pass', () => {
  it('is not sold what they own', async () => {
    load({ ended: '1', tier: 'full' });
    await renderScreen(<SessionDetailScreen />);
    expect(await screen.findByText(PASS_LINE)).toBeTruthy();
    expect(screen.queryByText(OFFER_LINE)).toBeNull();
  });

  it('while everybody else is told where the resets live', async () => {
    load({ ended: '1', tier: 'free' });
    await renderScreen(<SessionDetailScreen />);
    expect(await screen.findByText(OFFER_LINE)).toBeTruthy();
    expect(screen.queryByText(PASS_LINE)).toBeNull();
  });
});

describe('before the token has been read', () => {
  it('says neither sentence rather than the wrong one', async () => {
    // One frame of "get the pass" in front of somebody who bought it is worse
    // than a card that arrives a beat late.
    load({ ended: '1', tier: 'full' });
    let open: () => void = () => undefined;
    held.gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    await renderScreen(<SessionDetailScreen />);
    expect(screen.queryByText('That one is logged.')).toBeNull();

    // Let the read finish inside the test rather than after it, so the state
    // it sets is not an update landing on a torn-down tree.
    open();
    expect(await screen.findByText(PASS_LINE)).toBeTruthy();
  });
});
