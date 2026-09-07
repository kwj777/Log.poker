/**
 * What tilt costs, in the player's own results.
 *
 * `MoodPicker` has collected a 1-to-5 score at the start, middle and end of
 * every session since the app shipped, and its own header says the correlation
 * between mood and results is the reason it exists. Nothing computed it. This
 * does.
 *
 * The question is *does arriving rattled cost me money*, and the answer is worth
 * having because it is the one piece of advice a tracker can give that is not
 * about cards: some nights the right move is not to sit down.
 *
 * ## The mood a session is grouped by is the one it started with
 *
 * This is the whole design and it is not obvious. The instinct is to group by
 * the worst score in the session, or by the one at the end, because that is
 * where tilt actually shows. **Both are downstream of the result.** A player
 * who loses four buy-ins reports feeling terrible at the end of it, so a split
 * on end mood mostly measures *losing makes people feel bad*, which is true,
 * circular and useless. The number would look dramatic and mean nothing.
 *
 * The `start` score is recorded before a single hand is dealt, so the result
 * cannot have caused it. That makes the comparison a real one and, better, an
 * actionable one: it is about a decision the player still has in front of them.
 *
 * The `mid` score is halfway contaminated -- two hours in, the session so far is
 * pushing on it -- so it is not used either.
 *
 * ## Everything is in big blinds
 *
 * Same reason as `variance.ts`: sessions across different stakes have to pool
 * into one estimate, and a dollar at 1/2 is not a dollar at 5/10. Converting to
 * money for display is the surface's job, and it should say which stake it is
 * quoting.
 *
 * ## It refuses to speak far more often than it speaks
 *
 * This is the part to be careful about, because the failure mode is severe.
 * Poker results have enormous variance. A player's per-hour standard deviation
 * is typically several times their win rate, so the difference between two
 * groups of a handful of sessions is *dominated* by noise, and a difference of
 * means computed over ten sessions will look like a finding almost every time.
 *
 * **An app whose flagship feature exists to talk players out of reading noise as
 * signal cannot ship a feature that manufactures one.** So the gap is measured
 * against its own standard error, using the player's own sigma, and it is
 * reported only when it clears that bar. When it does not, this says so and
 * says how much more play would settle it, which is a better answer than a
 * number nobody should act on.
 */

import { MOOD_SCALE, type MoodEntry, type MoodScore, type SessionWithChildren } from './types';
import {
  Z_SCORES,
  estimatePlayer,
  normalCdf,
  toObservations,
  type ConfidenceLevel,
  type SessionObservation,
} from './variance';

/**
 * The two ends of the scale, and the gap left in the middle.
 *
 * `3` is *Edgy*, which is the honest answer for most sessions and belongs to
 * neither side. Folding it into one group or the other would blur exactly the
 * contrast that makes the finding worth acting on, and folding it into both
 * would count those sessions twice.
 */
export const STEADY_SCORES: readonly MoodScore[] = [1, 2];
export const RATTLED_SCORES: readonly MoodScore[] = [4, 5];

/**
 * Below these, a group is not a group.
 *
 * Lower than `variance.ts`'s thresholds for the whole history, because this is
 * per side and a player who never sits down rattled would otherwise never get
 * an answer. They are a floor on *having data*, not a substitute for the
 * significance test below, which is what actually decides whether anything is
 * said.
 */
export const MIN_SESSIONS_PER_GROUP = 5;
export const MIN_HOURS_PER_GROUP = 12;

export interface MoodObservation extends SessionObservation {
  startScore: MoodScore;
}

/**
 * The score logged before the session started, or null.
 *
 * The earliest `start` entry rather than the latest, because a second one is a
 * correction typed seconds later in the same screen and the first is the one
 * that matches when it was asked. Sessions with no start entry are not guessed
 * at; they drop out.
 */
export const startScoreOf = (
  sessionId: string,
  moodEntries: readonly MoodEntry[],
): MoodScore | null => {
  let earliest: MoodEntry | null = null;
  for (const entry of moodEntries) {
    if (entry.sessionId !== sessionId || entry.phase !== 'start') continue;
    if (earliest === null || entry.at < earliest.at) earliest = entry;
  }
  return earliest === null ? null : earliest.score;
};

/**
 * Sessions reduced to (result in bb, hours, start mood), oldest first.
 *
 * `toObservations` does the hard filtering and its exclusions carry over
 * unchanged: tournaments, sessions with no recorded blinds, sessions with no
 * measurable duration. What this adds is the join to the mood entry and the
 * removal of anything that has none.
 */
export const toMoodObservations = (
  sessions: readonly SessionWithChildren[],
  moodEntries: readonly MoodEntry[],
): MoodObservation[] =>
  toObservations(sessions)
    .map((observation) => {
      const startScore = startScoreOf(observation.sessionId, moodEntries);
      return startScore === null ? null : { ...observation, startScore };
    })
    .filter((observation): observation is MoodObservation => observation !== null);

export interface MoodGroup {
  sessions: number;
  hours: number;
  bb: number;
  /** Null when the group has no hours in it, rather than a divide by zero. */
  bbPerHour: number | null;
}

const groupOf = (
  observations: readonly MoodObservation[],
  scores: readonly MoodScore[],
): MoodGroup => {
  const mine = observations.filter((o) => scores.includes(o.startScore));
  const hours = mine.reduce((sum, o) => sum + o.hours, 0);
  const bb = mine.reduce((sum, o) => sum + o.resultBb, 0);
  return {
    sessions: mine.length,
    hours,
    bb,
    bbPerHour: hours > 0 ? bb / hours : null,
  };
};

/** Why there is nothing to report, when there is nothing to report. */
export type MoodBlocker =
  /** Fewer than the floor, on the calm side. */
  | 'thin-steady'
  /** Fewer than the floor, on the rattled side. */
  | 'thin-rattled'
  /** Both groups are there and the gap between them is inside the noise. */
  | 'inside-the-noise'
  /** No usable sessions at all, so not even the groups exist. */
  | 'no-data';

export interface MoodComparison {
  steady: MoodGroup;
  rattled: MoodGroup;
  /**
   * Rattled minus steady, in big blinds per hour. Negative is the expected
   * direction and the one worth telling somebody about. Null when either side
   * has no hours.
   */
  differenceBbPerHour: number | null;
  /**
   * The standard error of that difference, `sigma * sqrt(1/h1 + 1/h2)`, under
   * the same random-walk model `variance.ts` uses. Null alongside the
   * difference.
   */
  standardError: number | null;
  /** The difference in standard errors. Null alongside it. */
  z: number | null;
  /**
   * How often a gap at least this large would turn up if the two groups really
   * played the same. Two-sided. Null alongside the rest.
   */
  pValue: number | null;
  /** True only when both groups clear the floor and the gap clears the noise. */
  settled: boolean;
  blocker: MoodBlocker | null;
  /**
   * Roughly how many more hours in the thinner group would settle it, keeping
   * the observed gap. Null when the gap is already settled, and null when no
   * amount would do it, which happens when the *other* group is the binding
   * constraint. Saying "another 40 hours" when 40 hours cannot help would be
   * worse than saying nothing.
   */
  hoursNeeded: number | null;
}

const emptyGroup: MoodGroup = { sessions: 0, hours: 0, bb: 0, bbPerHour: null };

const unsettled = (
  steady: MoodGroup,
  rattled: MoodGroup,
  blocker: MoodBlocker,
): MoodComparison => ({
  steady,
  rattled,
  differenceBbPerHour: null,
  standardError: null,
  z: null,
  pValue: null,
  settled: false,
  blocker,
  hoursNeeded: null,
});

/**
 * Hours the thinner group still needs for the observed gap to clear the bar.
 *
 * Solving `z * sigma * sqrt(1/hFixed + 1/hWanted) <= |difference|` for
 * `hWanted`. The denominator goes non-positive when the fixed group alone
 * already contributes more error than the gap can absorb, which is the case
 * where no amount of the other kind of session helps and the honest answer is
 * null.
 */
const hoursToSettle = (
  difference: number,
  sigma: number,
  hFixed: number,
  z: number,
): number | null => {
  if (difference === 0 || sigma <= 0 || hFixed <= 0) return null;
  const budget = (Math.abs(difference) / z / sigma) ** 2;
  const denominator = budget - 1 / hFixed;
  if (denominator <= 0) return null;
  return 1 / denominator;
};

/**
 * The comparison, and whether it is worth showing.
 *
 * `sigma` comes from the player's whole history rather than from either group,
 * because it is a property of the game they play rather than of their mood, and
 * estimating it separately per group on five sessions would be a worse estimate
 * of the same thing twice.
 */
export const compareStartMood = (
  observations: readonly MoodObservation[],
  level: ConfidenceLevel = 90,
): MoodComparison => {
  if (observations.length === 0) {
    return unsettled(emptyGroup, emptyGroup, 'no-data');
  }

  const steady = groupOf(observations, STEADY_SCORES);
  const rattled = groupOf(observations, RATTLED_SCORES);

  const thin = (group: MoodGroup): boolean =>
    group.sessions < MIN_SESSIONS_PER_GROUP || group.hours < MIN_HOURS_PER_GROUP;

  if (thin(steady)) return unsettled(steady, rattled, 'thin-steady');
  if (thin(rattled)) return unsettled(steady, rattled, 'thin-rattled');
  if (steady.bbPerHour === null || rattled.bbPerHour === null) {
    return unsettled(steady, rattled, 'no-data');
  }

  const sigma = estimatePlayer(observations).stdDevBbPerHour;
  const difference = rattled.bbPerHour - steady.bbPerHour;
  const standardError = sigma * Math.sqrt(1 / steady.hours + 1 / rattled.hours);

  // A sigma of zero means every session returned exactly its expected result,
  // which real play never does and a fixture can. Treating it as certainty
  // would make any gap at all look infinitely significant.
  if (standardError <= 0) {
    return { ...unsettled(steady, rattled, 'inside-the-noise'), differenceBbPerHour: difference };
  }

  const z = difference / standardError;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const settled = Math.abs(z) >= Z_SCORES[level];

  const thinner = steady.hours <= rattled.hours ? steady : rattled;
  const other = thinner === steady ? rattled : steady;

  return {
    steady,
    rattled,
    differenceBbPerHour: difference,
    standardError,
    z,
    pValue,
    settled,
    blocker: settled ? null : 'inside-the-noise',
    hoursNeeded: settled
      ? null
      : hoursToSettle(difference, sigma, other.hours, Z_SCORES[level]),
  };
};

/**
 * The comparison straight from the records a screen already holds.
 *
 * The one entry point worth calling from a component. Everything above it is
 * separately testable and separately wrong-able.
 */
export const startMoodComparison = (
  sessions: readonly SessionWithChildren[],
  moodEntries: readonly MoodEntry[],
  level: ConfidenceLevel = 90,
): MoodComparison => compareStartMood(toMoodObservations(sessions, moodEntries), level);

/**
 * How the sessions with a start mood are spread across the scale.
 *
 * Not part of the comparison and useful beside it: a player looking at a
 * refusal deserves to see what it is short of, and *you have logged two of
 * these* explains a blocker better than any sentence.
 */
export const startMoodSpread = (
  observations: readonly MoodObservation[],
): Record<MoodScore, number> => {
  const spread = Object.fromEntries(MOOD_SCALE.map((score) => [score, 0])) as Record<
    MoodScore,
    number
  >;
  for (const observation of observations) spread[observation.startScore] += 1;
  return spread;
};

/**
 * Whether the comparison has earned a nudge toward a reset.
 *
 * A function rather than a boolean expression inside a component, because it
 * is the one place a conflict of interest could hide and a component is the one
 * place this repository cannot execute a test against. There is a standing pull
 * toward finding tilt expensive: the nudge sits under a card that this app has
 * a reason to want shown.
 *
 * So the condition is written once, here, and asserted here. Three things have
 * to hold, and the third is the one worth naming: **the gap has to point the
 * wrong way**. A comparison that settles in the other direction, where a
 * player's rattled sessions are their better ones, is a real finding and it is
 * not a reason to sell them anything.
 */
export const worthActingOn = (comparison: MoodComparison): boolean =>
  comparison.settled &&
  comparison.differenceBbPerHour !== null &&
  comparison.differenceBbPerHour < 0;

/**
 * Whether a score logged mid-session is worth offering a reset for.
 *
 * The same two scores the comparison calls rattled, and reusing `RATTLED_SCORES`
 * rather than restating `[4, 5]` is the point: a player who would land in that
 * group at the end of the month is the player worth offering something to
 * tonight, and two different definitions of rattled in one app is one too many.
 *
 * **Not gated on anything a purchase decides**, unlike `worthActingOn`, and for
 * a reason that is in the family's creed rather than in this file: the resets
 * you reach for mid-session are free. What this offers costs nothing and needs
 * no account, so there is nothing here to be careful about selling. The care
 * needed is the other kind, and it lives at the call site: the tap has to be
 * recorded before this is ever consulted, or the check-in starts costing the
 * player something and they stop answering it honestly.
 */
export const wantsReset = (score: MoodScore): boolean => RATTLED_SCORES.includes(score);
