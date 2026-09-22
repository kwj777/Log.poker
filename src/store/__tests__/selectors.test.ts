/**
 * The store's read helpers.
 *
 * These exist because a Zustand selector is compared by reference: one that
 * builds a new array on every call reports a change on every render, which is an
 * infinite render loop rather than a wasted render. The hooks wrap these in
 * `useMemo`; the pure functions below are what they wrap, tested without a
 * renderer.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  filterSessions,
  selectHandsForSession,
  selectMoodForSession,
  selectVenueById,
} from '../selectors';
import type { SessionFilter } from '../../data/repository';
import type { Hand, MoodEntry, Venue } from '../../domain/types';
import { HOUR, T0, completed, session, venue } from '../../domain/__tests__/support';

const hand = (id: string, sessionId: string): Hand => ({
  id,
  sessionId,
  holeCards: 'AsKd',
  board: null,
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

  it('and by format, which it used to accept and ignore', () => {
    // `format` was on `SessionFilter` and honored by both repositories, so a
    // caller had every reason to believe this honored it too. It did not, and
    // an ignored filter is silent: the screen simply showed sessions it had
    // asked not to be shown.
    const mixed = [
      completed({ id: 'cash', startedAt: T0, hours: 3, cashOut: 100 }),
      { ...completed({ id: 'tourney', startedAt: T0, hours: 3, cashOut: 0 }), format: 'tournament' as const },
    ];
    expect(filterSessions(mixed, { format: 'cash' }).map((s) => s.id)).toEqual(['cash']);
    expect(filterSessions(mixed, { format: 'tournament' }).map((s) => s.id)).toEqual(['tourney']);
    expect(filterSessions(mixed, {})).toHaveLength(2);
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

  it('and by limit, which it used to accept and ignore as well', () => {
    // The first N of the order it was handed, which is the order the store
    // holds and the order both engines apply their own `LIMIT` in.
    expect(filterSessions(sessions, { limit: 2 }).map((s) => s.id)).toEqual(['a', 'b']);
    expect(filterSessions(sessions, { venueId: 'v1', limit: 1 }).map((s) => s.id)).toEqual(['a']);
  });

  it('clamps a limit the way the engines clamp theirs', () => {
    // `Math.floor(NaN)` is NaN, which reaches SQLite as the literal `LIMIT
    // NaN`. All three agree that a limit which is not a number is no limit,
    // and that a negative one is zero.
    expect(filterSessions(sessions, { limit: 0 })).toEqual([]);
    expect(filterSessions(sessions, { limit: -1 })).toEqual([]);
    expect(filterSessions(sessions, { limit: 1.9 }).map((s) => s.id)).toEqual(['a']);
    expect(filterSessions(sessions, { limit: Number.NaN })).toHaveLength(3);
    expect(filterSessions(sessions, { limit: Number.POSITIVE_INFINITY })).toHaveLength(3);
  });
});

describe('the field set this is pinned to', () => {
  /**
   * Field for field, asked rather than asserted in prose.
   *
   * `SessionFilter` has grown twice since `filterSessions` was written, and
   * both times the new field was honored by the two engines and quietly
   * ignored here -- `format` first, which showed the History tab tournaments
   * it had been asked to hide, and then `limit`, which nothing had yet asked
   * for. An ignored filter draws no error, so the eighth field will go the
   * same way unless something counts them.
   *
   * The names come out of `repository.ts` rather than out of a list here,
   * because a list here is the thing that goes stale.
   */
  const FIELDS = (): string[] => {
    const source = readFileSync(join(__dirname, '..', '..', 'data', 'repository.ts'), 'utf8');
    const shape = /export interface SessionFilter \{([\s\S]*?)\n\}/.exec(source);
    return [...(shape as RegExpExecArray)[1].matchAll(/^ {2}(\w+)\??:/gm)].map(([, name]) => name);
  };

  /** One narrowing filter per field, each of which must change the answer. */
  const NARROWING: Record<string, SessionFilter> = {
    venueId: { venueId: 'v1' },
    format: { format: 'tournament' },
    gameType: { gameType: 'PLO' },
    from: { from: T0 + HOUR },
    to: { to: T0 + HOUR },
    status: { status: 'active' },
    limit: { limit: 1 },
  };

  const all = [
    completed({ id: 'a', venueId: 'v1', gameType: 'NLHE', startedAt: T0, hours: 3, cashOut: 100 }),
    completed({ id: 'b', venueId: 'v2', gameType: 'PLO', startedAt: T0 + 48 * HOUR, hours: 2, cashOut: 0 }),
    session({ id: 'c', venueId: 'v1', gameType: 'NLHE', startedAt: T0 + 96 * HOUR }),
    {
      ...completed({ id: 'd', venueId: 'v2', gameType: 'NLHE', startedAt: T0 + 72 * HOUR, hours: 5, cashOut: 0 }),
      format: 'tournament' as const,
    },
  ];

  it('is every field the repository declares, and no more', () => {
    expect(FIELDS().sort()).toEqual(Object.keys(NARROWING).sort());
  });

  it.each(Object.entries(NARROWING))('honors %s', (_field, filter) => {
    expect(filterSessions(all, filter).length).toBeLessThan(all.length);
  });
});
