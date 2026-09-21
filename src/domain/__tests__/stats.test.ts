import {
  bankrollCurve,
  byBuyIn,
  byFormat,
  byGameType,
  byStakes,
  byVenue,
  cashWinRate,
  currenciesUsed,
  durationHours,
  durationMs,
  formatDuration,
  hourlyRate,
  inCurrency,
  isComplete,
  primaryCurrency,
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

  /**
   * The curve began at zero and the dashboard called the result a bankroll,
   * which it was not: it differs from one by whatever the player sat down
   * with, and for a losing player it was negative, which no bankroll is.
   */
  describe('with what the player started with', () => {
    const three = [
      completed({ id: 'a', startedAt: T0, hours: 2, buyIn: 100, cashOut: 300 }),
      completed({ id: 'b', startedAt: T0 + 10 * HOUR, hours: 2, buyIn: 100, cashOut: 0 }),
      completed({ id: 'c', startedAt: T0 + 20 * HOUR, hours: 2, buyIn: 100, cashOut: 400 }),
    ];

    it('starts from the balance rather than from nothing', () => {
      expect(bankrollCurve(three, 1_000).map((point) => point.cumulative)).toEqual([
        1_200,
        1_100,
        1_400,
      ]);
    });

    it('moves by the same amounts, since only where it starts has changed', () => {
      const from = bankrollCurve(three, 1_000).map((point) => point.net);
      expect(from).toEqual(bankrollCurve(three).map((point) => point.net));
    });

    it('is the curve it always was when nothing is passed', () => {
      // Every existing caller and every existing reading of this is unchanged.
      expect(bankrollCurve(three)).toEqual(bankrollCurve(three, 0));
    });

    it('carries a balance through a log that is under water', () => {
      // The case the old curve got most visibly wrong: a bankroll that is
      // smaller than it was is still a positive number.
      const curve = bankrollCurve(
        [completed({ id: 'a', startedAt: T0, hours: 2, buyIn: 20_000, cashOut: 0 })],
        100_000,
      );
      expect(curve[0].cumulative).toBe(80_000);
    });
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

describe('tournaments in the session math', () => {
  const tournament = (spec: Parameters<typeof session>[0] = {}) =>
    session({ format: 'tournament', buyIn: 10_000, fee: 1_000, ...spec });

  it('counts the entry fee as invested', () => {
    const entry = tournament();
    expect(totalInvested(entry, entry.rebuys)).toBe(11_000);
  });

  it('nets a tournament against buy-in and fee together', () => {
    const entry = tournament({ cashOut: 25_000, hours: 4 });
    expect(netResult(entry, entry.rebuys)).toBe(14_000);
  });

  it('counts a re-entry the same way a rebuy is counted', () => {
    const entry = tournament({ rebuys: [11_000], cashOut: 0 });
    expect(totalInvested(entry, entry.rebuys)).toBe(22_000);
    expect(netResult(entry, entry.rebuys)).toBe(-22_000);
  });

  it('leaves the fee out of a cash game entirely', () => {
    const cash = session({ buyIn: 30_000 });
    expect(totalInvested(cash, cash.rebuys)).toBe(30_000);
  });

  it('keeps two entries of the same total cost apart when they are shaped differently', () => {
    const groups = byBuyIn([
      tournament({ cashOut: 0, hours: 2 }),
      tournament({ buyIn: 11_000, fee: 0, cashOut: 0, hours: 2 }),
    ]);
    expect(groups.map((group) => group.label).sort()).toEqual(['$110', '$100+$10'].sort());
  });

  it('groups tournaments by what one entry cost', () => {
    const groups = byBuyIn([
      tournament({ cashOut: 0, hours: 2 }),
      tournament({ cashOut: 40_000, hours: 5 }),
      tournament({ buyIn: 20_000, fee: 2_000, cashOut: 0, hours: 1 }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(['$100+$10', '$200+$20']);
    expect(groups[0].sessionCount).toBe(2);
  });

  it('keeps tournaments out of the stakes breakdown, which they have none of', () => {
    const groups = byStakes([
      session({ stakes: STAKES_1_2, cashOut: 40_000, hours: 3 }),
      tournament({ cashOut: 0, hours: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('$1/$2');
  });

  it('keeps a cash session with no stakes out of the stakes breakdown too', () => {
    expect(byStakes([session({ stakes: null, cashOut: 40_000, hours: 3 })])).toEqual([]);
  });

  it('splits the two formats when asked', () => {
    const groups = byFormat([
      session({ cashOut: 40_000, hours: 3 }),
      tournament({ cashOut: 0, hours: 2 }),
    ]);
    expect(groups.map((group) => group.label).sort()).toEqual(['Cash game', 'Tournament']);
  });

  it('puts both formats in one bankroll curve', () => {
    const curve = bankrollCurve([
      session({ cashOut: 40_000, hours: 3, endedAt: T0 + HOUR }),
      tournament({ cashOut: 0, hours: 2, endedAt: T0 + 2 * HOUR }),
    ]);
    expect(curve.map((point) => point.cumulative)).toEqual([10_000, -1_000]);
  });
});

describe('cashWinRate', () => {
  const won = (spec: Parameters<typeof session>[0] = {}) =>
    session({ buyIn: 30_000, cashOut: 40_000, hours: 3, ...spec });
  const lost = (spec: Parameters<typeof session>[0] = {}) =>
    session({ buyIn: 30_000, cashOut: 10_000, hours: 3, ...spec });
  const busted = () =>
    session({ format: 'tournament', buyIn: 10_000, fee: 1_000, cashOut: 0, hours: 3 });

  it('is null with no cash sessions to measure', () => {
    expect(cashWinRate([]).rate).toBeNull();
    expect(cashWinRate([busted(), busted()]).rate).toBeNull();
  });

  it('counts wins over completed cash sessions', () => {
    const result = cashWinRate([won(), won(), lost(), lost()]);
    expect(result.rate).toBeCloseTo(0.5, 5);
    expect(result).toMatchObject({ sessions: 4, winning: 2, losing: 2, breakEven: 0 });
  });

  it('ignores a session still running', () => {
    const result = cashWinRate([won(), session({ cashOut: null, endedAt: null })]);
    expect(result.sessions).toBe(1);
    expect(result.rate).toBe(1);
  });

  it('counts a break-even session as neither', () => {
    const result = cashWinRate([won(), session({ buyIn: 30_000, cashOut: 30_000, hours: 3 })]);
    expect(result).toMatchObject({ sessions: 2, winning: 1, losing: 0, breakEven: 1 });
    expect(result.rate).toBeCloseTo(0.5, 5);
  });

  it('does not let busted tournaments drag a cash player’s win rate down', () => {
    // The defect this exists to fix: a 50% cash player who also fires ten
    // tournaments used to read as a 17% winner, under a label that sounds like
    // a verdict on how they play.
    const cash = [won(), won(), lost(), lost()];
    const withTournaments = [...cash, ...Array.from({ length: 10 }, busted)];

    expect(totals(withTournaments).winningSessions / totals(withTournaments).sessionCount)
      .toBeCloseTo(2 / 14, 5);
    expect(cashWinRate(withTournaments).rate).toBeCloseTo(0.5, 5);
    expect(cashWinRate(withTournaments)).toEqual(cashWinRate(cash));
  });

  it('does not count a tournament that cashed either', () => {
    const cashed = session({
      format: 'tournament',
      buyIn: 10_000,
      fee: 1_000,
      cashOut: 50_000,
      hours: 6,
    });
    expect(cashWinRate([won(), cashed]).sessions).toBe(1);
  });
});


describe('which currency a log is in', () => {
  const at = (currency: string, day: number) =>
    completed({ currency, startedAt: T0 + day * 24 * HOUR, hours: 3, cashOut: 40_000 });

  it('is one answer for a log with one currency', () => {
    expect(currenciesUsed([at('USD', 0), at('USD', 1)])).toEqual(['USD']);
    expect(primaryCurrency([at('USD', 0)])).toBe('USD');
  });

  it('names every currency a session was played for, commonest first', () => {
    const log = [at('EUR', 0), at('USD', 1), at('USD', 2), at('USD', 3), at('EUR', 4)];
    expect(currenciesUsed(log)).toEqual(['USD', 'EUR']);
  });

  it('breaks a tie toward the one being played now', () => {
    // Somebody who has moved. Equal history either side, and the currency they
    // are living in is the one the dashboard should open on.
    const log = [at('USD', 0), at('USD', 1), at('GBP', 2), at('GBP', 3)];
    expect(primaryCurrency(log)).toBe('GBP');
  });

  it('falls back to the default with nothing logged', () => {
    // A dashboard with no sessions still has to draw a symbol in front of zero.
    expect(currenciesUsed([])).toEqual([]);
    expect(primaryCurrency([])).toBe('USD');
  });

  it('and a total taken over one currency is a total of that currency alone', () => {
    // The defect. `totals` sums `netResult` and has no idea what the money is,
    // so a trip abroad used to be added to the bankroll at face value.
    const log = [
      completed({ currency: 'USD', buyIn: 20_000, cashOut: 50_000, hours: 3 }),
      completed({ currency: 'EUR', buyIn: 20_000, cashOut: 60_000, hours: 3 }),
    ];
    expect(totals(log).net).toBe(70_000);
    expect(totals(inCurrency(log, 'USD')).net).toBe(30_000);
    expect(totals(inCurrency(log, 'EUR')).net).toBe(40_000);
  });
});
