import {
  bankrollCurve,
  byGameType,
  byStakes,
  byVenue,
  durationHours,
  durationMs,
  formatDuration,
  hourlyRate,
  isComplete,
  netResult,
  rebuyTotal,
  summarize,
  totalInvested,
  totals,
} from '../stats';
import { HOUR, STAKES_1_2, STAKES_2_5, T0, completed, session, venue } from './support';

describe('profit and loss', () => {
  it('nets cash-out against the buy-in', () => {
    const s = completed({ buyIn: 30_000, cashOut: 52_500, hours: 4 });
    expect(netResult(s, s.rebuys)).toBe(22_500);
  });

  it('counts every rebuy against the result', () => {
    const s = completed({ buyIn: 30_000, cashOut: 52_500, hours: 4, rebuys: [20_000, 10_000] });
    expect(rebuyTotal(s.rebuys)).toBe(30_000);
    expect(totalInvested(s, s.rebuys)).toBe(60_000);
    expect(netResult(s, s.rebuys)).toBe(-7_500);
  });

  it('reports a loss when the player busts', () => {
    const s = completed({ buyIn: 30_000, cashOut: 0, hours: 2 });
    expect(netResult(s, s.rebuys)).toBe(-30_000);
  });

  it('reports exactly break-even, not a rounding artefact', () => {
    const s = completed({ buyIn: 30_000, cashOut: 30_000, hours: 3 });
    expect(netResult(s, s.rebuys)).toBe(0);
  });

  it('has no result while the session is still running', () => {
    const s = session({ cashOut: null });
    expect(netResult(s, s.rebuys)).toBeNull();
    expect(isComplete(s)).toBe(false);
  });

  it('treats a session with a cash-out and an end time as complete', () => {
    expect(isComplete(completed({ hours: 1, cashOut: 100 }))).toBe(true);
  });
});

describe('duration', () => {
  it('measures a finished session between its own timestamps', () => {
    const s = completed({ startedAt: T0, hours: 3.5, cashOut: 0 });
    expect(durationMs(s)).toBe(3.5 * HOUR);
    expect(durationHours(s)).toBe(3.5);
  });

  it('measures a live session against now', () => {
    const s = session({ startedAt: T0 });
    expect(durationHours(s, T0 + 2 * HOUR)).toBe(2);
  });

  it('never reports negative time from a clock that moved backwards', () => {
    const s = session({ startedAt: T0 });
    expect(durationMs(s, T0 - HOUR)).toBe(0);
  });

  it('formats hours and minutes the way a player reads them', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(47 * 60_000)).toBe('47m');
    expect(formatDuration(3 * HOUR + 42 * 60_000)).toBe('3h 42m');
    expect(formatDuration(HOUR)).toBe('1h 0m');
  });
});

describe('hourly rate', () => {
  it('divides the net result by hours played', () => {
    const s = completed({ buyIn: 30_000, cashOut: 52_500, hours: 4.5 });
    expect(hourlyRate(s, s.rebuys)).toBe(5_000);
  });

  it('is negative for a losing session', () => {
    const s = completed({ buyIn: 30_000, cashOut: 10_000, hours: 5 });
    expect(hourlyRate(s, s.rebuys)).toBe(-4_000);
  });

  it('is unknown for a running session', () => {
    expect(hourlyRate(session(), [])).toBeNull();
  });

  it('refuses to divide by a zero-length session', () => {
    const s = completed({ hours: 0, cashOut: 40_000, buyIn: 30_000 });
    expect(hourlyRate(s, s.rebuys)).toBeNull();
  });
});

describe('summarize', () => {
  it('bundles invested, net, hours and hourly for one session', () => {
    const s = completed({ buyIn: 20_000, cashOut: 50_000, hours: 3, rebuys: [20_000] });
    expect(summarize(s)).toMatchObject({ invested: 40_000, net: 10_000, hours: 3, hourly: 3_333 });
  });
});

describe('totals', () => {
  it('is empty with no sessions', () => {
    expect(totals([])).toMatchObject({ sessionCount: 0, net: 0, hours: 0, hourly: null });
  });

  it('excludes running sessions so they cannot drag the averages down', () => {
    const result = totals([
      completed({ buyIn: 30_000, cashOut: 60_000, hours: 3 }),
      session({ buyIn: 30_000, cashOut: null }),
    ]);
    expect(result.sessionCount).toBe(1);
    expect(result.net).toBe(30_000);
    expect(result.hours).toBe(3);
  });

  it('aggregates net, hours and hourly rate across sessions', () => {
    const result = totals([
      completed({ buyIn: 30_000, cashOut: 60_000, hours: 3 }),
      completed({ buyIn: 30_000, cashOut: 10_000, hours: 2 }),
    ]);
    expect(result.net).toBe(10_000);
    expect(result.hours).toBe(5);
    expect(result.hourly).toBe(2_000);
  });

  it('counts winning, losing and break-even sessions separately', () => {
    const result = totals([
      completed({ buyIn: 100, cashOut: 200, hours: 1 }),
      completed({ buyIn: 100, cashOut: 50, hours: 1 }),
      completed({ buyIn: 100, cashOut: 100, hours: 1 }),
    ]);
    expect(result).toMatchObject({
      winningSessions: 1,
      losingSessions: 1,
      breakEvenSessions: 1,
      sessionCount: 3,
    });
  });

  it('tracks the biggest win and biggest loss', () => {
    const result = totals([
      completed({ buyIn: 30_000, cashOut: 90_000, hours: 4 }),
      completed({ buyIn: 30_000, cashOut: 0, hours: 1 }),
      completed({ buyIn: 30_000, cashOut: 40_000, hours: 2 }),
    ]);
    expect(result.biggestWin).toBe(60_000);
    expect(result.biggestLoss).toBe(-30_000);
  });

  it('reports the biggest "win" honestly when every session lost', () => {
    const result = totals([
      completed({ buyIn: 30_000, cashOut: 20_000, hours: 2 }),
      completed({ buyIn: 30_000, cashOut: 5_000, hours: 2 }),
    ]);
    expect(result.biggestWin).toBe(-10_000);
    expect(result.biggestLoss).toBe(-25_000);
  });
});

describe('bankroll curve', () => {
  it('accumulates results in the order they were realized', () => {
    const curve = bankrollCurve([
      completed({ id: 'c', startedAt: T0 + 20 * HOUR, hours: 2, buyIn: 100, cashOut: 400 }),
      completed({ id: 'a', startedAt: T0, hours: 2, buyIn: 100, cashOut: 300 }),
      completed({ id: 'b', startedAt: T0 + 10 * HOUR, hours: 2, buyIn: 100, cashOut: 0 }),
    ]);
    expect(curve.map((point) => [point.sessionId, point.cumulative])).toEqual([
      ['a', 200],
      ['b', 100],
      ['c', 400],
    ]);
  });

  it('ignores sessions still in progress', () => {
    expect(bankrollCurve([session()])).toEqual([]);
  });
});

describe('grouping', () => {
  const aria = venue({ id: 'v1', name: 'Aria' });
  const home = venue({ id: 'v2', name: 'Home Game', isHomeGame: true });
  const sessions = [
    completed({ stakes: STAKES_1_2, gameType: 'NLHE', venueId: 'v1', venue: aria, hours: 4, buyIn: 100, cashOut: 900 }),
    completed({ stakes: STAKES_1_2, gameType: 'PLO', venueId: 'v2', venue: home, hours: 2, buyIn: 100, cashOut: 0 }),
    completed({ stakes: STAKES_2_5, gameType: 'NLHE', venueId: 'v1', venue: aria, hours: 5, buyIn: 500, cashOut: 700 }),
  ];

  it('groups profit by stakes, best first', () => {
    const groups = byStakes(sessions);
    expect(groups.map((group) => [group.label, group.net])).toEqual([
      ['$1/$2', 700],
      ['$2/$5', 200],
    ]);
  });

  it('groups identical stakes together regardless of session count', () => {
    const groups = byStakes(sessions);
    expect(groups.find((group) => group.label === '$1/$2')?.sessionCount).toBe(2);
  });

  it('groups profit by game type', () => {
    expect(byGameType(sessions).map((group) => [group.label, group.net])).toEqual([
      ['NLHE', 1_000],
      ['PLO', -100],
    ]);
  });

  it('groups profit by venue using the attached venue', () => {
    const groups = byVenue(sessions, []);
    expect(groups.map((group) => [group.label, group.net])).toEqual([
      ['Aria', 1_000],
      ['Home Game', -100],
    ]);
  });

  it('resolves venue names from the lookup list when none is attached', () => {
    const detached = sessions.map((s) => ({ ...s, venue: null }));
    const groups = byVenue(detached, [aria, home]);
    expect(groups.map((group) => [group.label, group.net])).toEqual([
      ['Aria', 1_000],
      ['Home Game', -100],
    ]);
  });

  it('falls back to a placeholder when a venue is missing', () => {
    const orphan = completed({ venueId: 'gone', hours: 1, buyIn: 100, cashOut: 200, venue: null });
    expect(byVenue([orphan], []).map((group) => group.label)).toEqual(['Unknown venue']);
  });
});
