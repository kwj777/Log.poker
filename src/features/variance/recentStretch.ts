/**
 * The recent-stretch verdict, shared by the two screens that show it.
 *
 * The verdict is the app's thesis in one sentence, and until now it existed
 * only on the Variance tab. Nobody opens a tracker to go and look at a chart;
 * they open it to log a session, and the moment they most want the answer is
 * right after a bad one. So the dashboard shows it too, and the parts that
 * would quietly drift between two copies live here instead:
 *
 *  - `RECENT_SESSIONS`, because two screens disagreeing about what "recent"
 *    means is two different verdicts under one heading.
 *  - `VERDICT_COLORS`, for the same reason the game-type labels were pulled
 *    into one map: four screens had written their own.
 *
 * `StretchVerdictCard` is the rendering. The Variance tab keeps computing
 * `observations` and `estimate` itself, because it needs both for the band and
 * the tiles; `recentStretchFrom` is for a caller that wants the verdict alone.
 */

import {
  assessRecentStretch,
  estimatePlayer,
  toObservations,
  type StretchAssessment,
  type StretchVerdict,
} from '../../domain/variance';
import type { SessionWithChildren } from '../../domain/types';
import { colors } from '../../theme';

/** How many of the player's most recent cash sessions the verdict reads. */
export const RECENT_SESSIONS = 10;

/**
 * Only the true outliers get a color. A stretch inside the normal band is
 * shown in plain text on purpose -- painting an ordinary bad week red is exactly
 * the reflex this verdict exists to interrupt.
 */
export const VERDICT_COLORS: Record<StretchVerdict, string> = {
  insufficient_data: colors.text,
  running_bad: colors.loss,
  below_expectation: colors.text,
  normal: colors.text,
  above_expectation: colors.text,
  running_hot: colors.profit,
};

/**
 * The verdict for a set of sessions, which must already be scoped to one
 * currency.
 *
 * Both callers scope first. A euro big blind and a dollar big blind are not
 * the same money, so a standard deviation over the mixture is a number about
 * nothing; see the Variance tab's own note on `currenciesUsed`.
 */
export const recentStretchFrom = (
  sessions: readonly SessionWithChildren[],
): StretchAssessment => {
  const observations = toObservations(sessions);
  return assessRecentStretch(observations, estimatePlayer(observations), RECENT_SESSIONS);
};
