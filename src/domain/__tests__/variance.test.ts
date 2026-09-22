import {
  MIN_SESSIONS_FOR_ESTIMATE,
  assessRecentStretch,
  confidenceBand,
  estimatePlayer,
  normalCdf,
  nothingReadable,
  probabilityOfLoss,
  toObservations,
  type SessionObservation,
} from '../variance';
import { HOUR, STAKES_1_2, STAKES_2_5, T0, completed, session } from './support';

/** `count` sessions of `hours` each, every one returning exactly `resultBb`. */
const observations = (
  specs: { resultBb: number; hours: number }[],
): SessionObservation[] =>
  specs.map((spec, index) => ({
    sessionId: `s${index}`,
    resultBb: spec.resultBb,
    hours: spec.hours,
    endedAt: T0 + index * HOUR,
  }));

const repeat = (count: number, resultBb: number, hours: number) =>
  observations(Array.from({ length: count }, () => ({ resultBb, hours })));

describe('normalCdf', () => {
  // The approximation is accurate to |ε| < 7.5e-8, so assertions are held to
  // that rather than to a precision it never claimed.
  it('is symmetric about zero', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 6);
  });

  it('matches the textbook values', () => {
    expect(normalCdf(1)).toBeCloseTo(0.841345, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975002, 5);
    expect(normalCdf(-2.5)).toBeCloseTo(0.006210, 5);
  });

  it('saturates rather than overshooting in the tails', () => {
    expect(normalCdf(8)).toBeLessThanOrEqual(1);
    expect(normalCdf(-8)).toBeGreaterThanOrEqual(0);
  });
});

describe('toObservations', () => {
  it('converts results into big blinds so stakes can be pooled', () => {
    // +$200 at $1/$2 is +100bb; +$200 at $2/$5 is +40bb.
    const [small, big] = toObservations([
      completed({ stakes: STAKES_1_2, buyIn: 30_000, cashOut: 50_000, hours: 2, startedAt: T0 }),
      completed({
        stakes: STAKES_2_5,
        buyIn: 100_000,
        cashOut: 120_000,
        hours: 2,
        startedAt: T0 + 10 * HOUR,
      }),
    ]);
    expect(small.resultBb).toBe(100);
    expect(big.resultBb).toBe(40);
  });

  it('subtracts rebuys before converting', () => {
    const [only] = toObservations([
      completed({ buyIn: 30_000, rebuys: [30_000], cashOut: 40_000, hours: 3 }),
    ]);
    expect(only.resultBb).toBe(-100);
  });

  it('skips running sessions and zero-length sessions', () => {
    expect(
      toObservations([
        session(),
        completed({ hours: 0, buyIn: 100, cashOut: 200 }),
        completed({ hours: 2, buyIn: 100, cashOut: 200 }),
      ]),
    ).toHaveLength(1);
  });

  it('orders observations oldest first', () => {
    const result = toObservations([
      completed({ id: 'late', startedAt: T0 + 100 * HOUR, hours: 1, buyIn: 100, cashOut: 200 }),
      completed({ id: 'early', startedAt: T0, hours: 1, buyIn: 100, cashOut: 200 }),
    ]);
    expect(result.map((o) => o.sessionId)).toEqual(['early', 'late']);
  });
});

describe('estimatePlayer', () => {
  it('computes win rate as total big blinds over total hours', () => {
    const estimate = estimatePlayer(observations([
      { resultBb: 100, hours: 5 },
      { resultBb: -50, hours: 5 },
    ]));
    expect(estimate.winRateBbPerHour).toBe(5);
    expect(estimate.totalHours).toBe(10);
    expect(estimate.totalBb).toBe(50);
  });

  it('reports zero standard deviation for a player who never deviates', () => {
    // Every session is exactly +20bb over 4 hours, so no residual exists.
    const estimate = estimatePlayer(repeat(10, 20, 4));
    expect(estimate.winRateBbPerHour).toBe(5);
    expect(estimate.stdDevBbPerHour).toBeCloseTo(0, 10);
  });

  it('recovers a known standard deviation from constructed residuals', () => {
    // Ten 1-hour sessions alternating +10bb and -10bb: win rate 0, and each
    // residual is ±10 over one hour, so σ² = Σ100/10 = 100 before the n/(n−1)
    // correction, i.e. σ = 10·√(10/9).
    const alternating = observations(
      Array.from({ length: 10 }, (_, i) => ({ resultBb: i % 2 === 0 ? 10 : -10, hours: 1 })),
    );
    const estimate = estimatePlayer(alternating);
    expect(estimate.winRateBbPerHour).toBeCloseTo(0, 10);
    expect(estimate.stdDevBbPerHour).toBeCloseTo(10 * Math.sqrt(10 / 9), 10);
  });

  it('scales the standard deviation with the square root of time', () => {
    // The same ±10bb swings spread over 4-hour sessions represent a calmer
    // per-hour game: σ per hour halves as session length quadruples.
    const longer = observations(
      Array.from({ length: 10 }, (_, i) => ({ resultBb: i % 2 === 0 ? 10 : -10, hours: 4 })),
    );
    const estimate = estimatePlayer(longer);
    expect(estimate.stdDevBbPerHour).toBeCloseTo(5 * Math.sqrt(10 / 9), 10);
  });

  it('cannot estimate a deviation from a single session', () => {
    const estimate = estimatePlayer(repeat(1, 50, 5));
    expect(estimate.stdDevBbPerHour).toBe(0);
    expect(estimate.reliable).toBe(false);
  });

  it('handles no data at all without dividing by zero', () => {
    const estimate = estimatePlayer([]);
    expect(estimate).toMatchObject({ winRateBbPerHour: 0, stdDevBbPerHour: 0, sessionCount: 0 });
  });

  it('is unreliable until there are enough sessions and hours', () => {
    expect(estimatePlayer(repeat(MIN_SESSIONS_FOR_ESTIMATE - 1, 10, 5)).reliable).toBe(false);
    expect(estimatePlayer(repeat(MIN_SESSIONS_FOR_ESTIMATE, 10, 1)).reliable).toBe(false);
    expect(estimatePlayer(repeat(MIN_SESSIONS_FOR_ESTIMATE, 10, 5)).reliable).toBe(true);
  });
});

describe('confidenceBand', () => {
  const noisy = observations(
    Array.from({ length: 20 }, (_, i) => ({ resultBb: i % 2 === 0 ? 40 : -20, hours: 2 })),
  );

  it('starts at the origin', () => {
    const band = confidenceBand(estimatePlayer(noisy), noisy);
    expect(band[0]).toEqual({ hours: 0, expected: 0, upper: 0, lower: 0, actual: 0 });
  });

  it('has one point per session plus the origin', () => {
    expect(confidenceBand(estimatePlayer(noisy), noisy)).toHaveLength(noisy.length + 1);
  });

  it('widens with the square root of hours, discounted for the hours the fit has spent', () => {
    const estimate = estimatePlayer(noisy);
    const band = confidenceBand(estimate, noisy);
    const quarter = band[5];
    const half = band[10];
    const total = estimate.totalHours;
    const width = (point: (typeof band)[number]) => point.upper - point.expected;
    // σ√(h(1 − h/H)) rather than σ√h: the same square root, against the hours
    // the fitted average has not already used up.
    const ratio = (h: number) => Math.sqrt(h * (1 - h / total));
    expect(width(half) / width(quarter)).toBeCloseTo(ratio(half.hours) / ratio(quarter.hours), 10);
  });

  it('still widens over the stretch a player actually reads', () => {
    const band = confidenceBand(estimatePlayer(noisy), noisy);
    expect(band[10].upper - band[10].expected).toBeGreaterThan(band[5].upper - band[5].expected);
  });

  it('closes at the final point, because the curve lands there by construction', () => {
    // The whole finding. `w` is totalBb/totalHours, so `w·totalHours` is
    // totalBb: the actual curve meets the expected line at the right-hand edge
    // on every chart, and an envelope that stayed open there was promising a
    // comparison it could not lose.
    const band = confidenceBand(estimatePlayer(noisy), noisy);
    const last = band[band.length - 1];
    expect(last.actual).toBeCloseTo(last.expected, 10);
    expect(last.upper - last.lower).toBeCloseTo(0, 10);
  });

  it('barely corrects a band drawn from a much longer history', () => {
    // An estimate fitted to far more hours than these never had the problem,
    // and the correction has to get out of its way.
    const long = observations(
      Array.from({ length: 400 }, (_, i) => ({ resultBb: i % 2 === 0 ? 40 : -20, hours: 2 })),
    );
    const estimate = estimatePlayer(long);
    const band = confidenceBand(estimate, noisy);
    const point = band[5];
    const uncorrected = 1.96 * estimate.stdDevBbPerHour * Math.sqrt(point.hours);
    // Ten hours against a fit of eight hundred: the band gives up well under a
    // percent of its width, where fitting to these ten alone would close it.
    expect((point.upper - point.expected) / uncorrected).toBeGreaterThan(0.99);
    expect((point.upper - point.expected) / uncorrected).toBeLessThanOrEqual(1);
  });

  it('tracks the player’s actual cumulative result alongside the band', () => {
    const band = confidenceBand(estimatePlayer(noisy), noisy);
    expect(band[band.length - 1].actual).toBeCloseTo(200, 10);
  });

  it('narrows the band at a lower confidence level', () => {
    const estimate = estimatePlayer(noisy);
    const wide = confidenceBand(estimate, noisy, 95);
    const narrow = confidenceBand(estimate, noisy, 70);
    expect(narrow[10].upper).toBeLessThan(wide[10].upper);
  });
});

describe('assessRecentStretch', () => {
  /** A believable winner: +5bb/hr with real swings. */
  const history = observations(
    Array.from({ length: 40 }, (_, i) => ({
      resultBb: [60, -40, 20, -10, 90, -70, 15, 5][i % 8],
      hours: 4,
    })),
  );

  it('says so plainly when there is not enough history', () => {
    const thin = repeat(3, 20, 2);
    const assessment = assessRecentStretch(thin, estimatePlayer(thin));
    expect(assessment.verdict).toBe('insufficient_data');
    expect(assessment.headline).toMatch(/not enough/i);
    expect(assessment.suggestsUntilt).toBe(false);
  });

  it('asks only for what is actually missing', () => {
    // `reliable` wants eight sessions and twenty hours, and a player can clear
    // one floor without the other. Both shortfalls used to print whatever they
    // came out at, so nine two-hour sessions read "Log 0 more sessions and
    // around 2 more hours", and at nineteen hours, "around 1 more hours". This
    // is the whole body of the Variance tab's empty state.
    const sessionsButNotHours = repeat(9, 4, 2);
    const nine = assessRecentStretch(sessionsButNotHours, estimatePlayer(sessionsButNotHours));
    expect(nine.body).not.toContain('0 more');
    expect(nine.body).toContain('around 2 more hours');
    expect(nine.body).not.toContain('more sessions');

    // One hour short, and it is one hour rather than one hours.
    const oneShort = repeat(9, 4, 19 / 9);
    const almost = assessRecentStretch(oneShort, estimatePlayer(oneShort));
    expect(almost.body).toContain('around 1 more hour,');

    // Hours cleared and sessions not: the other half on its own.
    const hoursButNotSessions = repeat(4, 20, 7);
    const four = assessRecentStretch(hoursButNotSessions, estimatePlayer(hoursButNotSessions));
    expect(four.body).toContain('4 more sessions');
    expect(four.body).not.toContain('more hours');

    // Short of both, which is where the sentence reads as it always did.
    const thin = repeat(3, 20, 2);
    expect(assessRecentStretch(thin, estimatePlayer(thin)).body).toContain(
      '5 more sessions and around 14 more hours',
    );
  });

  it('refuses a verdict when the stretch is the player’s whole history', () => {
    // The finding this guard exists for. `w` is fitted to these ten sessions,
    // so `actual − w·hours` is zero however they went, and every one of these
    // runs used to come back "Right where you should be" with z exactly 0.
    const threeHourSessions = (results: number[]) =>
      observations(results.map((resultBb) => ({ resultBb, hours: 3 })));
    for (const run of [
      threeHourSessions([-200, -180, -160, -150, -140, -130, -120, -110]),
      threeHourSessions([300, 280, 260, 240, 220, 200, 180, 160, 140]),
      threeHourSessions([-90, 120, -300, 40, -60, 250, -110, 30, -70, 10]),
    ]) {
      const estimate = estimatePlayer(run);
      expect(estimate.reliable).toBe(true);
      const assessment = assessRecentStretch(run, estimate, 10);
      expect(assessment.verdict).toBe('insufficient_data');
      expect(assessment.headline).toMatch(/outside this stretch/i);
      expect(assessment.suggestsUntilt).toBe(false);
    }
  });

  it('measures a stretch against the sessions before it, not against itself', () => {
    // Four terrible nights on the end of a modest winner. Fitted to everything,
    // the old spread damped this to z = −0.36; the stretch is a quarter of the
    // sample, so the fit has already swallowed a quarter of the deviation.
    const run = observations(
      [-90, 120, -300, 40, -60, 250, -110, 30, -70, 10, -400, -380, -350, -300].map(
        (resultBb) => ({ resultBb, hours: 3 }),
      ),
    );
    const estimate = estimatePlayer(run);
    const assessment = assessRecentStretch(run, estimate, 4);
    const hours = 12;
    const naive =
      (assessment.actualBb - assessment.expectedBb) /
      (estimate.stdDevBbPerHour * Math.sqrt(hours));
    expect(assessment.z).toBeLessThan(naive);
    expect(assessment.z / naive).toBeCloseTo(
      1 / Math.sqrt(1 - hours / estimate.totalHours),
      6,
    );
  });

  it('calls a middling stretch normal', () => {
    const estimate = estimatePlayer(history);
    const assessment = assessRecentStretch(history, estimate, 8);
    expect(assessment.verdict).toBe('normal');
    expect(Math.abs(assessment.z)).toBeLessThan(1);
  });

  it('flags a severe downswing as outside the band but still ordinary', () => {
    const estimate = estimatePlayer(history);
    const crash = [...history, ...repeat(5, -400, 4)];
    const assessment = assessRecentStretch(crash, estimate, 5);
    expect(assessment.verdict).toBe('running_bad');
    expect(assessment.z).toBeLessThan(-1.96);
    expect(assessment.body).toMatch(/happen to winning players/i);
    expect(assessment.suggestsUntilt).toBe(true);
  });

  it('flags a heater so the player does not bank on it', () => {
    const estimate = estimatePlayer(history);
    const heater = [...history, ...repeat(5, 500, 4)];
    const assessment = assessRecentStretch(heater, estimate, 5);
    expect(assessment.verdict).toBe('running_hot');
    expect(assessment.suggestsUntilt).toBe(false);
  });

  it('names a mild downswing as inside normal variance', () => {
    const estimate = estimatePlayer(history);
    // ~-7.5bb/hr over 16 hours against a +2.2bb/hr baseline: a bad week, well
    // inside the 95% band.
    const dip = [...history, ...repeat(4, -30, 4)];
    const assessment = assessRecentStretch(dip, estimate, 4);
    expect(assessment.verdict).toBe('below_expectation');
    expect(assessment.body).toMatch(/inside the range/i);
    expect(assessment.suggestsUntilt).toBe(true);
  });

  it('brackets the stretch with a 95% envelope that contains the expectation', () => {
    const estimate = estimatePlayer(history);
    const assessment = assessRecentStretch(history, estimate, 10);
    expect(assessment.lowerBb).toBeLessThan(assessment.expectedBb);
    expect(assessment.upperBb).toBeGreaterThan(assessment.expectedBb);
  });

  it('reports a percentile consistent with its z-score', () => {
    const estimate = estimatePlayer(history);
    const crash = [...history, ...repeat(5, -400, 4)];
    const assessment = assessRecentStretch(crash, estimate, 5);
    expect(assessment.percentile).toBeCloseTo(normalCdf(assessment.z), 6);
    expect(assessment.percentile).toBeLessThan(0.025);
  });

  it('only looks at the requested number of recent sessions', () => {
    const estimate = estimatePlayer(history);
    const assessment = assessRecentStretch(history, estimate, 6);
    expect(assessment.sessionCount).toBe(6);
    expect(assessment.hours).toBe(24);
  });

  it('never claims the player is broken, whatever the verdict', () => {
    const estimate = estimatePlayer(history);
    for (const tail of [repeat(5, -400, 4), repeat(5, 500, 4), []]) {
      const { body, headline } = assessRecentStretch([...history, ...tail], estimate, 5);
      expect(`${headline} ${body}`).not.toMatch(/tilt|bad player|losing player|due|owed/i);
    }
  });
});

describe('probabilityOfLoss', () => {
  const history = observations(
    Array.from({ length: 40 }, (_, i) => ({
      resultBb: [60, -40, 20, -10, 90, -70, 15, 5][i % 8],
      hours: 4,
    })),
  );

  it('is unknown without a reliable estimate', () => {
    expect(probabilityOfLoss(estimatePlayer(repeat(2, 10, 1)), 100)).toBeNull();
  });

  it('falls as the sample grows for a winning player', () => {
    const estimate = estimatePlayer(history);
    const short = probabilityOfLoss(estimate, 20)!;
    const long = probabilityOfLoss(estimate, 500)!;
    expect(short).toBeGreaterThan(long);
    expect(long).toBeGreaterThanOrEqual(0);
  });

  it('is still meaningfully above zero over a short stretch, the reassuring bit', () => {
    const estimate = estimatePlayer(history);
    expect(probabilityOfLoss(estimate, 20)!).toBeGreaterThan(0.2);
  });
});

describe('the boundary around the cash-game model', () => {
  it('drops tournaments, whose results are the wrong shape for a random walk', () => {
    const observations = toObservations([
      session({ cashOut: 40_000, hours: 3 }),
      session({ format: 'tournament', buyIn: 10_000, fee: 1_000, cashOut: 0, hours: 4 }),
    ]);
    expect(observations).toHaveLength(1);
  });

  it('drops a cash session whose blinds were never recorded', () => {
    expect(toObservations([session({ stakes: null, cashOut: 40_000, hours: 3 })])).toEqual([]);
  });

  it('still drops a session with no measurable duration', () => {
    expect(toObservations([session({ cashOut: 40_000, hours: 0 })])).toEqual([]);
  });

  it('leaves a tournament-only player with no estimate rather than a wrong one', () => {
    const entries = Array.from({ length: 30 }, () =>
      session({ format: 'tournament', buyIn: 10_000, fee: 1_000, cashOut: 0, hours: 4 }),
    );
    const estimate = estimatePlayer(toObservations(entries));
    expect(estimate.sessionCount).toBe(0);
    expect(estimate.reliable).toBe(false);
  });
});

describe('a log this model cannot read a single session of', () => {
  const entries = (count: number) =>
    Array.from({ length: count }, () =>
      session({ format: 'tournament', buyIn: 10_000, fee: 1_000, cashOut: 0, hours: 4 }),
    );

  it('is not told to log more of what it has been logging all along', () => {
    // The shortfall counts against the cash floors, and `toObservations` drops
    // every tournament before the count is taken. So thirty entries in, the
    // page said "Log 8 more sessions and around 20 more hours" -- the same
    // sentence a device with nothing on it gets, and one that no amount of
    // playing was ever going to move.
    const logged = entries(30);
    const said = nothingReadable(logged, toObservations(logged));

    expect(said).not.toBeNull();
    expect(said!.body).not.toMatch(/more sessions|more hours/);
    expect(said!.body).toMatch(/tournament/i);
  });

  it('and says which way it cannot read them, when the log is mixed', () => {
    // A cash game logged without its stakes is dropped for the same reason and
    // is not a tournament, so the sentence that names only tournaments would
    // be wrong.
    const logged = [
      ...entries(2),
      session({ stakes: null, buyIn: 30_000, cashOut: 40_000, hours: 4 }),
    ];
    const said = nothingReadable(logged, toObservations(logged));

    expect(said).not.toBeNull();
    expect(said!.body).toMatch(/without its stakes/);
  });

  it('but leaves the shortfall alone when there is something to read', () => {
    // The ordinary case, and the honest answer there: this player has readable
    // sessions and simply not enough of them.
    const logged = [
      ...entries(2),
      session({ stakes: STAKES_1_2, buyIn: 30_000, cashOut: 40_000, hours: 4 }),
    ];
    expect(nothingReadable(logged, toObservations(logged))).toBeNull();
  });

  it('and leaves an empty log alone, where the shortfall is the whole answer', () => {
    expect(nothingReadable([], [])).toBeNull();
  });
});
