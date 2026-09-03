/** Builders so the math tests read as poker scenarios, not object literals. */

import type { Rebuy, SessionFormat, SessionWithChildren, Stakes, Venue } from '../types';

export const HOUR = 3_600_000;
export const T0 = 1_700_000_000_000;

export const STAKES_1_2: Stakes = { smallBlind: 100, bigBlind: 200 };
export const STAKES_2_5: Stakes = { smallBlind: 200, bigBlind: 500 };

export const venue = (overrides: Partial<Venue> = {}): Venue => ({
  id: 'venue-1',
  name: 'Card Room',
  isHomeGame: false,
  sessionCount: 0,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

let counter = 0;

export interface SessionSpec {
  id?: string;
  venueId?: string;
  format?: SessionFormat;
  gameType?: SessionWithChildren['gameType'];
  stakes?: Stakes | null;
  currency?: string;
  buyIn?: number;
  fee?: number | null;
  entrants?: number | null;
  finishPosition?: number | null;
  cashOut?: number | null;
  startedAt?: number;
  /** Convenience: session length in hours, converted to an end timestamp. */
  hours?: number;
  endedAt?: number | null;
  rebuys?: number[];
  venue?: Venue | null;
}

export const session = (spec: SessionSpec = {}): SessionWithChildren => {
  const id = spec.id ?? `session-${++counter}`;
  const venueId = spec.venueId ?? 'venue-1';
  const startedAt = spec.startedAt ?? T0;
  const endedAt =
    spec.endedAt !== undefined
      ? spec.endedAt
      : spec.hours !== undefined
        ? startedAt + spec.hours * HOUR
        : null;

  const rebuys: Rebuy[] = (spec.rebuys ?? []).map((amount, index) => ({
    id: `${id}-rebuy-${index}`,
    sessionId: id,
    amount,
    at: startedAt + (index + 1) * HOUR,
    createdAt: startedAt,
    updatedAt: startedAt,
  }));

  const format: SessionFormat = spec.format ?? 'cash';

  return {
    id,
    venueId,
    format,
    gameType: spec.gameType ?? 'NLHE',
    // A tournament never carries stakes, exactly as `buildSession` enforces, so
    // a test cannot accidentally construct a session the app could not store.
    stakes: format === 'tournament' ? null : spec.stakes !== undefined ? spec.stakes : STAKES_1_2,
    currency: spec.currency ?? 'USD',
    buyIn: spec.buyIn ?? 30_000,
    fee: format === 'tournament' ? (spec.fee ?? null) : null,
    entrants: format === 'tournament' ? (spec.entrants ?? null) : null,
    finishPosition: format === 'tournament' ? (spec.finishPosition ?? null) : null,
    cashOut: spec.cashOut !== undefined ? spec.cashOut : null,
    startedAt,
    endedAt,
    notes: null,
    importKey: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    rebuys,
    // Default to a venue whose id matches, so the fixture is never internally
    // inconsistent; pass `venue: null` to exercise a lookup-by-id path.
    venue: spec.venue !== undefined ? spec.venue : venue({ id: venueId, name: `Venue ${venueId}` }),
  };
};

/** A finished session described the way a player would: bought in, cashed out. */
export const completed = (spec: SessionSpec & { hours: number; cashOut: number }) =>
  session(spec);
