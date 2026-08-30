/**
 * Session maths: profit/loss, hourly rate, and the aggregations the dashboard
 * groups by. Pure functions over plain records — no repository, no React — so
 * every number on screen is reproducible in a unit test.
 */

import { stakesKey, formatStakes } from './money';
import type { Cents, GameType, Rebuy, Session, SessionWithChildren, Venue } from './types';

export const MS_PER_HOUR = 3_600_000;

export const rebuyTotal = (rebuys: readonly Rebuy[]): Cents =>
  rebuys.reduce((sum, rebuy) => sum + rebuy.amount, 0);

/** Everything the player put on the table: initial buy-in plus every rebuy. */
export const totalInvested = (session: Session, rebuys: readonly Rebuy[]): Cents =>
  session.buyIn + rebuyTotal(rebuys);

/**
 * Net result. Null while the session is live — a running session has no P/L yet,
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
 * time — dividing a result by a zero-length session produces Infinity, which
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

export const summarise = (
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
    const summary = summarise(session);
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

export interface BankrollPoint {
  at: number;
  /** Running total of net result, in cents, after this session. */
  cumulative: Cents;
  net: Cents;
  sessionId: string;
}

/**
 * Cumulative P/L over time, oldest first — the bankroll graph's data.
 * Ordered by session end so the curve reflects when results were realised.
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

export const byStakes = (sessions: readonly SessionWithChildren[]): GroupTotals[] =>
  groupBy(sessions, (session) => ({
    key: stakesKey(session.stakes),
    label: formatStakes(session.stakes),
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
