/**
 * The pieces every hand-history format shares: amounts, cards, seats, and
 * the running total of what the player put in and took out.
 */

import { parseNotation } from '../../handNotation';
import { toNumeric } from '../../money';
import type { GameType, Position } from '../../types';

/**
 * One amount: digits with `.` and `,` in them, or thousands set apart by a
 * space, which is how 888poker writes `3 023,50 $` for a player whose locale
 * groups that way (usually with a no-break space). Reading only up to the
 * space made that stack 3 and a 1 250 bet 1.
 */
const AMOUNT = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?(?!\d)|\d[\d.,]*/g;

/**
 * The first amount in a piece of text, in hundredths: `$0.05` is 5, `0.25€` is
 * 25, `1,500` chips is 150000. Null when there is no number in it.
 */
export const readAmount = (text: string): number | null => {
  const match = new RegExp(AMOUNT.source).exec(text);
  if (!match) return null;
  // A sentence can end on the amount: "posts big blind [$0.10 USD]." and
  // "collected $1.50." both put a stop after the last digit.
  const digits = match[0].replace(/[ \u00a0\u202f]/g, '').replace(/[.,]+$/, '');
  const value = toNumeric(digits);
  return value === null ? null : Math.round(value * 100);
};

/** Every amount in a piece of text, summed: `[$1 + $2]` is 300. */
export const sumAmounts = (text: string): number =>
  (text.match(AMOUNT) ?? []).reduce((sum, token) => sum + (readAmount(token) ?? 0), 0);

/**
 * Cards as a site writes them, `[Ah Kd]`, `[ 3d, Jc ]`, `[10h 9h]`, in Log's
 * notation. Null unless every card reads and none repeats, so a malformed line
 * produces no cards rather than wrong ones.
 */
export const readCards = (text: string): string | null => {
  const tokens = text
    .replace(/[[\],]/g, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return null;
  const cards = tokens.map((token) => {
    const rank = token.slice(0, -1).toUpperCase();
    const suit = token.slice(-1).toLowerCase();
    return `${rank === '10' ? 'T' : rank}${suit}`;
  });
  const notation = cards.join('');
  return parseNotation(notation) === null ? null : notation;
};

/** The game, from the words a header uses for it. */
export const readGameType = (text: string): GameType => {
  const lower = text.toLowerCase();
  const omaha = lower.includes('omaha');
  const potLimit = /pot[ -]?limit|\bpl\b|\bplo\b/.test(lower);
  const noLimit = /no[ -]?limit|\bnl\b|\bnlh/.test(lower);
  const holdem = /hold'?em|holdem/.test(lower);
  if (omaha && potLimit && !/hi[ -/]?lo|8 or better/.test(lower)) return 'PLO';
  if (holdem && noLimit) return 'NLHE';
  return 'OTHER';
};

/**
 * Seat labels for the players dealt in, in the order they sit after the button.
 *
 * `order` runs from the first seat after the button round to the button
 * itself, so its last entry is the button. Heads-up the button is also the
 * small blind, and is labeled as the button, which is how the seat is talked
 * about; the other player is the big blind.
 *
 * At a full table the seats between the big blind and the button run UTG,
 * then UTG+1, MP, LJ, HJ, CO counted back from the button, so a six-handed
 * table reads UTG, HJ, CO and a nine-handed one uses every label Log has.
 */
export const positionsAround = (order: readonly string[]): Map<string, Position> => {
  const labels = new Map<string, Position>();
  const n = order.length;
  if (n === 0) return labels;
  labels.set(order[n - 1], 'BTN');
  if (n === 2) {
    labels.set(order[0], 'BB');
    return labels;
  }
  if (n === 1) return labels;
  labels.set(order[0], 'SB');
  labels.set(order[1], 'BB');
  const middle = order.slice(2, n - 1);
  if (middle.length === 0) return labels;
  labels.set(middle[0], 'UTG');
  const backwards: Position[] = ['CO', 'HJ', 'LJ', 'MP', 'UTG1'];
  for (let i = middle.length - 1, step = 0; i >= 1; i -= 1, step += 1) {
    labels.set(middle[i], backwards[Math.min(step, backwards.length - 1)]);
  }
  return labels;
};

export interface Seat {
  seat: number;
  name: string;
  stack: number | null;
  /** Sitting out, so not dealt in and not counted for positions. */
  out: boolean;
}

/** Players dealt in, ordered from the first seat after the button round to the button. */
export const orderFromButton = (seats: readonly Seat[], button: number | null): string[] => {
  const live = seats.filter((seat) => !seat.out);
  if (button === null) return [];
  const distance = (seat: number) => {
    const ahead = seat - button;
    // The button's own seat is furthest round, not nearest.
    return ahead <= 0 ? ahead + 1000 : ahead;
  };
  return [...live].sort((a, b) => distance(a.seat) - distance(b.seat)).map((seat) => seat.name);
};

/**
 * The name at the start of a line, when it is one of the players seated.
 *
 * Names can hold spaces, colons and brackets, so this checks the seated names
 * rather than guessing where a name ends, longest first so that "Bob" never
 * claims a line that belongs to "Bob Smith".
 */
export const actorOf = (
  line: string,
  names: readonly string[],
): { name: string; rest: string } | null => {
  for (const name of names) {
    if (!line.startsWith(name)) continue;
    const after = line.slice(name.length);
    if (after.startsWith(': ')) return { name, rest: after.slice(2).trim() };
    if (after.startsWith(' ')) return { name, rest: after.slice(1).trim() };
  }
  return null;
};

/** `Dealt to Name [Ah Kd]`: a player's cards, which a site shows face up only for its own player, mostly. */
const DEALT = /^Dealt to (.+?) \[([^\]]+)\]/;

/** How many hands in a file each name was dealt cards in, face up. */
export const dealtCounts = (hands: readonly (readonly string[])[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const lines of hands) {
    const names = new Set<string>();
    for (const line of lines) {
      const dealt = DEALT.exec(line);
      if (dealt) names.add(dealt[1]);
    }
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
};

/**
 * Whose hand this is: of the players dealt cards face up, the one dealt them
 * in the most hands of the file.
 *
 * A site writes the cards of the player who downloaded the file, but not only
 * theirs: GGPoker writes a `Dealt to` line with cards for everyone who showed,
 * and a hand history someone else saved has their name on it. Taking the first
 * such line made whoever sat in the lowest seat the player whenever cards were
 * shown, with their cards and their result. The player is the one dealt in
 * every hand; a tie goes to the first line, as before.
 */
export const readHero = (
  lines: readonly string[],
  counts: ReadonlyMap<string, number>,
): { hero: string; holeCards: string | null } | null => {
  let best: { hero: string; holeCards: string | null; count: number } | null = null;
  for (const line of lines) {
    const dealt = DEALT.exec(line);
    if (!dealt) continue;
    const count = counts.get(dealt[1]) ?? 0;
    if (best === null || count > best.count) {
      best = { hero: dealt[1], holeCards: readCards(dealt[2]), count };
    }
  }
  return best && { hero: best.hero, holeCards: best.holeCards };
};

export const longestFirst = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => b.length - a.length);

/**
 * What went in and what came out, player by player, one street at a time.
 *
 * `street` is what each player has put in since the street began, which is
 * what a raise "to" is measured against. The hero's totals are all anything
 * downstream reads; the other players are here because an uncalled bet can
 * only be worked out by comparing what everyone put in.
 */
export class Ledger {
  private street = new Map<string, number>();
  /** The part of `street` the player chose to put in: everything but a blind. */
  private chosen = new Map<string, number>();
  private putIn = new Map<string, number>();
  private won = new Map<string, number>();

  /** Money in the pot that counts toward the street: a call, a bet, a raise. */
  put(player: string, amount: number): void {
    this.blind(player, amount);
    this.chosen.set(player, (this.chosen.get(player) ?? 0) + amount);
  }

  /** A live blind: it counts toward the street, but nobody chose to bet it. */
  blind(player: string, amount: number): void {
    this.street.set(player, (this.street.get(player) ?? 0) + amount);
    this.putIn.set(player, (this.putIn.get(player) ?? 0) + amount);
  }

  /** Money in the pot that does not count toward the street, an ante or a dead blind. */
  dead(player: string, amount: number): void {
    this.putIn.set(player, (this.putIn.get(player) ?? 0) + amount);
  }

  /** A raise written as the street total it comes to. */
  raiseTo(player: string, total: number): void {
    const already = this.street.get(player) ?? 0;
    this.put(player, Math.max(0, total - already));
  }

  returned(player: string, amount: number): void {
    this.putIn.set(player, (this.putIn.get(player) ?? 0) - amount);
    this.street.set(player, (this.street.get(player) ?? 0) - amount);
    this.chosen.set(player, (this.chosen.get(player) ?? 0) - amount);
  }

  collect(player: string, amount: number): void {
    this.won.set(player, (this.won.get(player) ?? 0) + amount);
  }

  /**
   * Hand back whatever the biggest bet on this street had over the next one.
   *
   * For the formats that return an uncalled bet without writing a line to say
   * so, and then write the pot collected without it. Only a bet comes back,
   * never a blind: when everyone folds to the big blind, 888poker writes the
   * whole pot as collected, the big blind's own blind included, so handing
   * the half the small blind did not match back as well counted it twice.
   */
  refundUncalled(): void {
    const amounts = [...this.street.entries()].sort((a, b) => b[1] - a[1]);
    if (amounts.length === 0) return;
    const [top, second] = amounts;
    const excess = Math.min(top[1] - (second?.[1] ?? 0), this.chosen.get(top[0]) ?? 0);
    if (excess > 0) this.returned(top[0], excess);
  }

  newStreet(): void {
    this.street = new Map();
    this.chosen = new Map();
  }

  net(player: string): number {
    return (this.won.get(player) ?? 0) - (this.putIn.get(player) ?? 0);
  }
}
