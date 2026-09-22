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

/**
 * How far a stretch can stray from a win rate **that was fitted to it**.
 *
 * This is the correction the whole page turned on and did not have. Every
 * number here is measured against `w = totalBb / totalHours`, and `w` is
 * estimated from the same sessions being measured. A residual taken against a
 * mean fitted to it is not free to be large: the fit has already absorbed part
 * of it, and dividing by `σ√h` -- the spread of a residual against a mean that
 * knew nothing about it -- understates every deviation by exactly that much.
 *
 * At the limit the understatement is total. If the stretch *is* the whole
 * sample then `actual == w·h` identically, the residual is zero whatever
 * happened, and `σ√h` cheerfully reports it as a player running dead on
 * expectation. That is not a rounding error; it is the verdict being
 * arithmetically pinned to "normal" for anybody whose recent stretch is most of
 * their history, which is everybody who has just qualified for this page.
 *
 * Writing `S` for the stretch's result, `ŵ = T/F` for the fitted rate over the
 * fit's `F` hours, and `k` for how many of the stretch's `h` hours are inside
 * that fit:
 *
 *     S − ŵh = S_in·(1 − h/F) + S_out − (h/F)·(the fit's other hours)
 *     Var     = σ²·[ k·(1 − h/F)² + (h − k) + (h/F)²·(F − k) ]
 *
 * which collapses to the two readings worth naming:
 *
 *     k = h (fitted to the stretch)      σ²·h·(1 − h/F)   → 0 as h → F
 *     k = 0 (fitted to other sessions)   σ²·(h + h²/F)    → σ²h as F → ∞
 *
 * The second is the honest out-of-sample answer and is slightly *wider* than
 * `σ√h`, because `ŵ` is itself estimated and carries its own error. Both were
 * `σ√h` before.
 */
export const stretchSpread = (
  sd: number,
  hours: number,
  fittedHours: number,
  sharedHours: number,
): number => {
  if (sd <= 0 || hours <= 0) return 0;
  if (fittedHours <= 0) return sd * Math.sqrt(hours);
  const share = hours / fittedHours;
  const shared = Math.min(Math.max(sharedHours, 0), hours);
  const variance =
    shared * (1 - share) ** 2 + (hours - shared) + share ** 2 * Math.max(0, fittedHours - shared);
  return sd * Math.sqrt(Math.max(0, variance));
};

/**
 * How many of a stretch's hours the estimate was fitted to.
 *
 * The two callers sit at opposite ends -- the screen fits to everything and so
 * shares the whole stretch, a test fits to a baseline and shares none of it --
 * and neither passes the fit itself, only its summary. `fittedHours` minus the
 * hours outside the stretch is what is left over for the stretch, floored at
 * nothing and capped at the stretch: exact at both ends, monotone between them.
 */
const sharedWith = (
  estimate: PlayerEstimate,
  observations: readonly SessionObservation[],
  stretchHours: number,
): number => {
  const total = observations.reduce((sum, o) => sum + o.hours, 0);
  return Math.min(stretchHours, Math.max(0, estimate.totalHours - (total - stretchHours)));
};

export interface BandPoint {
  hours: number;
  expected: number;
  upper: number;
  lower: number;
  /** The player's own cumulative result at this point, when one exists. */
  actual: number | null;
}

/**
 * The confidence-band series: expected result and the envelope around it over
 * cumulative hours, with the player's real curve overlaid on the same axis.
 *
 * **The envelope narrows toward the right-hand edge, and that is the fix
 * rather than a defect in it.** The dashed line is `w·hours` and `w` is the
 * player's own average over exactly these sessions, so at the final point
 * `w·totalHours` is `totalBb` -- the curve landed on the line by construction,
 * on every chart this has ever drawn. Against a `±z·σ·√h` envelope, which is
 * the spread of a run measured against a rate that did not come from it, the
 * curve could not leave the band at the end however the player had run.
 *
 * So the envelope is the one belonging to the quantity actually plotted: the
 * deviation from a mean fitted to the same hours, which really does have less
 * and less room as the hours it was fitted to are used up. See `stretchSpread`.
 * Over the bulk of the curve the change is small -- at the halfway point the
 * band is 29% narrower -- and it closes over the last session or two, which is
 * where the old picture was making a promise it had already spent.
 *
 * An estimate fitted to a longer history than these observations (`fittedHours`
 * well past their total) gets almost no correction, which is right: it never
 * had this problem.
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
    // Every hour up to here is one the fit saw, capped at the fit's own length
    // so an out-of-sample estimate is not credited with hours it never had.
    const shared = Math.min(cumulativeHours, estimate.totalHours);
    const spread = z * stretchSpread(sd, cumulativeHours, estimate.totalHours, shared);
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

/**
 * What the player is actually short of, and only that.
 *
 * `reliable` wants both floors cleared, and a player can clear one without the
 * other, so the two shortfalls were printed unconditionally and one of them was
 * routinely zero: somebody nine sessions in at eighteen hours read "Log 0 more
 * sessions and around 2 more hours", and at nineteen hours, "around 1 more
 * hours". This is the whole body of the empty state that fills the Variance
 * tab, so it is the first thing that page ever says to anybody.
 *
 * Only the halves with a number left in them, and both counted the same way.
 */
const shortfall = (estimate: PlayerEstimate): string => {
  const sessions = Math.max(0, MIN_SESSIONS_FOR_ESTIMATE - estimate.sessionCount);
  const hours = Math.max(0, Math.round(MIN_HOURS_FOR_ESTIMATE - estimate.totalHours));
  const parts: string[] = [];
  if (sessions > 0) parts.push(`${sessions} more session${sessions === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`around ${hours} more hour${hours === 1 ? '' : 's'}`);
  // Both floors cleared and still here: `stdDevBbPerHour` is zero, which takes
  // sessions that every one of them landed exactly on the player's average.
  // Rare, and "log 0 more of anything" is not the answer to it.
  if (parts.length === 0) return 'a few more sessions';
  return parts.join(' and ');
};

/**
 * Why this page has nothing to say, when the log is not empty but this model
 * cannot read a single session in it.
 *
 * `toObservations` drops every tournament -- their results are a long tail
 * carried by a handful of scores, and a Gaussian band over them would look
 * authoritative and be wrong -- and drops any cash session whose blinds were
 * never recorded, because a result in big blinds needs a big blind.
 *
 * So a player who only plays tournaments sits at `sessionCount: 0` and
 * `totalHours: 0` forever, and the ordinary empty state told them to log
 * "8 more sessions and around 20 more hours" -- a thing many of them had
 * already done twice over, and a thing no amount of playing would ever change.
 * The one instruction on the page was for a game they do not play.
 *
 * Returns null wherever the shortfall is the honest answer: an empty log, or
 * one this model has read some of.
 */
export const nothingReadable = (
  sessions: readonly SessionWithChildren[],
  observations: readonly SessionObservation[],
): { headline: string; body: string } | null => {
  if (observations.length > 0) return null;
  const complete = sessions.filter(isComplete);
  if (complete.length === 0) return null;

  const tournaments = complete.filter((session) => session.format === 'tournament').length;
  return {
    headline: 'Nothing to measure in big blinds yet',
    body:
      tournaments === complete.length
        ? 'Every session you have logged is a tournament, and a tournament has no blinds to measure in. Their results are too lopsided for a band like this one to say anything honest about anyway. What is worth saying about them is below, as cashes and ROI.'
        : 'This page works in big blinds, and none of the sessions logged so far carries them: a tournament has none to carry, and a cash game logged without its stakes has none recorded.',
  };
};

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
      body: `Variance needs history to say anything honest. Log ${shortfall(
        estimate,
      )}, and this page will start comparing your recent stretch to your own numbers.`,
      suggestsUntilt: false,
    };
  }

  // Against a rate fitted to these very sessions, which `σ√h` silently assumed
  // it was not. See `stretchSpread` for the arithmetic and for what it cost.
  const spread = stretchSpread(
    estimate.stdDevBbPerHour,
    hours,
    estimate.totalHours,
    sharedWith(estimate, observations, hours),
  );

  // Nothing left to measure against: this stretch is the whole of what the rate
  // was fitted to, so the residual is zero by arithmetic rather than by the
  // player having run at expectation. Said plainly, because the alternative --
  // what this did before -- is "Right where you should be" to somebody eight
  // sessions into the worst run of their life.
  if (spread <= 0) {
    return {
      ...base,
      verdict: 'insufficient_data',
      headline: 'Not enough history outside this stretch',
      body: `These ${recent.length} sessions are your whole cash history, so there is nothing to compare them against but themselves -- and measured against their own average every stretch looks perfectly ordinary, which is worth exactly nothing to you. Log a few more and this page starts weighing your recent run against the sessions that came before it.`,
      suggestsUntilt: false,
    };
  }

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
 * A probability in words, carrying its own qualifier.
 *
 * Rounding one to a whole percent turns anything under half a percent into
 * "0%" and anything over 99.5 into "100%", and both are the sentence denying
 * the thing it describes. `tournaments.ts` learned this first: a player
 * nineteen entries into a drought read "missing 19 in a row comes up about 0%
 * of the time", on the one card whose job is to settle somebody down. The
 * fix lived there, privately, and the cash side -- where the same card says
 * how often a winning player finishes a stretch in the red -- hand-rolled
 * `Math.round(p * 100)` and printed the same lie to about one player in fifty.
 *
 * Near either bound the exact figure is not the point, so this says which side
 * of the line the number is on instead, and takes the qualifier with it:
 * "about" belongs to a rounded number and not to a bound.
 */
export const oddsInWords = (fraction: number): string => {
  if (fraction > 0 && fraction < 0.005) return 'less than 1%';
  if (fraction < 1 && fraction > 0.995) return 'more than 99%';
  return `about ${Math.round(fraction * 100)}%`;
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
