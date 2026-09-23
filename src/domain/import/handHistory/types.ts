import type { GameType, Position, SessionFormat, Timestamp } from '../../types';

export const HAND_SITES = [
  'PokerStars',
  'GGPoker',
  'ACR',
  'Winamax',
  '888poker',
  'partypoker',
] as const;
export type HandSite = (typeof HAND_SITES)[number];

/**
 * One hand the player was dealt, as a site's hand history describes it.
 *
 * Every amount here is in hundredths of whatever the table played for: cents
 * at a real-money table, and hundredths of a chip at a play-money table or in
 * a tournament. `currency` says which. Keeping one unit for both is what lets
 * `net / bigBlind` mean the same thing everywhere, and the one place that has
 * to care about the difference, turning this into a `Hand`, checks `currency`
 * before it calls anything money.
 */
export interface ParsedHand {
  site: HandSite;
  /** The site's own hand number, as printed. */
  handId: string;
  table: string | null;
  at: Timestamp;
  /** False when the file named no zone and the time was read as this device's local time. */
  zoned: boolean;
  format: SessionFormat;
  /** The tournament's number, for a tournament hand. */
  tournamentId: string | null;
  /** ISO code at a real-money cash table. Null for play money and tournament chips. */
  currency: string | null;
  gameType: GameType;
  /** In the table's hundredths. Null when the header gave no blinds. */
  smallBlind: number | null;
  bigBlind: number | null;
  hero: string;
  /** Log's notation, `AsKd`. Null only if the cards could not be read. */
  holeCards: string | null;
  /** The runout, in the same notation. Null when the hand ended before a flop. */
  board: string | null;
  position: Position | null;
  /** What the hand did to the player's stack, in the table's hundredths. */
  net: number;
  /** The player's stack as the hand began, in the table's hundredths. */
  stack: number | null;
  /** Whether the player's cards were shown down. */
  showdown: boolean;
}

export interface HandHistoryWarning {
  /** The hand number it is about, or null for the file as a whole. */
  handId: string | null;
  message: string;
}

export interface HandHistoryResult {
  hands: ParsedHand[];
  warnings: HandHistoryWarning[];
  /** Hands in the file that did not become a `ParsedHand`: watched, canceled, unreadable. */
  skipped: number;
  /** Sites found, in the order the file first uses them. */
  sites: HandSite[];
}
