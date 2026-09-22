/**
 * Hand notation: the stable wire format for the cards in a hand.
 *
 * A card is two characters -- rank then suit -- and a hand is those cards
 * concatenated in the order they were picked: `"AsKd"`, `"Th9h"`, `"7c7d"`.
 * The format is deliberately the same one used by essentially every poker tool
 * (PokerStars hand histories, solvers, TiltProof's drill importer), so a Log
 * hand can be handed to another app without a translation layer.
 *
 * The same format carries the board, because a board is cards in order and
 * nothing else: three of them are a flop, four are a flop and a turn, five are
 * the whole runout. Which street a card belongs to is its position, so there is
 * nothing to store beyond the cards themselves and no second format to keep in
 * step with this one.
 *
 * Everything in this file is pure and platform-free so it can be reused by the
 * repositories, the UI, and the CSV exporter alike.
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
 * Parse a notation string into cards. Returns null -- never throws and never
 * partially succeeds -- if the string is malformed or repeats a card, so callers
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

/**
 * Every way somebody might write the cards they are looking for.
 *
 * Three forms, because the one this stores is the one nobody sees. `AsKd` is
 * the wire format; `HandRow` draws `formatNotation` and nothing anywhere draws
 * the raw string, so a player typing what is on their screen -- `A♠`, `A♠ K♦` --
 * used to match nothing. Neither did `AK` or `AA`, which is how a hand is
 * named out loud, and `toHandClass` has written that form all along for the
 * range charts.
 *
 * Empty for anything that is not cards, so a null note or an unreadable cell
 * puts nothing in the haystack -- `formatNotation` answers those with a dash,
 * and a dash every hand shares is a term that matches all of them.
 */
export const notationSearchForms = (notation: string | null | undefined): string[] => {
  if (parseNotation(notation) === null) return [];
  const held = toHandClass(notation);
  return [notation as string, formatNotation(notation), ...(held === null ? [] : [held])];
};

/** Human-facing rendering: `"A♠ K♦"`. Falls back to an em dash when absent. */
export const formatNotation = (notation: string | null | undefined): string => {
  const cards = parseNotation(notation);
  if (cards === null) return '--';
  return cards.map((c) => `${c.rank}${SUIT_SYMBOLS[c.suit]}`).join(' ');
};

/** The full 52-card deck in picker order: by rank descending, then suit. */
export const FULL_DECK: readonly Card[] = RANKS.slice()
  .reverse()
  .flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));

/* ------------------------------------------------------------------ boards */

/**
 * How many cards a board can have.
 *
 * Not one and not two. A hand that saw a flop saw three cards at once, so a
 * two-card board is not an early runout, it is somebody who stopped tapping --
 * and storing it would put a thing that never happened in the log.
 */
export const BOARD_SIZES = [3, 4, 5] as const;

export const MAX_BOARD = 5;

/** Whether a notation is a board somebody could actually have been dealt. */
export const isBoard = (notation: string | null | undefined): boolean => {
  const cards = parseNotation(notation);
  return cards !== null && (BOARD_SIZES as readonly number[]).includes(cards.length);
};

/**
 * The street a board runs to, or null if it is not a board.
 *
 * Named rather than counted, because "three cards" is what is stored and
 * "flop" is what a person means.
 */
export const boardStreet = (notation: string | null | undefined): 'flop' | 'turn' | 'river' | null => {
  const cards = parseNotation(notation);
  if (cards === null) return null;
  if (cards.length === 3) return 'flop';
  if (cards.length === 4) return 'turn';
  if (cards.length === 5) return 'river';
  return null;
};

/**
 * Cards that appear in both notations.
 *
 * `parseNotation` already refuses a string that repeats a card, so this is the
 * case it cannot see: the hole cards and the board are two strings, and the
 * same card in each is a deck with two of it. Empty when either side is absent
 * or unparseable, because there is nothing to compare rather than nothing
 * wrong.
 */
export const clashingCards = (
  a: string | null | undefined,
  b: string | null | undefined,
): Card[] => {
  const left = parseNotation(a);
  const right = parseNotation(b);
  if (left === null || right === null) return [];
  const taken = new Set(right.map(cardToString));
  return left.filter((card) => taken.has(cardToString(card)));
};
