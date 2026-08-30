/**
 * Hand notation: the stable wire format for hole cards.
 *
 * A card is two characters — rank then suit — and a hand is those cards
 * concatenated in the order they were picked: `"AsKd"`, `"Th9h"`, `"7c7d"`.
 * The format is deliberately the same one used by essentially every poker tool
 * (PokerStars hand histories, solvers, TiltProof's drill importer), so a Log
 * hand can be handed to another app without a translation layer.
 *
 * Everything in this file is pure and platform-free so it can be reused by the
 * repositories, the UI, and a future CSV/JSON exporter alike.
 */

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAMES: Record<Suit, string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

/** Red suits render red; black suits render light. Used by the card picker. */
export const isRedSuit = (suit: Suit): boolean => suit === 'h' || suit === 'd';

const RANK_SET: ReadonlySet<string> = new Set(RANKS);
const SUIT_SET: ReadonlySet<string> = new Set(SUITS);

export const isRank = (value: string): value is Rank => RANK_SET.has(value);
export const isSuit = (value: string): value is Suit => SUIT_SET.has(value);

export const cardToString = (card: Card): string => `${card.rank}${card.suit}`;

export const cardsToNotation = (cards: readonly Card[]): string =>
  cards.map(cardToString).join('');

export const cardsEqual = (a: Card, b: Card): boolean => a.rank === b.rank && a.suit === b.suit;

/**
 * Parse a notation string into cards. Returns null — never throws and never
 * partially succeeds — if the string is malformed or repeats a card, so callers
 * can treat "unparseable" and "absent" identically.
 */
export const parseNotation = (notation: string | null | undefined): Card[] | null => {
  if (notation == null) return null;
  const trimmed = notation.trim();
  if (trimmed.length === 0 || trimmed.length % 2 !== 0) return null;

  const cards: Card[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < trimmed.length; i += 2) {
    const rank = trimmed[i];
    const suit = trimmed[i + 1];
    if (!isRank(rank) || !isSuit(suit)) return null;
    const key = `${rank}${suit}`;
    if (seen.has(key)) return null;
    seen.add(key);
    cards.push({ rank, suit });
  }
  return cards;
};

export const isValidNotation = (notation: string | null | undefined): boolean =>
  parseNotation(notation) !== null;

const rankIndex = (rank: Rank): number => RANKS.indexOf(rank);

/**
 * The canonical *class* of a two-card hand, suit-collapsed: `AKs`, `AKo`, `77`.
 * This is what a drill or a range chart keys on, and what "profit by holding"
 * would group by. Returns null for anything that is not exactly two cards.
 */
export const toHandClass = (notation: string | null | undefined): string | null => {
  const cards = parseNotation(notation);
  if (cards === null || cards.length !== 2) return null;

  const [first, second] = cards;
  const [high, low] =
    rankIndex(first.rank) >= rankIndex(second.rank) ? [first, second] : [second, first];

  if (high.rank === low.rank) return `${high.rank}${low.rank}`;
  return `${high.rank}${low.rank}${high.suit === low.suit ? 's' : 'o'}`;
};

/** Human-facing rendering: `"A♠ K♦"`. Falls back to an em dash when absent. */
export const formatNotation = (notation: string | null | undefined): string => {
  const cards = parseNotation(notation);
  if (cards === null) return '—';
  return cards.map((c) => `${c.rank}${SUIT_SYMBOLS[c.suit]}`).join(' ');
};

/** The full 52-card deck in picker order: by rank descending, then suit. */
export const FULL_DECK: readonly Card[] = RANKS.slice()
  .reverse()
  .flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
