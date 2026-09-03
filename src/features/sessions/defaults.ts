/**
 * What the "new session" screen is pre-filled with.
 *
 * The 10-second target is only reachable if the common case is zero decisions:
 * a player who sits down at their usual room, at their usual stakes, for their
 * usual buy-in should be able to open the screen and hit Start. So the defaults
 * come from their last session, and only a first-time user sees generic ones.
 */

import { DEFAULT_CURRENCY } from '../../domain/money';
import type {
  GameType,
  SessionFormat,
  SessionWithChildren,
  Stakes,
} from '../../domain/types';

export interface SessionDefaults {
  venueId: string | null;
  format: SessionFormat;
  gameType: GameType;
  stakes: Stakes;
  currency: string;
  /** Cents. */
  buyIn: number;
  /** Tournament entry fee, in cents. */
  fee: number;
}

export const STARTER_DEFAULTS: SessionDefaults = {
  venueId: null,
  format: 'cash',
  gameType: 'NLHE',
  stakes: { smallBlind: 100, bigBlind: 200 },
  currency: DEFAULT_CURRENCY,
  buyIn: 30_000,
  fee: 0,
};

/** Common live cash structures, in the order a player is likeliest to want them. */
export const STAKES_PRESETS: readonly Stakes[] = [
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 100, bigBlind: 300 },
  { smallBlind: 200, bigBlind: 500 },
  { smallBlind: 500, bigBlind: 500 },
  { smallBlind: 500, bigBlind: 1_000 },
  { smallBlind: 1_000, bigBlind: 2_500 },
];

/** Common tournament entries, as buy-in and fee in cents. */
export const ENTRY_PRESETS: readonly { buyIn: number; fee: number }[] = [
  { buyIn: 2_000, fee: 300 },
  { buyIn: 5_000, fee: 500 },
  { buyIn: 10_000, fee: 1_000 },
  { buyIn: 20_000, fee: 2_000 },
  { buyIn: 50_000, fee: 5_000 },
  { buyIn: 100_000, fee: 10_000 },
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
    format: last.format,
    gameType: last.gameType,
    // A tournament carries no stakes to remember, so the generic ones stand in
    // for the next cash game rather than the screen opening with nothing.
    stakes: last.stakes ? { ...last.stakes } : { ...STARTER_DEFAULTS.stakes },
    currency: last.currency,
    buyIn: last.buyIn,
    fee: last.fee ?? 0,
  };
};

export const stakesEqual = (a: Stakes, b: Stakes): boolean =>
  a.smallBlind === b.smallBlind && a.bigBlind === b.bigBlind;
