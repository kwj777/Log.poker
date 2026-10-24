/**
 * What the last session left behind, and whether it is worth saying anything
 * about before the next one starts.
 *
 * ## The moment
 *
 * `mood.ts` makes the argument this file acts on: the start score is the only
 * reading that cannot have been caused by the result, which makes the minutes
 * before a player sits down the one place in a session where the useful thing
 * to say is about a decision rather than a consolation. `PreSessionWarmUp`
 * already speaks there, but only when the player says they are rattled.
 *
 * That leaves the case this file is for. A player who took three bad beats on
 * Tuesday, lost a thousand, and came back on Wednesday may well pick a 3 on
 * the way in and then spend the night folding top pair. The carry-over is real
 * and the self-report misses it, because the thing a bad night does to the next
 * one is not reliably available to the person it is happening to. The record
 * is. So this reads the record.
 *
 * ## Both directions, which is the part that is easy to get wrong
 *
 * A heater carries over too. Nobody arrives at a table after their best night
 * in a year playing the way they did the week before, and the leak that comes
 * out of a win (calling too wide because the stack feels like the house's
 * money) costs the same as the one that comes out of a loss.
 *
 * **Neither direction says anything about what happens next.** A win does not
 * make a loss due and a loss does not make a win due, and no copy built on
 * this may imply otherwise; `variance.ts` has a test asserting exactly that of
 * its own verdicts. What this measures is a state of mind the player is
 * carrying in, which is a fact about them rather than a prediction about the
 * cards.
 *
 * ## Scaled to the player, not to a number somebody picked
 *
 * The threshold is `CARRY_OVER_SIGMAS` standard deviations of the player's own
 * swing over the hours they actually played, which is the same unit everything
 * else in this app measures in. A two-hundred-dollar loss is a quiet Tuesday
 * for one player and the worst night of the year for another, and a fixed
 * dollar figure would be loud for the second and silent for the first.
 *
 * `stretchSpread` rather than `σ√h`, with `sharedHours` equal to the session's
 * own hours because this session is inside the fit the rate came from: the
 * residual is measured against a mean that has already absorbed part of it,
 * and that file spends its header on what ignoring this costs.
 *
 * ## When there is nothing to scale by
 *
 * A new player, a tournament, or a session with no blinds recorded has no
 * sigma to measure against, and refusing to speak at all would mean the card
 * never appeared in the weeks when a player is least practiced at losing. So
 * the fallback is the plainest reading of the same two events that needs no
 * estimate: the session lost money, or it more than doubled what went into it.
 * It fires more readily than the measured rule, which is the right way round
 * for somebody with no history to put a night in context against.
 */

import { isComplete, netResult, totalInvested } from './stats';
import type { SessionWithChildren } from './types';
import { estimatePlayer, stretchSpread, toObservations } from './variance';

/**
 * How far from the player's own expectation a night has to land.
 *
 * 1.5 rather than 1. A one-sigma night happens to everybody about a third of
 * the time, and a card that appeared after one session in three would be
 * furniture inside a month -- the failure `MidSessionCheckIn` spends its header
 * guarding against, where an offer players learn to tap past stops being an
 * offer. At 1.5 it is roughly one session in eight, in both directions
 * together, which is often enough to be there on the night it matters and rare
 * enough to still read as noticing something.
 */
export const CARRY_OVER_SIGMAS = 1.5;

/**
 * How long a night goes on being the last night.
 *
 * Three days, so that Friday still counts when somebody comes back on Sunday,
 * and a session from a fortnight ago does not. What this is about is a frame
 * of mind carried from one sitting to the next, and two weeks is not that; it
 * is a statistic, and the Variance tab is where statistics are answered.
 */
export const CARRY_OVER_WINDOW_MS = 3 * 86_400_000;

export type CarryOverDirection = 'loss' | 'win';

export interface CarryOver {
  direction: CarryOverDirection;
  /** The session this came out of, so a caller can show it or test against it. */
  sessionId: string;
  /**
   * How many standard deviations of the player's own swing the night sat from
   * their own average, or null when it was read by the fallback instead.
   */
  z: number | null;
}

/**
 * The last completed session, if there is one inside the window.
 *
 * An active session is ignored rather than excluded: `isComplete` is false for
 * one, so a player who opens the new-session screen while a session is already
 * running is read against the last one they finished.
 */
const lastFinished = (
  sessions: readonly SessionWithChildren[],
  now: number,
): SessionWithChildren | null => {
  let latest: SessionWithChildren | null = null;
  for (const session of sessions) {
    if (!isComplete(session)) continue;
    const endedAt = session.endedAt;
    if (endedAt === null || now - endedAt > CARRY_OVER_WINDOW_MS) continue;
    if (latest === null || endedAt > (latest.endedAt ?? 0)) latest = session;
  }
  return latest;
};

/**
 * What the player is carrying in from their last night, or null for the
 * ordinary case, which is most nights.
 */
export const carryOver = (
  sessions: readonly SessionWithChildren[],
  now: number = Date.now(),
): CarryOver | null => {
  const last = lastFinished(sessions, now);
  if (last === null) return null;

  const net = netResult(last, last.rebuys);
  if (net === null) return null;

  const observations = toObservations(sessions);
  const estimate = estimatePlayer(observations);
  const observation = observations.find((o) => o.sessionId === last.id);

  if (estimate.reliable && estimate.stdDevBbPerHour > 0 && observation !== undefined) {
    const expected = estimate.winRateBbPerHour * observation.hours;
    // `sharedHours` is the whole session: every one of its hours is inside the
    // fit this rate came from.
    const spread = stretchSpread(
      estimate.stdDevBbPerHour,
      observation.hours,
      estimate.totalHours,
      observation.hours,
    );
    if (spread <= 0) return null;
    const z = (observation.resultBb - expected) / spread;
    if (z <= -CARRY_OVER_SIGMAS) return { direction: 'loss', sessionId: last.id, z };
    if (z >= CARRY_OVER_SIGMAS) return { direction: 'win', sessionId: last.id, z };
    return null;
  }

  // Nothing to scale by. The two events, read off the record alone.
  if (net < 0) return { direction: 'loss', sessionId: last.id, z: null };
  if (net > totalInvested(last, last.rebuys)) {
    return { direction: 'win', sessionId: last.id, z: null };
  }
  return null;
};
