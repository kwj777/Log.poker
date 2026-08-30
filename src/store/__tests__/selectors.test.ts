/**
 * The store's read helpers.
 *
 * These exist because a Zustand selector is compared by reference: one that
 * builds a new array on every call reports a change on every render, which is an
 * infinite render loop rather than a wasted render. The hooks wrap these in
 * `useMemo`; the pure functions below are what they wrap, tested without a
 * renderer.
 */

import {
  filterSessions,
  selectHandsForSession,
  selectMoodForSession,
  selectVenueById,
} from '../selectors';
import type { Hand, MoodEntry, Venue } from '../../domain/types';
import { HOUR, T0, completed, session, venue } from '../../domain/__tests__/support';

const hand = (id: string, sessionId: string): Hand => ({
  id,
  sessionId,
  holeCards: 'AsKd',
  position: 'BTN',
  note: null,
  tags: [],
  amount: null,
  at: T0,
  createdAt: T0,
  updatedAt: T0,
});

const mood = (id: string, sessionId: string): MoodEntry => ({
  id,
  sessionId,
  phase: 'start',
  score: 3,
  at: T0,
  createdAt: T0,
  updatedAt: T0,
});

describe('scoped reads', () => {
  const hands = [hand('h1', 's1'), hand('h2', 's2'), hand('h3', 's1')];
  const moods = [mood('m1', 's1'), mood('m2', 's2')];

  it('scopes hands to one session', () => {
    expect(selectHandsForSession(hands, 's1').map((h) => h.id)).toEqual(['h1', 'h3']);
  });

  it('returns an empty list for a session with no hands', () => {
    expect(selectHandsForSession(hands, 'nope')).toEqual([]);
  });

  it('scopes mood entries to one session', () => {
    expect(selectMoodForSession(moods, 's2').map((m) => m.id)).toEqual(['m2']);
  });

  it('finds a venue by id and returns null when absent', () => {
    const venues: Venue[] = [venue({ id: 'v1', name: 'Aria' })];
    expect(selectVenueById(venues, 'v1')?.name).toBe('Aria');
    expect(selectVenueById(venues, 'v2')).toBeNull();
  });
});

describe('filterSessions', () => {
  const sessions = [
    completed({ id: 'a', venueId: 'v1', gameType: 'NLHE', startedAt: T0, hours: 3, cashOut: 100 }),
    completed({ id: 'b', venueId: 'v2', gameType: 'PLO', startedAt: T0 + 48 * HOUR, hours: 2, cashOut: 0 }),
    session({ id: 'c', venueId: 'v1', gameType: 'NLHE', startedAt: T0 + 96 * HOUR }),
  ];

  it('returns everything with no filter', () => {
    expect(filterSessions(sessions, {})).toHaveLength(3);
  });

  it('filters by venue, game type and status', () => {
    expect(filterSessions(sessions, { venueId: 'v1' }).map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterSessions(sessions, { gameType: 'PLO' }).map((s) => s.id)).toEqual(['b']);
    expect(filterSessions(sessions, { status: 'active' }).map((s) => s.id)).toEqual(['c']);
    expect(filterSessions(sessions, { status: 'completed' }).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('treats `from` as inclusive and `to` as exclusive, matching the repository', () => {
    expect(filterSessions(sessions, { from: T0 }).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(filterSessions(sessions, { to: T0 + 48 * HOUR }).map((s) => s.id)).toEqual(['a']);
  });

  it('combines filters', () => {
    expect(
      filterSessions(sessions, { venueId: 'v1', status: 'completed' }).map((s) => s.id),
    ).toEqual(['a']);
  });

  it('preserves the input order', () => {
    expect(filterSessions(sessions, {}).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
