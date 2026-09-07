/**
 * What the words on screen mean, for somebody who does not already know.
 *
 * The app labels a chip `UTG` and a stat tile `Swing` and assumes the reader
 * speaks poker. Most of them do. The ones who do not are exactly the players a
 * tracker is most use to, and they are not going to ask.
 *
 * ## Why this is beside the types rather than in a screen
 *
 * `POSITIONS` and `HAND_TAGS` live in `types.ts`, and these are keyed by those
 * unions as `Record<Position, ...>` and `Record<HandTag, ...>`. That is the
 * point of the shape: **a new position cannot be added without the compiler
 * asking what it means.** A glossary that lived next to the component it
 * happened to be used in would fall behind the first time somebody added a seat.
 *
 * ## What is in and what is not
 *
 * Only words the app actually puts on screen. A general poker glossary would be
 * a nicer thing to browse and a worse thing to maintain: every entry that is not
 * anchored to a label somewhere is an entry nobody will notice going stale, and
 * `glossary.test.ts` holds this to the labels it claims to explain.
 *
 * The register is the same as the rest of the app: plain, one or two sentences,
 * and where a term has a reason behind it the reason is more useful than the
 * definition. Knowing the cutoff is one seat right of the button is worth less
 * than knowing it is called that because it cuts off the button's steal.
 */

import { HAND_TAGS, HAND_TAG_LABELS, POSITIONS, type HandTag, type Position } from './types';

export interface GlossaryEntry {
  /** Exactly as the app labels it, so a reader can match the two up. */
  term: string;
  /** One or two sentences. No jargon that is not itself in here. */
  says: string;
}

/**
 * The nine seats, in the order they act before the flop.
 *
 * Written for a player who knows the game and not the shorthand, which is the
 * common case: everybody knows what the button is and fewer people know that
 * `LJ` is a seat at all.
 */
export const POSITION_HELP: Record<Position, GlossaryEntry> = {
  UTG: {
    term: 'UTG',
    says: 'Under the gun. First to act before the flop, immediately left of the big blind, and the hardest seat to open from because the whole table is still behind you.',
  },
  UTG1: {
    term: 'UTG1',
    says: 'One seat along from under the gun. Still early, still acting before almost everybody.',
  },
  MP: {
    term: 'MP',
    says: 'Middle position. Past the early seats and not yet into the late ones.',
  },
  LJ: {
    term: 'LJ',
    says: 'Lojack. Three seats before the button, and the first seat most players treat as late position.',
  },
  HJ: {
    term: 'HJ',
    says: 'Hijack. Two seats before the button, named for taking the cutoff’s steal before they can make it.',
  },
  CO: {
    term: 'CO',
    says: 'Cutoff. Immediately right of the button, named for cutting off the button’s steal.',
  },
  BTN: {
    term: 'BTN',
    says: 'The button. Last to act on every street after the flop, which is what makes it the most profitable seat at the table.',
  },
  SB: {
    term: 'SB',
    says: 'Small blind. Posts the smaller forced bet and then acts first on every street after the flop, which is the worst pair of things to be doing at once.',
  },
  BB: {
    term: 'BB',
    says: 'Big blind. Posts the larger forced bet, acts last before the flop and second after it. It is also the unit results are measured in here.',
  },
};

/** The four tags, in the words the tag itself uses. */
export const HAND_TAG_HELP: Record<HandTag, GlossaryEntry> = {
  bad_beat: {
    term: HAND_TAG_LABELS.bad_beat,
    says: 'You got the money in ahead and lost anyway. Painful, and not a mistake.',
  },
  misplayed: {
    term: HAND_TAG_LABELS.misplayed,
    says: 'Your own flag for a hand worth looking at again. The question mark is deliberate: it is a note to yourself, not a verdict.',
  },
  cooler: {
    term: HAND_TAG_LABELS.cooler,
    says: 'Two big hands running into each other, where the money was always going in. Nobody played it badly.',
  },
  bluff: {
    term: HAND_TAG_LABELS.bluff,
    says: 'A bet with a hand that only wins if everybody folds.',
  },
};

/**
 * The numbers, which are the other half of the jargon and the more misleading
 * half, because a number looks like it needs no explanation.
 *
 * Each of these labels a tile the app shows. `Swing` is the one worth the words:
 * a player who does not know how large it is relative to a win rate has no way
 * to read anything else on that screen.
 */
export const STAT_HELP: readonly GlossaryEntry[] = [
  {
    term: 'bb/hr',
    says: 'Big blinds per hour. Results are counted in blinds rather than money so that a night at 1/2 and a night at 5/10 can be compared at all.',
  },
  {
    term: 'Win rate',
    says: 'Your rate over the long run, in big blinds per hour. It takes far more hours to measure than most players expect, which is what the confidence band on this screen is about.',
  },
  {
    term: 'Swing',
    says: 'Standard deviation: how far a typical hour strays from your win rate. In no-limit hold’em it is usually several times the win rate, which is precisely why a short stretch says so little.',
  },
  {
    term: 'ROI',
    says: 'Return on investment. Profit as a percentage of everything put in, which is how tournament results are normally quoted.',
  },
];

/** The positions in seat order, which is the order they are worth reading in. */
export const positionGlossary = (): GlossaryEntry[] =>
  POSITIONS.map((position) => POSITION_HELP[position]);

/** The tags in the order the picker offers them. */
export const handTagGlossary = (): GlossaryEntry[] => HAND_TAGS.map((tag) => HAND_TAG_HELP[tag]);
