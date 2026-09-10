/** Sessions to render. Enough fields to be real, not one more. */

import type { SessionWithChildren, GameType, Venue } from '../../domain/types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

export const venue = (id: string, name: string): Venue => ({
  id,
  name,
  isHomeGame: false,
  sessionCount: 1,
  createdAt: T0,
  updatedAt: T0,
});

export const session = (
  id: string,
  over: Partial<SessionWithChildren> = {},
): SessionWithChildren => ({
  id,
  venueId: 'v1',
  format: 'cash',
  gameType: 'NLHE' as GameType,
  stakes: { smallBlind: 100, bigBlind: 200 },
  currency: 'USD',
  buyIn: 30_000,
  fee: null,
  cashOut: 45_000,
  entrants: null,
  finishPosition: null,
  startedAt: T0,
  endedAt: T0 + 4 * 3_600_000,
  notes: null,
  importKey: null,
  createdAt: T0,
  updatedAt: T0,
  rebuys: [],
  venue: venue('v1', 'Aria'),
  ...over,
});

/** `count` sessions, one a day going back, newest first as a real read gives. */
export const sessions = (count: number): SessionWithChildren[] =>
  Array.from({ length: count }, (_, i) =>
    session(`s${i}`, { startedAt: T0 - i * DAY, endedAt: T0 - i * DAY + 3_600_000 }),
  );
