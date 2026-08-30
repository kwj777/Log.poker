/**
 * What the "new session" screen is pre-filled with.
 *
 * The 10-second target is only reachable if the common case is zero decisions:
 * a player who sits down at their usual room, at their usual stakes, for their
 * usual buy-in should be able to open the screen and hit Start. So the defaults
 * come from their last session, and only a first-time user sees generic ones.
 */

import type { GameType, SessionWithChildren, Stakes } from '../../domain/types';

export interface SessionDefaults {
  venueId: string | null;
  gameType: GameType;
  stakes: Stakes;
  /** Cents. */
  buyIn: number;
}

export const STARTER_DEFAULTS: SessionDefaults = {
  venueId: null,
  gameType: 'NLHE',
  stakes: { smallBlind: 100, bigBlind: 200, currency: 'USD' },
  buyIn: 30_000,
};

/** Common live cash structures, in the order a player is likeliest to want them. */
export const STAKES_PRESETS: readonly Stakes[] = [
  { smallBlind: 100, bigBlind: 200, currency: 'USD' },
  { smallBlind: 100, bigBlind: 300, currency: 'USD' },
  { smallBlind: 200, bigBlind: 500, currency: 'USD' },
  { smallBlind: 500, bigBlind: 500, currency: 'USD' },
  { smallBlind: 500, bigBlind: 1_000, currency: 'USD' },
  { smallBlind: 1_000, bigBlind: 2_500, currency: 'USD' },
];

/** Buy-in presets derived from the big blind: the standard 50/100/150/200bb. */
export const buyInPresets = (stakes: Stakes): number[] => {
  const bb = stakes.bigBlind;
  return [50, 100, 150, 200].map((multiple) => bb * multiple);
};

export const deriveDefaults = (sessions: readonly SessionWithChildren[]): SessionDefaults => {
  // `listSessions` is newest-first, but do not depend on the caller's ordering.
  const last = sessions.reduce<SessionWithChildren | null>(
    (newest, session) => (newest === null || session.startedAt > newest.startedAt ? session : newest),
    null,
  );
  if (!last) return STARTER_DEFAULTS;
  return {
    venueId: last.venueId,
    gameType: last.gameType,
    stakes: { ...last.stakes },
    buyIn: last.buyIn,
  };
};

export const stakesEqual = (a: Stakes, b: Stakes): boolean =>
  a.smallBlind === b.smallBlind && a.bigBlind === b.bigBlind && a.currency === b.currency;
