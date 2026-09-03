import {
  MIN_SESSIONS_FOR_ESTIMATE,
  assessRecentStretch,
  confidenceBand,
  estimatePlayer,
  normalCdf,
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

  it('widens with the square root of hours, not linearly', () => {
    const estimate = estimatePlayer(noisy);
    const band = confidenceBand(estimate, noisy);
    const quarter = band[5];
    const full = band[20];
    const widthRatio = (full.upper - full.expected) / (quarter.upper - quarter.expected);
    expect(widthRatio).toBeCloseTo(Math.sqrt(full.hours / quarter.hours), 10);
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
