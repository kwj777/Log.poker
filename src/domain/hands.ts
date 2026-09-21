/**
 * What a pile of logged hands adds up to.
 *
 * ## Why this did not exist
 *
 * Log asks for a hand at the table -- two cards, the board, the seat, tags, the
 * pot swing and a note -- which is the most expensive interaction in the app
 * and the one most likely to be skipped. All of it was stored correctly and
 * read back by exactly one kind of screen: the one about a single session.
 * There was no way to see your hands, and `position` in particular was
 * collected on every hand and read by nothing anywhere.
 *
 * ## The honesty problem, which is the whole design of this file
 *
 * **These are the hands somebody chose to log, not the hands they played.** A
 * bad beat is memorable and a folded blind is not, so the set is selected by
 * what stuck rather than by anything a statistician would recognize. Grouping
 * it by seat and drawing bars produces something that looks exactly like a
 * positional win rate and is not one: a win rate is over every hand dealt, and
 * this is over the handful that were worth typing out.
 *
 * So nothing here is called a rate, nothing is divided by anything, and every
 * group carries `count` beside `net` -- because the count is what tells a
 * reader this is a record of thirty hands rather than a measurement of their
 * game. The screens that draw these say the same thing in words. Getting that
 * wrong would make it the first dishonest number in the app, on a page whose
 * other cards are careful about exactly this.
 *
 * ## Pot swing, and the hands that have none
 *
 * `amount` is optional on a hand and most hands do not carry one: a player
 * logging a cooler at the table is recording that it happened, and stopping to
 * total the pot is a second decision. `net` is therefore a sum over a subset,
 * and `withAmount` says how big that subset is so a group of two priced hands
 * inside twenty is never read as twenty hands' worth of money.
 */

import { HAND_TAG_LABELS, POSITIONS, type Cents, type Hand, type HandTag, type Position } from './types';

export interface HandGroup {
  key: string;
  label: string;
  /** Logged hands in this group. */
  count: number;
  /** How many of them recorded a pot swing. `net` is the sum over these. */
  withAmount: number;
  /** Net pot swing across the priced hands, which may be none of them. */
  net: Cents;
}

export interface HandTotals {
  count: number;
  withAmount: number;
  net: Cents;
  /** Hands carrying at least one tag, which is what the tag groups are drawn from. */
  tagged: number;
  /** Hands that recorded a seat. */
  seated: number;
}

const emptyGroup = (key: string, label: string): HandGroup => ({
  key,
  label,
  count: 0,
  withAmount: 0,
  net: 0,
});

const add = (group: HandGroup, hand: Hand): void => {
  group.count += 1;
  if (hand.amount !== null && hand.amount !== 0) {
    group.withAmount += 1;
    group.net += hand.amount;
  }
};

/**
 * Hands by tag.
 *
 * A hand carrying two tags counts in both, which is the only reading that is
 * not misleading: a hand that was a cooler *and* a bluff belongs in both piles,
 * and picking one would quietly drop the other from a list somebody is using to
 * decide what they keep doing. It does mean the counts sum to more than the
 * number of hands, which is why `handTotals` reports `tagged` separately rather
 * than leaving anybody to add these up.
 *
 * Untagged hands are absent rather than bucketed as "none": most logged hands
 * carry no tag, so a bar for them would tower over the four that mean
 * something and say nothing at all.
 */
export const byTag = (hands: readonly Hand[]): HandGroup[] => {
  const buckets = new Map<string, HandGroup>();
  for (const hand of hands) {
    for (const tag of hand.tags) {
      const bucket = buckets.get(tag) ?? emptyGroup(tag, HAND_TAG_LABELS[tag as HandTag] ?? tag);
      add(bucket, hand);
      buckets.set(tag, bucket);
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
};

/**
 * Hands by seat, in seat order rather than by size.
 *
 * Every other breakdown in the app sorts by result, because "where am I making
 * money" is the question. This one does not: the seats have an order that
 * means something, a reader scanning for the blinds expects to find them at
 * the end, and sorting by pot swing would reorder the list every time a hand
 * is logged. Seats with nothing logged are left out rather than drawn as
 * zero.
 */
export const byPosition = (hands: readonly Hand[]): HandGroup[] => {
  const buckets = new Map<Position, HandGroup>();
  for (const hand of hands) {
    if (hand.position === null) continue;
    const bucket = buckets.get(hand.position) ?? emptyGroup(hand.position, hand.position);
    add(bucket, hand);
    buckets.set(hand.position, bucket);
  }
  return POSITIONS.map((position) => buckets.get(position)).filter(
    (group): group is HandGroup => group !== undefined,
  );
};

export const handTotals = (hands: readonly Hand[]): HandTotals => {
  let withAmount = 0;
  let net = 0;
  let tagged = 0;
  let seated = 0;
  for (const hand of hands) {
    if (hand.amount !== null && hand.amount !== 0) {
      withAmount += 1;
      net += hand.amount;
    }
    if (hand.tags.length > 0) tagged += 1;
    if (hand.position !== null) seated += 1;
  }
  return { count: hands.length, withAmount, net, tagged, seated };
};

/**
 * What a group is, in a sentence, for the label on a row a screen reader
 * reaches.
 *
 * Says the count first and the money second, deliberately: the count is the
 * caveat, and a row that opens with a figure has already been read as a result
 * by somebody who moves on before the rest arrives.
 */
export const describeGroup = (
  group: HandGroup,
  money: (cents: Cents) => string,
): string => {
  const hands = `${group.count} hand${group.count === 1 ? '' : 's'}`;
  if (group.withAmount === 0) return `${group.label}: ${hands}, none with a pot recorded.`;
  const priced =
    group.withAmount === group.count
      ? 'all of them priced'
      : `${group.withAmount} of them priced`;
  return `${group.label}: ${hands}, ${priced}, ${money(group.net)} across those.`;
};
