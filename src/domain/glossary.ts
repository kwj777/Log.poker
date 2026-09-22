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

import { FIELD_LABELS, IMPORT_FIELDS, type ImportField } from './import';
import { HAND_TAGS, HAND_TAG_LABELS, POSITIONS, type HandTag, type Position } from './types';

export interface GlossaryEntry {
  /** Exactly as the app labels it, so a reader can match the two up. */
  term: string;
  /** One or two sentences. No jargon that is not itself in here. */
  says: string;
  /**
   * The label on screen this explains, when the app does not print the term.
   *
   * `Rake` is what a player calls it and `Fees paid` is what the tile says, so
   * an entry headed `Rake` would fail the anchoring rule for the wrong reason.
   * The rule follows this where it is set.
   */
  anchor?: string;
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
  {
    term: 'Rake',
    anchor: 'Fees paid',
    says: 'What the house takes. In a tournament it is the entry fee, the +10 in $100+$10, kept apart from the buy-in here so a year of it can be totaled. Cash-game rake comes out of the pots rather than off your buy-in, so nothing here can see it and this total covers tournaments only.',
  },
];

/**
 * The columns an import can read, named as the mapping names them.
 *
 * Keyed by `ImportField` for the same reason the seats are keyed by `Position`:
 * a new column cannot be added without the compiler asking what it is. The
 * terms are asserted equal to `FIELD_LABELS`, so the sheet reads exactly as the
 * arrow on screen does.
 *
 * Two of these are the reason the group exists at all. **Cash-out and Result
 * are not the same measurement**, and a file often has both: cash-out is what
 * you left the table with and is taken directly, while a result is a number
 * somebody already derived, so it is used only where there is no cash-out
 * column. Somebody mapping a spreadsheet has no way to know that, and getting
 * it backwards is silent.
 */
export const IMPORT_HELP: Record<ImportField, GlossaryEntry> = {
  startedAt: {
    term: FIELD_LABELS.startedAt,
    says: 'When the session began, from a date or a date and time. This is the one column an import cannot do without.',
  },
  endedAt: {
    term: FIELD_LABELS.endedAt,
    says: 'When it finished. With neither this nor a duration, the session is recorded as ending when it started, which keeps it out of anything measured per hour rather than inventing a length for it.',
  },
  duration: {
    term: FIELD_LABELS.duration,
    says: 'How long you played, for a file that says that instead of an end time. Either one answers the same question.',
  },
  format: {
    term: FIELD_LABELS.format,
    says: 'Which kind of session. Worked out from the row when the file does not say: anything carrying an entry fee, a field size or a finishing position is read as a tournament.',
  },
  gameType: {
    term: FIELD_LABELS.gameType,
    says: 'Hold’em, Omaha or something else. Used for grouping and nothing more, so a name Log does not know is filed under Other rather than refusing the row.',
  },
  stakes: {
    term: FIELD_LABELS.stakes,
    says: 'The blinds, like 1/2. A row without them still imports and simply stays out of the win-rate estimate, because a plausible-looking guess would poison it.',
  },
  venue: {
    term: FIELD_LABELS.venue,
    says: 'Where you played. Venues are created from the names in the file as it is read, so the spelling in your spreadsheet is the spelling you get.',
  },
  buyIn: {
    term: FIELD_LABELS.buyIn,
    says: 'What you put on the table to start, before any rebuys.',
  },
  fee: {
    term: FIELD_LABELS.fee,
    says: 'A tournament’s rake, kept apart from the buy-in. Its presence is also one of the signals that a row is a tournament at all.',
  },
  cashOut: {
    term: FIELD_LABELS.cashOut,
    says: 'What you left the table with. This is the direct measurement, so it wins over a result column when a file carries both.',
  },
  result: {
    term: FIELD_LABELS.result,
    says: 'Profit or loss for the session. Derived by whoever made the file rather than measured, so it is used only where there is no cash-out column.',
  },
  entrants: {
    term: FIELD_LABELS.entrants,
    says: 'How many played, for a tournament. It is what makes a finishing position mean anything: 40th of 50 and 40th of 2,000 are not the same night.',
  },
  finishPosition: {
    term: FIELD_LABELS.finishPosition,
    says: 'Where you placed, 1 being the win. On its own it says little: 40th means one thing in a fifty-runner and quite another in a two-thousand, which is what the field size beside it is for.',
  },
  notes: {
    term: FIELD_LABELS.notes,
    says: 'Whatever the file kept alongside the row. Carried across as written rather than parsed, so nothing in it changes a number.',
  },
  currency: {
    term: FIELD_LABELS.currency,
    says: 'Which money the numbers are in. Read from a column or from the money cells themselves, and falling back to this app’s own setting when neither says.',
  },
};

/** The positions in seat order, which is the order they are worth reading in. */
export const positionGlossary = (): GlossaryEntry[] =>
  POSITIONS.map((position) => POSITION_HELP[position]);

/** The tags in the order the picker offers them. */
export const handTagGlossary = (): GlossaryEntry[] => HAND_TAGS.map((tag) => HAND_TAG_HELP[tag]);

/** The columns in the order the mapping lists them. */
export const importGlossary = (): GlossaryEntry[] =>
  IMPORT_FIELDS.map((field) => IMPORT_HELP[field]);
