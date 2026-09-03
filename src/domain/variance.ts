/**
 * Variance analysis -- the anti-tilt math.
 *
 * The question this answers is the one every losing stretch provokes: "am I
 * running bad, or am I playing bad?" Statistics can't fully separate those, but
 * it can say whether a stretch is *unremarkable* for a player with your win rate
 * and your swings -- and for most rough stretches, it is.
 *
 * Model
 * -----
 * Results are treated as a random walk in time: over `h` hours a player with win
 * rate `w` (big blinds per hour) and per-hour standard deviation `σ` has a result
 * with mean `w·h` and standard deviation `σ·√h`. Both parameters are estimated
 * from the player's own completed sessions -- never from a hard-coded "typical"
 * number, which would be a guess dressed up as a measurement.
 *
 * Everything is computed in **big blinds**, not currency, so sessions across
 * different stakes pool into one estimate.
 */

import { durationHours, isComplete, netResult } from './stats';
import type { SessionWithChildren } from './types';

/** Below this, the estimates are noise and the UI says so instead of pretending. */
export const MIN_SESSIONS_FOR_ESTIMATE = 8;
export const MIN_HOURS_FOR_ESTIMATE = 20;

export interface SessionObservation {
  sessionId: string;
  /** Result in big blinds. */
  resultBb: number;
  hours: number;
  endedAt: number;
}

/**
 * Reduce sessions to (result in bb, hours) pairs, oldest first.
 *
 * Three kinds of session are dropped, all for the same reason -- they carry a
 * result that cannot be expressed as big blinds per hour:
 *
 * - **Tournaments.** Their blinds move every level, so there is no big blind to
 *   divide by, and their results are not the roughly symmetric distribution this
 *   model assumes: a tournament player loses their entry most nights and is
 *   carried by a handful of scores. Running that through a Gaussian random walk
 *   would produce a confidence band that looks authoritative and is wrong. See
 *   `tournaments.ts` for what is honest to say about them instead.
 * - Sessions whose blinds were never recorded.
 * - Sessions with no measurable duration.
 */
export const toObservations = (
  sessions: readonly SessionWithChildren[],
): SessionObservation[] =>
  sessions
    .filter(isComplete)
    .map((session) => {
      if (session.format !== 'cash' || session.stakes === null) return null;
      const net = netResult(session, session.rebuys);
      const hours = durationHours(session);
      const bigBlind = session.stakes.bigBlind;
      if (net === null || hours <= 0 || bigBlind <= 0) return null;
      return {
        sessionId: session.id,
        resultBb: net / bigBlind,
        hours,
        endedAt: session.endedAt ?? session.startedAt,
      };
    })
    .filter((observation): observation is SessionObservation => observation !== null)
    .sort((a, b) => a.endedAt - b.endedAt);

export interface PlayerEstimate {
  /** Big blinds per hour. */
  winRateBbPerHour: number;
  /** Standard deviation in big blinds per hour of play. */
  stdDevBbPerHour: number;
  totalHours: number;
  totalBb: number;
  sessionCount: number;
  /** True once there is enough history for the numbers to mean something. */
  reliable: boolean;
}

/**
 * Estimate win rate and per-hour standard deviation from a player's own results.
 *
 * Win rate is total big blinds over total hours. Standard deviation uses the
 * method-of-moments estimator for a variance that scales with time --
 * `σ² = Σ(rᵢ − ŵ·hᵢ)² / Σhᵢ` -- with a Bessel-style `n/(n−1)` correction for the
 * one parameter (`ŵ`) estimated from the same data.
 */
export const estimatePlayer = (observations: readonly SessionObservation[]): PlayerEstimate => {
  const sessionCount = observations.length;
  const totalHours = observations.reduce((sum, o) => sum + o.hours, 0);
  const totalBb = observations.reduce((sum, o) => sum + o.resultBb, 0);
  const winRateBbPerHour = totalHours > 0 ? totalBb / totalHours : 0;

  let stdDevBbPerHour = 0;
  if (sessionCount >= 2 && totalHours > 0) {
    const weightedSquares = observations.reduce((sum, o) => {
      const residual = o.resultBb - winRateBbPerHour * o.hours;
      return sum + residual * residual;
    }, 0);
    const correction = sessionCount / (sessionCount - 1);
    stdDevBbPerHour = Math.sqrt((weightedSquares / totalHours) * correction);
  }

  return {
    winRateBbPerHour,
    stdDevBbPerHour,
    totalHours,
    totalBb,
    sessionCount,
    reliable:
      sessionCount >= MIN_SESSIONS_FOR_ESTIMATE && totalHours >= MIN_HOURS_FOR_ESTIMATE,
  };
};

/**
 * Standard normal CDF (Abramowitz & Stegun 26.2.17, |ε| < 7.5e-8).
 * Good to far more precision than a percentage read off a chart needs.
 */
export const normalCdf = (z: number): number => {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
};

/** Two-sided z multipliers for the confidence levels the UI offers. */
export const Z_SCORES = { 70: 1.036, 90: 1.645, 95: 1.96 } as const;
export type ConfidenceLevel = keyof typeof Z_SCORES;

export interface BandPoint {
  hours: number;
  expected: number;
  upper: number;
  lower: number;
  /** The player's own cumulative result at this point, when one exists. */
  actual: number | null;
}

/**
 * The confidence-band series: expected result and the ±z·σ·√h envelope over
 * cumulative hours, with the player's real curve overlaid on the same axis.
 */
export const confidenceBand = (
  estimate: PlayerEstimate,
  observations: readonly SessionObservation[],
  level: ConfidenceLevel = 95,
): BandPoint[] => {
  const z = Z_SCORES[level];
  const { winRateBbPerHour: w, stdDevBbPerHour: sd } = estimate;

  const points: BandPoint[] = [{ hours: 0, expected: 0, upper: 0, lower: 0, actual: 0 }];
  let cumulativeHours = 0;
  let cumulativeBb = 0;

  for (const observation of observations) {
    cumulativeHours += observation.hours;
    cumulativeBb += observation.resultBb;
    const spread = z * sd * Math.sqrt(cumulativeHours);
    const expected = w * cumulativeHours;
    points.push({
      hours: cumulativeHours,
      expected,
      upper: expected + spread,
      lower: expected - spread,
      actual: cumulativeBb,
    });
  }
  return points;
};

export type StretchVerdict =
  | 'insufficient_data'
  | 'running_hot'
  | 'above_expectation'
  | 'normal'
  | 'below_expectation'
  | 'running_bad';

export interface StretchAssessment {
  verdict: StretchVerdict;
  /** How many standard deviations from expectation this stretch sits. */
  z: number;
  /** Fraction of stretches this long that would come out at or below this one. */
  percentile: number;
  hours: number;
  actualBb: number;
  expectedBb: number;
  /** The 95% envelope for a stretch of this length, in big blinds. */
  lowerBb: number;
  upperBb: number;
  sessionCount: number;
  headline: string;
  body: string;
  /** True when the copy should offer an Untilt.poker nudge. */
  suggestsUntilt: boolean;
}

const formatBb = (bb: number): string => `${bb >= 0 ? '+' : ''}${Math.round(bb)} bb`;

const formatHours = (hours: number): string =>
  hours >= 10 ? `${Math.round(hours)}` : `${Math.round(hours * 10) / 10}`;

/**
 * Assess the most recent `sessionCount` sessions against the player's own
 * long-run numbers.
 *
 * The copy here is the product. It is written to be true *and* calming: a rough
 * stretch inside the band is named as ordinary, and a stretch outside the band
 * is still framed as something that happens to winning players, because it does.
 * No wording implies the player is broken, and none promises a rebound.
 */
export const assessRecentStretch = (
  observations: readonly SessionObservation[],
  estimate: PlayerEstimate,
  recentSessionCount = 10,
): StretchAssessment => {
  const recent = observations.slice(-recentSessionCount);
  const hours = recent.reduce((sum, o) => sum + o.hours, 0);
  const actualBb = recent.reduce((sum, o) => sum + o.resultBb, 0);

  const base: Omit<StretchAssessment, 'verdict' | 'headline' | 'body' | 'suggestsUntilt'> = {
    z: 0,
    percentile: 0.5,
    hours,
    actualBb,
    expectedBb: estimate.winRateBbPerHour * hours,
    lowerBb: 0,
    upperBb: 0,
    sessionCount: recent.length,
  };

  if (!estimate.reliable || estimate.stdDevBbPerHour <= 0 || hours <= 0) {
    return {
      ...base,
      verdict: 'insufficient_data',
      headline: 'Not enough hours yet',
      body: `Variance needs history to say anything honest. Log ${Math.max(
        0,
        MIN_SESSIONS_FOR_ESTIMATE - estimate.sessionCount,
      )} more session${
        MIN_SESSIONS_FOR_ESTIMATE - estimate.sessionCount === 1 ? '' : 's'
      } and around ${Math.max(
        0,
        Math.round(MIN_HOURS_FOR_ESTIMATE - estimate.totalHours),
      )} more hours, and this page will start comparing your recent stretch to your own numbers.`,
      suggestsUntilt: false,
    };
  }

  const spread = estimate.stdDevBbPerHour * Math.sqrt(hours);
  const expectedBb = estimate.winRateBbPerHour * hours;
  const z = (actualBb - expectedBb) / spread;
  const percentile = normalCdf(z);
  const lowerBb = expectedBb - Z_SCORES[95] * spread;
  const upperBb = expectedBb + Z_SCORES[95] * spread;
  const filled = { ...base, z, percentile, expectedBb, lowerBb, upperBb };

  const hoursLabel = `${formatHours(hours)} hours`;
  const swing = `Over ${hoursLabel}, a normal run for you is anywhere between ${formatBb(
    lowerBb,
  )} and ${formatBb(upperBb)}. You're at ${formatBb(actualBb)}.`;

  if (z <= -Z_SCORES[95]) {
    return {
      ...filled,
      verdict: 'running_bad',
      headline: 'A genuinely rough stretch',
      body: `${swing} That's outside your usual band, the coldest 2.5% of runs. Stretches like this happen to winning players; they're the tail of the same distribution, not a different game. Nothing in this number says your edge is gone. It does say this is a good week to protect your bankroll and your head.`,
      suggestsUntilt: true,
    };
  }

  if (z <= -1) {
    return {
      ...filled,
      verdict: 'below_expectation',
      headline: "You're running below expectation, and it's normal",
      body: `${swing} That's inside the range you'd expect from your own win rate and swings, which means this stretch is variance doing what variance does. Keep the sessions honest and it evens out over a much longer sample than this one.`,
      suggestsUntilt: true,
    };
  }

  if (z >= Z_SCORES[95]) {
    return {
      ...filled,
      verdict: 'running_hot',
      headline: "You're running well above expectation",
      body: `${swing} That's the hottest 2.5% of runs for a player with your numbers. Worth knowing so you don't bank on it continuing: your true win rate is almost certainly lower than this stretch suggests.`,
      suggestsUntilt: false,
    };
  }

  if (z >= 1) {
    return {
      ...filled,
      verdict: 'above_expectation',
      headline: 'Running a bit above expectation',
      body: `${swing} Comfortably inside your normal band, on the good side of it. Enjoy it, but read your win rate off the long sample rather than this one.`,
      suggestsUntilt: false,
    };
  }

  return {
    ...filled,
    verdict: 'normal',
    headline: 'Right where you should be',
    body: `${swing} This stretch sits in the middle of your normal range, about as ordinary as results get.`,
    suggestsUntilt: false,
  };
};

/**
 * Probability of being behind after `hours` at the player's estimated numbers.
 * The single most reassuring statistic in the app: a solid winner is still in
 * the red a meaningful share of the time over any stretch short of hundreds of
 * hours, and seeing that number defuses a lot of tilt.
 */
export const probabilityOfLoss = (estimate: PlayerEstimate, hours: number): number | null => {
  if (!estimate.reliable || estimate.stdDevBbPerHour <= 0 || hours <= 0) return null;
  const z = (0 - estimate.winRateBbPerHour * hours) / (estimate.stdDevBbPerHour * Math.sqrt(hours));
  return normalCdf(z);
};
