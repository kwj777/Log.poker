/**
 * Session math: profit/loss, hourly rate, and the aggregations the dashboard
 * groups by. Pure functions over plain records -- no repository, no React -- so
 * every number on screen is reproducible in a unit test.
 */

import { formatEntry, formatStakes, stakesKey } from './money';
import {
  SESSION_FORMAT_LABELS,
  type Cents,
  type GameType,
  type Rebuy,
  type Session,
  type SessionWithChildren,
  type Stakes,
  type Venue,
} from './types';

export const MS_PER_HOUR = 3_600_000;

export const rebuyTotal = (rebuys: readonly Rebuy[]): Cents =>
  rebuys.reduce((sum, rebuy) => sum + rebuy.amount, 0);

/**
 * Everything the session cost: buy-in, the tournament entry fee where there is
 * one, and every rebuy. The fee counts because it is money that left the
 * bankroll -- leaving it out would flatter every tournament ROI by the rake.
 */
export const totalInvested = (session: Session, rebuys: readonly Rebuy[]): Cents =>
  session.buyIn + (session.fee ?? 0) + rebuyTotal(rebuys);

/**
 * Net result. Null while the session is live -- a running session has no P/L yet,
 * and returning 0 would quietly drag every average toward zero.
 */
export const netResult = (session: Session, rebuys: readonly Rebuy[]): Cents | null => {
  if (session.cashOut === null) return null;
  return session.cashOut - totalInvested(session, rebuys);
};

/** Elapsed milliseconds; for a live session, elapsed *so far* against `now`. */
export const durationMs = (session: Session, now: number = Date.now()): number => {
  const end = session.endedAt ?? now;
  return Math.max(0, end - session.startedAt);
};

export const durationHours = (session: Session, now?: number): number =>
  durationMs(session, now) / MS_PER_HOUR;

/** `3h 42m`, or `47m` for anything under an hour. */
export const formatDuration = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

/**
 * Cents per hour. Null when the session is unfinished or lasted no measurable
 * time -- dividing a result by a zero-length session produces Infinity, which
 * would poison every downstream average.
 */
export const hourlyRate = (session: Session, rebuys: readonly Rebuy[]): Cents | null => {
  const net = netResult(session, rebuys);
  if (net === null) return null;
  const hours = durationHours(session);
  if (hours <= 0) return null;
  return Math.round(net / hours);
};

export const isComplete = (session: Session): boolean =>
  session.cashOut !== null && session.endedAt !== null;

export interface SessionSummary {
  session: SessionWithChildren;
  invested: Cents;
  net: Cents | null;
  hours: number;
  hourly: Cents | null;
}

export const summarize = (
  session: SessionWithChildren,
  now?: number,
): SessionSummary => {
  const invested = totalInvested(session, session.rebuys);
  const net = netResult(session, session.rebuys);
  const hours = durationHours(session, now);
  return {
    session,
    invested,
    net,
    hours,
    hourly: net !== null && hours > 0 ? Math.round(net / hours) : null,
  };
};

export interface Totals {
  sessionCount: number;
  hours: number;
  net: Cents;
  invested: Cents;
  /** Cents per hour across all completed sessions, or null with no hours logged. */
  hourly: Cents | null;
  winningSessions: number;
  losingSessions: number;
  breakEvenSessions: number;
  biggestWin: Cents | null;
  biggestLoss: Cents | null;
}

const EMPTY_TOTALS: Totals = {
  sessionCount: 0,
  hours: 0,
  net: 0,
  invested: 0,
  hourly: null,
  winningSessions: 0,
  losingSessions: 0,
  breakEvenSessions: 0,
  biggestWin: null,
  biggestLoss: null,
};

/**
 * Roll up completed sessions. Live sessions are ignored: their result is not yet
 * known, so including them would understate both P/L and hourly rate.
 */
export const totals = (sessions: readonly SessionWithChildren[]): Totals => {
  const completed = sessions.filter(isComplete);
  if (completed.length === 0) return { ...EMPTY_TOTALS };

  let hours = 0;
  let net = 0;
  let invested = 0;
  let winningSessions = 0;
  let losingSessions = 0;
  let breakEvenSessions = 0;
  let biggestWin: Cents | null = null;
  let biggestLoss: Cents | null = null;

  for (const session of completed) {
    const summary = summarize(session);
    const result = summary.net ?? 0;
    hours += summary.hours;
    net += result;
    invested += summary.invested;
    if (result > 0) winningSessions += 1;
    else if (result < 0) losingSessions += 1;
    else breakEvenSessions += 1;
    if (biggestWin === null || result > biggestWin) biggestWin = result;
    if (biggestLoss === null || result < biggestLoss) biggestLoss = result;
  }

  return {
    sessionCount: completed.length,
    hours,
    net,
    invested,
    hourly: hours > 0 ? Math.round(net / hours) : null,
    winningSessions,
    losingSessions,
    breakEvenSessions,
    biggestWin,
    biggestLoss,
  };
};

export interface WinRate {
  /** Completed cash sessions considered. */
  sessions: number;
  winning: number;
  losing: number;
  breakEven: number;
  /** Winning over completed, as a fraction. Null with no completed cash sessions. */
  rate: number | null;
}

/**
 * The share of sessions that finished ahead, over cash games only.
 *
 * Deliberately not both formats pooled. A tournament entry ends with nothing
 * most nights for everybody who plays them, so a player who mixes the two, or
 * plays only tournaments, gets a number dragged toward their tournament volume
 * rather than their results, under a label that reads like a verdict on how
 * they play. A tournament player cashing 22% is doing well; a cash player
 * winning 22% of sessions is not, and one figure cannot mean both.
 *
 * Tournaments have their own rate, in `tournaments.ts`, and it is called what
 * it actually is: cashed.
 */
export const cashWinRate = (sessions: readonly SessionWithChildren[]): WinRate => {
  const cash = sessions.filter((session) => session.format === 'cash' && isComplete(session));
  const summary = totals(cash);
  return {
    sessions: summary.sessionCount,
    winning: summary.winningSessions,
    losing: summary.losingSessions,
    breakEven: summary.breakEvenSessions,
    rate: summary.sessionCount > 0 ? summary.winningSessions / summary.sessionCount : null,
  };
};

export interface BankrollPoint {
  at: number;
  /** Running total of net result, in cents, after this session. */
  cumulative: Cents;
  net: Cents;
  sessionId: string;
}

/**
 * Cumulative P/L over time, oldest first -- the bankroll graph's data.
 * Ordered by session end so the curve reflects when results were realized.
 */
export const bankrollCurve = (sessions: readonly SessionWithChildren[]): BankrollPoint[] => {
  const completed = sessions
    .filter(isComplete)
    .slice()
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));

  let cumulative = 0;
  return completed.map((session) => {
    const net = netResult(session, session.rebuys) ?? 0;
    cumulative += net;
    return { at: session.endedAt ?? session.startedAt, cumulative, net, sessionId: session.id };
  });
};

export interface GroupTotals extends Totals {
  key: string;
  label: string;
}

const groupBy = (
  sessions: readonly SessionWithChildren[],
  keyOf: (session: SessionWithChildren) => { key: string; label: string },
): GroupTotals[] => {
  const buckets = new Map<string, { label: string; sessions: SessionWithChildren[] }>();
  for (const session of sessions.filter(isComplete)) {
    const { key, label } = keyOf(session);
    const bucket = buckets.get(key);
    if (bucket) bucket.sessions.push(session);
    else buckets.set(key, { label, sessions: [session] });
  }
  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({ key, label: bucket.label, ...totals(bucket.sessions) }))
    .sort((a, b) => b.net - a.net);
};

/**
 * Cash sessions by stakes. Tournaments are absent rather than bucketed together:
 * they have no blinds, and a "no stakes" bar sitting next to $1/$2 and $2/$5
 * would read as a stake level rather than as the wrong question. `byBuyIn` is
 * the tournament equivalent.
 */
export const byStakes = (sessions: readonly SessionWithChildren[]): GroupTotals[] =>
  groupBy(
    sessions.filter((session) => session.format === 'cash' && session.stakes !== null),
    (session) => ({
      key: stakesKey(session.stakes as Stakes, session.currency),
      label: formatStakes(session.stakes as Stakes, session.currency),
    }),
  );

/** Tournaments by what one entry cost -- the level a tournament player thinks in. */
export const byBuyIn = (sessions: readonly SessionWithChildren[]): GroupTotals[] =>
  groupBy(
    sessions.filter((session) => session.format === 'tournament'),
    (session) => ({
      // Keyed on the two halves rather than their sum, so `$100+$10` and
      // `$110` stay apart: they cost the same and are not the same tournament.
      key: `${session.currency}:${session.buyIn}+${session.fee ?? 0}`,
      label: formatEntry(session.buyIn, session.fee, session.currency),
    }),
  );

export const byFormat = (sessions: readonly SessionWithChildren[]): GroupTotals[] =>
  groupBy(sessions, (session) => ({
    key: session.format,
    label: SESSION_FORMAT_LABELS[session.format],
  }));

export const byGameType = (sessions: readonly SessionWithChildren[]): GroupTotals[] =>
  groupBy(sessions, (session) => ({
    key: session.gameType,
    label: session.gameType satisfies GameType,
  }));

export const byVenue = (
  sessions: readonly SessionWithChildren[],
  venues: readonly Venue[],
): GroupTotals[] => {
  const names = new Map(venues.map((venue) => [venue.id, venue.name]));
  return groupBy(sessions, (session) => ({
    key: session.venueId,
    label: session.venue?.name ?? names.get(session.venueId) ?? 'Unknown venue',
  }));
};
