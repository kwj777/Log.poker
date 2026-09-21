/**
 * Tournament math.
 *
 * A tournament is not a cash session with different words. Its result is zero
 * most nights and enormous occasionally: the distribution is dominated by a
 * handful of deep runs, and the average is dragged around by whether one of them
 * has happened yet. That shape is why `variance.ts` refuses to touch these
 * sessions -- a Gaussian random walk in big blinds per hour would hand a
 * tournament player a confidence band that looks authoritative and is wrong.
 *
 * What is honest to say instead is here, and it is less than a cash player gets:
 *
 * - **ROI and ITM** are descriptions of what happened. They are reported as
 *   exactly that, and the copy says outright how large a sample an ROI needs
 *   before it is a measurement rather than a record.
 * - **The dry run** is the one genuinely inferential number, and it is honest
 *   because it needs no distribution: whether each entry cashes is a coin the
 *   player flips at their own rate, so the chance of missing `n` in a row is
 *   `(1 - rate)^n`. That is the question a tournament player actually asks at
 *   two in the morning, and it usually has a calming answer.
 */

import { makeRandom } from './random';
import { isComplete, netResult, durationHours, totalInvested } from './stats';
import type { ConfidenceLevel } from './variance';
import type { Cents, SessionWithChildren } from './types';

export const isTournament = (session: { format: string }): boolean =>
  session.format === 'tournament';

export interface TournamentTotals {
  /** Completed tournaments. Live ones have no result yet. */
  entries: number;
  invested: Cents;
  /** Prize money returned across every entry. */
  returned: Cents;
  net: Cents;
  /** Net over invested, as a fraction: 0.15 is a 15% ROI. Null with nothing in. */
  roi: number | null;
  /** Entries that paid anything at all. */
  cashes: number;
  /** Cashes over entries, as a fraction. Null with no entries. */
  itmRate: number | null;
  /** Entry fees paid -- the rake, which never comes back. */
  fees: Cents;
  /**
   * The best *net* result, not the biggest prize. Named for what it holds: it
   * was `biggestScore` over a value computed from `netResult`, which is a
   * different number the moment an entry fee or a re-entry is involved.
   */
  biggestNet: Cents | null;
  bestFinish: number | null;
  /**
   * Mean finishing position as a fraction of the field, over the entries where
   * both are known: 0.1 means finishing in the top tenth on average.
   */
  averageFinishPercentile: number | null;
  /** How many entries had both a finish and a field size recorded. */
  finishesKnown: number;
  /** Entries since the last cash, counting back from the most recent. */
  currentDryRun: number;
  hours: number;
  hourly: Cents | null;
}

const EMPTY: TournamentTotals = {
  entries: 0,
  invested: 0,
  returned: 0,
  net: 0,
  roi: null,
  cashes: 0,
  itmRate: null,
  fees: 0,
  biggestNet: null,
  bestFinish: null,
  averageFinishPercentile: null,
  finishesKnown: 0,
  currentDryRun: 0,
  hours: 0,
  hourly: null,
};

/**
 * Roll up completed tournaments.
 *
 * "Cashed" is read off the prize rather than the finishing position, so a file
 * that recorded what was won but not where it came works exactly as well -- and
 * an import that knows neither still lands in the bankroll.
 */
export const tournamentTotals = (
  sessions: readonly SessionWithChildren[],
): TournamentTotals => {
  const entries = sessions
    .filter((session) => isTournament(session) && isComplete(session))
    .slice()
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));

  if (entries.length === 0) return { ...EMPTY };

  let invested = 0;
  let returned = 0;
  let fees = 0;
  let cashes = 0;
  let hours = 0;
  let biggestNet: Cents | null = null;
  let bestFinish: number | null = null;
  let percentileSum = 0;
  let finishesKnown = 0;

  for (const session of entries) {
    const net = netResult(session, session.rebuys) ?? 0;
    invested += totalInvested(session, session.rebuys);
    returned += session.cashOut ?? 0;
    fees += session.fee ?? 0;
    hours += durationHours(session);
    if ((session.cashOut ?? 0) > 0) cashes += 1;
    if (biggestNet === null || net > biggestNet) biggestNet = net;

    const { finishPosition, entrants } = session;
    if (finishPosition !== null && finishPosition > 0) {
      if (bestFinish === null || finishPosition < bestFinish) bestFinish = finishPosition;
      if (entrants !== null && entrants > 0) {
        percentileSum += finishPosition / entrants;
        finishesKnown += 1;
      }
    }
  }

  let currentDryRun = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if ((entries[i].cashOut ?? 0) > 0) break;
    currentDryRun += 1;
  }

  const net = returned - invested;
  return {
    entries: entries.length,
    invested,
    returned,
    net,
    roi: invested > 0 ? net / invested : null,
    cashes,
    itmRate: cashes / entries.length,
    fees,
    biggestNet,
    bestFinish,
    averageFinishPercentile: finishesKnown > 0 ? percentileSum / finishesKnown : null,
    finishesKnown,
    currentDryRun,
    hours,
    hourly: hours > 0 ? Math.round(net / hours) : null,
  };
};

/**
 * The chance of missing `length` entries in a row at a given cash rate.
 *
 * Independence is the assumption, and for tournament entries it is a fair one:
 * whether tonight's turns into a cash has nothing to do with last night's. That
 * is what makes this the one inferential number here worth trusting -- it needs
 * no shape for the payouts, only the rate.
 */
export const probabilityOfDryRun = (itmRate: number, length: number): number | null => {
  if (itmRate <= 0 || itmRate >= 1 || length <= 0) return null;
  return (1 - itmRate) ** length;
};

/** How many entries it takes before a run this dry is more likely than not. */
export const medianDryRun = (itmRate: number): number | null => {
  if (itmRate <= 0 || itmRate >= 1) return null;
  return Math.log(0.5) / Math.log(1 - itmRate);
};

export interface TournamentAssessment {
  headline: string;
  body: string;
  /** Whether the ROI above is a measurement or just a record of what happened. */
  /** True when the copy should offer an Untilt.poker nudge. */
  suggestsUntilt: boolean;
}

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/**
 * What to say to a tournament player about their own numbers.
 *
 * Written to the same rule as the cash-game copy: true first, calming second,
 * and never implying the player is broken or that anything is owed to them.
 *
 * Kept narrowly to the dry run and the cash rate. What an ROI over this many
 * entries is worth used to be a sentence here, guessing from a threshold; it is
 * now `assessRoi`, which resamples the results and answers with a range. Saying
 * it in both places would put the same paragraph on the screen twice, and only
 * one of them would have a number in it.
 */
export const assessTournaments = (totals: TournamentTotals): TournamentAssessment => {
  if (totals.entries === 0) {
    return {
      headline: 'No tournaments yet',
      body: 'Log one and this fills in: cash rate, ROI, and how ordinary your current dry run is.',
      suggestsUntilt: false,
    };
  }

  const rate = totals.itmRate ?? 0;
  const dry = totals.currentDryRun;
  const odds = probabilityOfDryRun(rate, dry);

  if (dry >= 2 && odds !== null) {
    const median = medianDryRun(rate);
    const typical =
      median === null
        ? ''
        : ` At that rate, half of all dry runs go at least ${Math.round(median)} deep.`;
    // The reading has to change when the number does. This said "the ordinary
    // shape of the game, not a sign anything has changed" whatever `odds` came
    // out at -- including the runs rare enough that the same function turns
    // round and offers Untilt over them. A run in the longest tenth is still
    // not evidence the player has got worse, and saying so is different from
    // calling it ordinary.
    const reading =
      odds < 0.1
        ? 'that is a long one even for this game, and a long one is still variance rather than a sign your edge has gone'
        : 'it is the ordinary shape of the game, not a sign anything has changed';
    return {
      headline: `${dry} without a cash`,
      body: `You cash ${percent(rate)} of the time, so missing ${dry} in a row comes up about ${percent(
        odds,
      )} of the time -- ${reading}.${typical}`,
      suggestsUntilt: odds < 0.1,
    };
  }

  return {
    headline: totals.cashes > 0 ? `Cashing ${percent(rate)} of the time` : 'No cashes yet',
    body:
      totals.cashes > 0
        ? `${totals.cashes} cash${totals.cashes === 1 ? '' : 'es'} from ${totals.entries} entr${
            totals.entries === 1 ? 'y' : 'ies'
          }.`
        : `Nothing has come back yet from ${totals.entries} entr${
            totals.entries === 1 ? 'y' : 'ies'
          }. That is a short enough run that it says very little: most tournament entries end with nothing, for everybody.`,
    suggestsUntilt: false,
  };
};

/** `12th of 340`, `12th`, or null when neither is known. */
export const formatFinish = (
  finishPosition: number | null,
  entrants: number | null,
): string | null => {
  if (finishPosition === null || finishPosition <= 0) {
    return entrants !== null && entrants > 0 ? `${entrants} entrants` : null;
  }
  const suffix = (value: number): string => {
    const last2 = value % 100;
    if (last2 >= 11 && last2 <= 13) return 'th';
    return ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  };
  const place = `${finishPosition}${suffix(finishPosition)}`;
  return entrants !== null && entrants > 0 ? `${place} of ${entrants}` : place;
};

// --------------------------------------------------------------- the interval

/** What one entry cost and what came back. The only two numbers an ROI needs. */
export interface EntryResult {
  invested: Cents;
  returned: Cents;
}

export const toEntryResults = (
  sessions: readonly SessionWithChildren[],
): EntryResult[] =>
  sessions
    .filter((session) => isTournament(session) && isComplete(session))
    .map((session) => ({
      invested: totalInvested(session, session.rebuys),
      returned: session.cashOut ?? 0,
    }));

/**
 * Below this the resamples are too degenerate to describe anything. The
 * interval above it is often enormous, and that is the point: an enormous
 * interval is the honest answer, and hiding it would leave the bare ROI looking
 * like a measurement.
 */
export const MIN_ENTRIES_FOR_INTERVAL = 10;

/** Enough for a stable percentile interval, cheap enough to run on a phone. */
export const BOOTSTRAP_SAMPLES = 2_000;

/**
 * The most resampling this will do, counted in entries drawn rather than in
 * samples.
 *
 * A bootstrap draws `count` entries per sample, so the work is samples times
 * entries and it is the product that costs time, not either half. At the full
 * 2,000 samples a player with a thousand entries behind them was paying over a
 * second of blocked JavaScript for one line of a stat tile, on a screen that
 * had already drawn everything else.
 *
 * The budget is set so that nothing under a hundred entries is touched at all,
 * which is every player this feature was designed around. Past that it trades
 * resamples for time, and it can: the Monte Carlo error of a percentile falls
 * as one over the root of the sample count, while the interval's own width is
 * set by the data -- so the bigger the entry list, the less the last thousand
 * resamples were telling anybody. The floor keeps that trade from going too
 * far at any size.
 */
export const BOOTSTRAP_DRAW_BUDGET = 200_000;

/** However large the list, never fewer resamples than this. */
export const MIN_BOOTSTRAP_SAMPLES = 500;

/**
 * How many resamples a list of `count` entries gets.
 *
 * Exported because it is the honest answer to "why does my interval say 500
 * samples", which `RoiInterval.samples` puts on the screen.
 */
export const samplesFor = (count: number, requested = BOOTSTRAP_SAMPLES): number => {
  if (count <= 0) return requested;
  const affordable = Math.floor(BOOTSTRAP_DRAW_BUDGET / count);
  return Math.max(MIN_BOOTSTRAP_SAMPLES, Math.min(requested, affordable));
};

/**
 * A string that changes exactly when the interval would.
 *
 * `toEntryResults` builds a new array out of `sessions` every time the store
 * hands out a new one, and the store hands out a new one on every write and
 * every sync -- so a `useMemo` keyed on that array re-ran the whole bootstrap
 * after a rebuy, after a cash-out, and once on hydrate before the dashboard
 * had drawn a pixel. None of those change a tournament result.
 *
 * A string rather than a numeric hash, because the cost this guards is a
 * couple of hundred thousand multiply-adds and the cost of the guard is one
 * pass and one allocation. A hash would be smaller and would, on a collision,
 * show yesterday's interval and say nothing. This cannot.
 *
 * Order is in it: the draw picks by index, so two permutations of the same
 * entries give the same distribution and not the same seeded answer.
 */
export const entriesSignature = (results: readonly EntryResult[]): string =>
  results.map((result) => `${result.invested}/${result.returned}`).join(',');

/**
 * Fixed, so the same results always produce the same interval.
 *
 * This matters more than it looks. An interval that shifted every time the
 * screen re-rendered would be correct on each render and untrustworthy across
 * all of them, and a player watching their own confidence interval twitch would
 * be right not to believe any of it.
 */
const BOOTSTRAP_SEED = 0x10_9c_4a_21;

export type RoiVerdict = 'winning' | 'losing' | 'undetermined';

export interface RoiInterval {
  /** The ROI actually observed, as a fraction. */
  roi: number;
  lower: number;
  upper: number;
  level: ConfidenceLevel;
  entries: number;
  /** How many resamples produced the interval. */
  samples: number;
  /** Whether the whole range clears break even, one way or the other. */
  verdict: RoiVerdict;
}

/** Linear interpolation between order statistics. `sorted` must be ascending. */
const percentileOf = (sorted: readonly number[], fraction: number): number => {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
};

/**
 * A confidence interval on ROI, by resampling the player's own entries.
 *
 * The nonparametric bootstrap: draw `n` entries with replacement from the `n`
 * the player actually has, recompute ROI, and do it a couple of thousand times.
 * The spread of those numbers is the spread of the estimate, and the middle 95%
 * of them is the interval.
 *
 * This is the right tool here precisely because it assumes nothing about the
 * shape of the payouts. `variance.ts` cannot touch tournaments because its model
 * needs results to be roughly symmetric and they are emphatically not; this one
 * needs only the results themselves, whatever shape they came in.
 *
 * What it cannot do is manufacture information. A player with thirty entries
 * and one big score gets an interval driven by how often that score was drawn,
 * which is a lumpy and very wide answer -- and the correct one. `roiConcentration`
 * exists to say so out loud rather than leave the width unexplained.
 */
export const bootstrapRoi = (
  results: readonly EntryResult[],
  options: { level?: ConfidenceLevel; samples?: number; seed?: number } = {},
): RoiInterval | null => {
  const level = options.level ?? 95;
  const count = results.length;
  // Budgeted rather than taken at face value; see `samplesFor`. An explicit
  // `samples` is still a ceiling, so a caller asking for fewer gets fewer.
  const samples = samplesFor(count, options.samples ?? BOOTSTRAP_SAMPLES);
  if (count < MIN_ENTRIES_FOR_INTERVAL || samples < 1) return null;

  const invested = results.reduce((sum, result) => sum + result.invested, 0);
  if (invested <= 0) return null;
  const returned = results.reduce((sum, result) => sum + result.returned, 0);
  const roi = (returned - invested) / invested;

  const random = makeRandom(options.seed ?? BOOTSTRAP_SEED);
  const draws: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let drawnInvested = 0;
    let drawnReturned = 0;
    for (let pick = 0; pick < count; pick += 1) {
      const entry = results[Math.floor(random() * count)];
      drawnInvested += entry.invested;
      drawnReturned += entry.returned;
    }
    if (drawnInvested > 0) draws.push((drawnReturned - drawnInvested) / drawnInvested);
  }
  if (draws.length === 0) return null;
  draws.sort((a, b) => a - b);

  const tail = (1 - level / 100) / 2;
  const lower = percentileOf(draws, tail);
  const upper = percentileOf(draws, 1 - tail);

  return {
    roi,
    lower,
    upper,
    level,
    entries: count,
    samples: draws.length,
    verdict: lower > 0 ? 'winning' : upper < 0 ? 'losing' : 'undetermined',
  };
};

export interface RoiConcentration {
  /** The largest single return as a share of everything that came back. */
  topShare: number;
  /** ROI over the same entries with the single biggest score taken out. */
  roiWithoutTop: number | null;
}

/**
 * How much of the return came from one score.
 *
 * The number that explains the width of the interval above. Tournament money
 * arrives in a few large pieces, so a sample of any realistic size is often one
 * deep run away from telling a different story, and this says how far.
 */
export const roiConcentration = (
  results: readonly EntryResult[],
): RoiConcentration | null => {
  if (results.length === 0) return null;
  const invested = results.reduce((sum, result) => sum + result.invested, 0);
  const returned = results.reduce((sum, result) => sum + result.returned, 0);
  if (invested <= 0 || returned <= 0) return null;

  const top = results.reduce((best, result) => (result.returned > best.returned ? result : best));
  const restInvested = invested - top.invested;
  const restReturned = returned - top.returned;

  return {
    topShare: top.returned / returned,
    roiWithoutTop: restInvested > 0 ? (restReturned - restInvested) / restInvested : null,
  };
};

/** `+15%`, `-8%`, `0%`. */
export const formatRoi = (roi: number): string => {
  const rounded = Math.round(roi * 100);
  // A sign that survives the rounding. An upper bound of -0.4% rounds to zero
  // and used to print a bare "0%", so an interval the code had just called
  // *losing* read "between -12% and 0%" over a sentence asserting the whole
  // range sat below break even. Zero keeps no sign; a number that is only zero
  // because it was rounded keeps the one it had.
  if (rounded === 0) {
    if (roi > 0) return '+0%';
    if (roi < 0) return '-0%';
    return '0%';
  }
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
};

/** Above this, one score is carrying the sample and the copy says so. */
const CONCENTRATION_THRESHOLD = 0.3;

export interface RoiAssessment {
  headline: string;
  body: string;
  /** The line about one score carrying the sample, when one does. */
  concentrationNote: string | null;
  verdict: RoiVerdict | 'insufficient_data';
}

/**
 * What the interval means, in words.
 *
 * Same rule as the rest of the copy in this app: true first, calming second,
 * and never implying the player is broken or that anything is owed to them. The
 * hardest case is the common one, where the interval straddles break even and
 * the honest reading is that the sample cannot tell a winner from a loser. That
 * is written as a fact about tournaments rather than a failing of the player,
 * because that is what it is.
 */
export const assessRoi = (
  interval: RoiInterval | null,
  concentration: RoiConcentration | null,
  entries: number,
): RoiAssessment => {
  const note =
    concentration !== null &&
    concentration.topShare >= CONCENTRATION_THRESHOLD &&
    concentration.roiWithoutTop !== null
      ? `One score is ${Math.round(concentration.topShare * 100)}% of everything that has come back. Without it the same entries read ${formatRoi(
          concentration.roiWithoutTop,
        )}. That is not a reason to discount it, because deep runs are where tournament money comes from, but it is why the range is as wide as it is.`
      : null;

  if (interval === null) {
    const short = Math.max(0, MIN_ENTRIES_FOR_INTERVAL - entries);
    return {
      headline: 'Not enough entries to put a range on it',
      body: `An ROI over ${entries} entr${
        entries === 1 ? 'y' : 'ies'
      } is a record of what happened, not an estimate of anything. Log ${short} more and this page will start resampling your own results to say how wide the honest range around it is.`,
      concentrationNote: null,
      verdict: 'insufficient_data',
    };
  }

  // Reads after "between" in all three headlines below, so: and, not to.
  const range = `${formatRoi(interval.lower)} and ${formatRoi(interval.upper)}`;
  const basis = `Resampling your own ${interval.entries} entries ${interval.samples.toLocaleString(
    'en-US',
  )} times puts your true ROI somewhere in that range, ${interval.level}% of the time.`;

  if (interval.verdict === 'winning') {
    return {
      headline: `Winning, somewhere between ${range}`,
      body: `${basis} The whole range sits above break even, which after ${interval.entries} entries is a real signal rather than a good run. Where in the range is still open, and the low end is the one to plan a bankroll around.`,
      concentrationNote: note,
      verdict: 'winning',
    };
  }

  if (interval.verdict === 'losing') {
    return {
      headline: `Losing, somewhere between ${range}`,
      body: `${basis} The whole range sits below break even. That is worth knowing rather than worth panicking about: it is a reading on the games you have actually been playing, at the buy-ins you have been playing them, and neither of those has to stay the same.`,
      concentrationNote: note,
      verdict: 'losing',
    };
  }

  return {
    headline: `Somewhere between ${range}`,
    body: `${basis} It straddles break even, which means ${interval.entries} entries cannot yet tell a winning tournament player from a losing one. That is a fact about tournaments rather than about you: the results are mostly zeros with a few large numbers in them, and an average made of those takes a very long time to settle.`,
    concentrationNote: note,
    verdict: 'undetermined',
  };
};
