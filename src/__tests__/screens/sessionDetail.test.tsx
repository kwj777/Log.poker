/**
 * One session, its numbers, and its hands.
 *
 * The hands are the reason this exists. They reach the screen through
 * `useHandsForSession`, which filters the store's array of every hand ever
 * logged -- and that array is what makes a hand write the most expensive write
 * in the app, because the store holds all of it so Settings can print a count.
 *
 * Fixing that means loading a session's hands on their own, which makes this
 * hook asynchronous and this screen render at least once without them. That is
 * a change worth having a test under before it is made rather than after, and
 * this is it: what a player is supposed to see here, written against the
 * version that works.
 */

import { screen } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import type { Hand } from '../../domain/types';
import SessionDetailScreen from '../../../app/session/[id]';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 's1' }),
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
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

const load = (hands: Hand[]) =>
  useLogStore.setState({
    status: 'ready',
    sessions: [session('s1')],
    venues: [],
    hands,
    moodEntries: [],
  });

describe('a session and its hands', () => {
  it('counts the hands belonging to this session', async () => {
    load([hand('h1'), hand('h2')]);
    await renderScreen(<SessionDetailScreen />);
    expect(screen.getByText('Hands (2)')).toBeTruthy();
  });

  it('and counts only this session, not every hand in the log', async () => {
    // The hook filters a store-wide array. If a change ever stops it filtering,
    // this is the assertion that notices.
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
