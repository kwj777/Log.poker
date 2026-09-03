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

import { isComplete, netResult, durationHours, totalInvested } from './stats';
import type { Cents, SessionWithChildren } from './types';

export const isTournament = (session: { format: string }): boolean =>
  session.format === 'tournament';

/**
 * Below this, an ROI is a record of what happened rather than an estimate of
 * anything. Even at this many it is thin -- the number moves a long way on one
 * final table -- which is why the copy says so rather than hiding behind a
 * threshold.
 */
export const MIN_TOURNAMENTS_FOR_ROI = 100;

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
  biggestScore: Cents | null;
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
  biggestScore: null,
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
  let biggestScore: Cents | null = null;
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
    if (biggestScore === null || net > biggestScore) biggestScore = net;

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
    biggestScore,
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
  roiIsMeaningful: boolean;
  /** True when the copy should offer an Untilt.poker nudge. */
  suggestsUntilt: boolean;
}

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/**
 * What to say to a tournament player about their own numbers.
 *
 * Written to the same rule as the cash-game copy: true first, calming second,
 * and never implying the player is broken or that anything is owed to them. The
 * difference is that this one has to be honest about how little an ROI over a
 * few dozen entries means, rather than dressing a small sample as a verdict.
 */
export const assessTournaments = (totals: TournamentTotals): TournamentAssessment => {
  if (totals.entries === 0) {
    return {
      headline: 'No tournaments yet',
      body: 'Log one and this fills in: cash rate, ROI, and how ordinary your current dry run is.',
      roiIsMeaningful: false,
      suggestsUntilt: false,
    };
  }

  const roiIsMeaningful = totals.entries >= MIN_TOURNAMENTS_FOR_ROI;
  const rate = totals.itmRate ?? 0;
  const dry = totals.currentDryRun;
  const odds = probabilityOfDryRun(rate, dry);

  const sample = roiIsMeaningful
    ? `Across ${totals.entries} entries that ROI is starting to mean something, though it still moves a long way on one deep run.`
    : `That is ${totals.entries} entr${totals.entries === 1 ? 'y' : 'ies'}, which is a record of what happened rather than a measurement of how you play. Tournament ROI is carried by rare big scores, so it needs several hundred entries before it settles -- and until then the honest reading is that it is not yet a number about you.`;

  if (dry >= 2 && odds !== null) {
    const median = medianDryRun(rate);
    const typical =
      median === null
        ? ''
        : ` At that rate, half of all dry runs go at least ${Math.round(median)} deep.`;
    return {
      headline: `${dry} without a cash`,
      body: `You cash ${percent(rate)} of the time, so missing ${dry} in a row comes up about ${percent(
        odds,
      )} of the time -- it is the ordinary shape of the game, not a sign anything has changed.${typical} ${sample}`,
      roiIsMeaningful,
      suggestsUntilt: odds < 0.1,
    };
  }

  return {
    headline: totals.cashes > 0 ? `Cashing ${percent(rate)} of the time` : 'No cashes yet',
    body:
      totals.cashes > 0
        ? `${totals.cashes} cash${totals.cashes === 1 ? '' : 'es'} from ${totals.entries} entr${
            totals.entries === 1 ? 'y' : 'ies'
          }. ${sample}`
        : `Nothing has come back yet from ${totals.entries} entr${
            totals.entries === 1 ? 'y' : 'ies'
          }. That is a short enough run that it says very little: most tournament entries end with nothing, for everybody. ${sample}`,
    roiIsMeaningful,
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
