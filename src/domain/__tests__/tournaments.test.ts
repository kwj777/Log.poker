import {
  BOOTSTRAP_SAMPLES,
  MIN_ENTRIES_FOR_INTERVAL,
  assessRoi,
  assessTournaments,
  bootstrapRoi,
  BOOTSTRAP_DRAW_BUDGET,
  entriesSignature,
  MIN_BOOTSTRAP_SAMPLES,
  samplesFor,
  formatRoi,
  roiConcentration,
  type EntryResult,
  formatFinish,
  medianDryRun,
  probabilityOfDryRun,
  tournamentTotals,
} from '../tournaments';
import { HOUR, T0, session } from './support';

/** One tournament entry: cost, prize, and where it finished. */
const entry = (
  spec: {
    buyIn?: number;
    fee?: number;
    prize?: number;
    entrants?: number | null;
    finishPosition?: number | null;
    hours?: number;
    endedAt?: number;
  } = {},
) =>
  session({
    format: 'tournament',
    buyIn: spec.buyIn ?? 10_000,
    fee: spec.fee ?? 1_000,
    cashOut: spec.prize ?? 0,
    entrants: spec.entrants ?? null,
    finishPosition: spec.finishPosition ?? null,
    hours: spec.hours ?? 3,
    ...(spec.endedAt === undefined ? {} : { endedAt: spec.endedAt }),
  });

describe('tournamentTotals', () => {
  it('is empty with nothing to roll up', () => {
    const result = tournamentTotals([]);
    expect(result.entries).toBe(0);
    expect(result.roi).toBeNull();
    expect(result.itmRate).toBeNull();
  });

  it('ignores cash sessions entirely', () => {
    const result = tournamentTotals([session({ cashOut: 50_000 }), entry({ prize: 40_000 })]);
    expect(result.entries).toBe(1);
  });

  it('ignores a tournament still in progress', () => {
    const live = session({ format: 'tournament', buyIn: 10_000, cashOut: null, endedAt: null });
    expect(tournamentTotals([live, entry()]).entries).toBe(1);
  });

  it('counts the entry fee as money spent', () => {
    // Two entries at $100+$10, one paying $150: 300 in, 150 back.
    const result = tournamentTotals([entry(), entry({ prize: 15_000 })]);
    expect(result.invested).toBe(22_000);
    expect(result.returned).toBe(15_000);
    expect(result.net).toBe(-7_000);
    expect(result.fees).toBe(2_000);
  });

  it('reports ROI against everything that went in, rake included', () => {
    const result = tournamentTotals([entry({ prize: 22_000 })]);
    expect(result.invested).toBe(11_000);
    expect(result.roi).toBeCloseTo(1, 5);
  });

  it('reads a cash off the prize rather than the finishing position', () => {
    // No finish recorded anywhere, which an import often produces.
    const result = tournamentTotals([entry({ prize: 15_000 }), entry(), entry()]);
    expect(result.cashes).toBe(1);
    expect(result.itmRate).toBeCloseTo(1 / 3, 5);
  });

  it('takes the best finish and the average as a share of the field', () => {
    const result = tournamentTotals([
      entry({ finishPosition: 50, entrants: 100 }),
      entry({ finishPosition: 10, entrants: 100 }),
    ]);
    expect(result.bestFinish).toBe(10);
    expect(result.averageFinishPercentile).toBeCloseTo(0.3, 5);
    expect(result.finishesKnown).toBe(2);
  });

  it('ignores a finish with no field size when averaging', () => {
    const result = tournamentTotals([
      entry({ finishPosition: 10, entrants: 100 }),
      entry({ finishPosition: 4, entrants: null }),
    ]);
    expect(result.bestFinish).toBe(4);
    expect(result.finishesKnown).toBe(1);
    expect(result.averageFinishPercentile).toBeCloseTo(0.1, 5);
  });

  it('counts the dry run back from the most recent entry', () => {
    const result = tournamentTotals([
      entry({ prize: 40_000, endedAt: T0 + HOUR }),
      entry({ endedAt: T0 + 2 * HOUR }),
      entry({ endedAt: T0 + 3 * HOUR }),
    ]);
    expect(result.currentDryRun).toBe(2);
  });

  it('has no dry run when the last one cashed', () => {
    const result = tournamentTotals([
      entry({ endedAt: T0 + HOUR }),
      entry({ prize: 40_000, endedAt: T0 + 2 * HOUR }),
    ]);
    expect(result.currentDryRun).toBe(0);
  });

  it('totals hours and an hourly rate', () => {
    const result = tournamentTotals([entry({ hours: 2, prize: 33_000 })]);
    expect(result.hours).toBeCloseTo(2, 5);
    expect(result.hourly).toBe(11_000);
  });
});

describe('probabilityOfDryRun', () => {
  it('is the cash rate missed n times over', () => {
    expect(probabilityOfDryRun(0.2, 1)).toBeCloseTo(0.8, 10);
    expect(probabilityOfDryRun(0.2, 5)).toBeCloseTo(0.8 ** 5, 10);
  });

  it('falls as the run lengthens', () => {
    const short = probabilityOfDryRun(0.15, 5) as number;
    const long = probabilityOfDryRun(0.15, 20) as number;
    expect(long).toBeLessThan(short);
  });

  it('refuses rates it cannot say anything about', () => {
    expect(probabilityOfDryRun(0, 5)).toBeNull();
    expect(probabilityOfDryRun(1, 5)).toBeNull();
    expect(probabilityOfDryRun(0.2, 0)).toBeNull();
  });
});

describe('medianDryRun', () => {
  it('is where a dry run becomes more likely than not', () => {
    const median = medianDryRun(0.2) as number;
    expect(probabilityOfDryRun(0.2, Math.round(median))).toBeCloseTo(0.5, 1);
  });

  it('is longer for a lower cash rate', () => {
    expect(medianDryRun(0.1) as number).toBeGreaterThan(medianDryRun(0.3) as number);
  });
});

describe('assessTournaments', () => {
  const many = (count: number, prizeEvery: number) =>
    Array.from({ length: count }, (_, index) =>
      entry({ prize: index % prizeEvery === 0 ? 40_000 : 0, endedAt: T0 + index * HOUR }),
    );

  it('says there is nothing yet with no entries', () => {
    expect(assessTournaments(tournamentTotals([])).headline).toBe('No tournaments yet');
  });

  it('leaves the ROI alone entirely, since assessRoi answers that with a range', () => {
    // Two cards sit next to each other on the variance screen. This one is about
    // the dry run; saying the same thing about sample size in both would put the
    // paragraph on screen twice, and only one of them has a number in it.
    for (const count of [10, 40, 200]) {
      const { body } = assessTournaments(tournamentTotals(many(count, 4)));
      expect(body).not.toMatch(/\bROI\b/);
    }
  });

  it('answers the two-in-the-morning question with the player’s own rate', () => {
    // 20 entries, cashing every fourth, ending on a run of three misses.
    const assessment = assessTournaments(tournamentTotals(many(20, 4)));
    expect(assessment.headline).toBe('3 without a cash');
    expect(assessment.body).toContain('ordinary shape of the game');
  });

  it('never tells the player they are broken or that anything is owed', () => {
    for (const count of [1, 5, 20, 40, 120]) {
      const { headline, body } = assessTournaments(tournamentTotals(many(count, 4)));
      expect(`${headline} ${body}`).not.toMatch(/due|owed|deserve|broken|leak|tilting/i);
    }
  });

  it('offers Untilt only when the run is genuinely unusual', () => {
    const ordinary = assessTournaments(tournamentTotals(many(8, 4)));
    expect(ordinary.suggestsUntilt).toBe(false);
  });

  it('stops calling a run ordinary at the point it starts offering Untilt over it', () => {
    // The body said "the ordinary shape of the game, not a sign anything has
    // changed" whatever the odds came out at, including runs rare enough that
    // the same function turned round and offered Untilt. Both readings still
    // refuse to blame the player; only one of them calls the run ordinary.
    const ordinary = assessTournaments(tournamentTotals(many(8, 4)));
    expect(ordinary.suggestsUntilt).toBe(false);
    expect(ordinary.body).toContain('ordinary shape of the game');

    // A quarter cash rate, then twenty-five straight blanks on the end of it:
    // about a 1-in-65 run, which is where `suggestsUntilt` turns on.
    const blanks = Array.from({ length: 25 }, (_, index) =>
      entry({ prize: 0, endedAt: T0 + (40 + index) * HOUR }),
    );
    const long = assessTournaments(tournamentTotals([...many(40, 4), ...blanks]));
    expect(long.suggestsUntilt).toBe(true);
    expect(long.body).not.toContain('ordinary shape of the game');
    expect(long.body).toContain('still variance');
    expect(`${long.headline} ${long.body}`).not.toMatch(/tilt|bad player|due|owed/i);
  });

  it('is calm about a player who has never cashed', () => {
    const never = [entry(), entry(), entry(), entry()];
    const assessment = assessTournaments(tournamentTotals(never));
    expect(assessment.headline).toBe('No cashes yet');
    expect(assessment.body).toContain('most tournament entries end with nothing');
  });
});

describe('formatFinish', () => {
  it('writes the place with its ordinal and the field', () => {
    expect(formatFinish(1, 340)).toBe('1st of 340');
    expect(formatFinish(2, 340)).toBe('2nd of 340');
    expect(formatFinish(3, 340)).toBe('3rd of 340');
    expect(formatFinish(12, 340)).toBe('12th of 340');
    expect(formatFinish(21, 340)).toBe('21st of 340');
  });

  it('gets the teens right', () => {
    expect(formatFinish(11, null)).toBe('11th');
    expect(formatFinish(12, null)).toBe('12th');
    expect(formatFinish(13, null)).toBe('13th');
    expect(formatFinish(111, null)).toBe('111th');
  });

  it('falls back to whichever half it has', () => {
    expect(formatFinish(12, null)).toBe('12th');
    expect(formatFinish(null, 340)).toBe('340 entrants');
    expect(formatFinish(null, null)).toBeNull();
  });
});

describe('bootstrapRoi', () => {
  /** `count` entries costing $110 each, with returns following a repeating pattern. */
  const runs = (count: number, pattern: readonly number[]): EntryResult[] =>
    Array.from({ length: count }, (_, index) => ({
      invested: 11_000,
      returned: pattern[index % pattern.length],
    }));

  /** Three cashes in ten, adding up to exactly break even over the ten. */
  const BREAK_EVEN = [0, 0, 0, 22_000, 0, 0, 0, 0, 33_000, 55_000];

  const width = (interval: { lower: number; upper: number }) => interval.upper - interval.lower;

  it('refuses a sample too small to describe anything', () => {
    expect(bootstrapRoi(runs(9, BREAK_EVEN))).toBeNull();
    expect(bootstrapRoi(runs(MIN_ENTRIES_FOR_INTERVAL, BREAK_EVEN))).not.toBeNull();
  });

  it('refuses entries that cost nothing, having no ROI to speak of', () => {
    const free = Array.from({ length: 20 }, () => ({ invested: 0, returned: 0 }));
    expect(bootstrapRoi(free)).toBeNull();
  });

  it('reports the ROI actually observed alongside the range', () => {
    const interval = bootstrapRoi(runs(50, BREAK_EVEN));
    expect(interval?.roi).toBeCloseTo(0, 10);
    expect(interval?.entries).toBe(50);
    expect(interval?.samples).toBe(BOOTSTRAP_SAMPLES);
  });

  it('brackets the observed ROI', () => {
    const interval = bootstrapRoi(runs(50, BREAK_EVEN));
    expect(interval!.lower).toBeLessThan(interval!.roi);
    expect(interval!.upper).toBeGreaterThan(interval!.roi);
  });

  it('leaves a realistic entry list at the full sample count', () => {
    // The budget exists for a log nobody has yet. It must not quietly halve
    // the resampling of somebody with a hundred tournaments behind them.
    expect(samplesFor(10)).toBe(BOOTSTRAP_SAMPLES);
    expect(samplesFor(100)).toBe(BOOTSTRAP_SAMPLES);
    expect(bootstrapRoi(runs(100, BREAK_EVEN))?.samples).toBe(BOOTSTRAP_SAMPLES);
  });

  it('and trades resamples for time on a list big enough to be slow', () => {
    // Samples times entries is the work, and at the full count a thousand
    // entries was over a second of blocked JavaScript for one stat tile.
    expect(samplesFor(500)).toBeLessThan(BOOTSTRAP_SAMPLES);
    expect(samplesFor(200) * 200).toBeLessThanOrEqual(BOOTSTRAP_DRAW_BUDGET);
    // The floor outranks the budget, which is the point of having one: past
    // about four hundred entries the trade stops rather than continuing until
    // there is nothing left to take.
    expect(samplesFor(500)).toBe(MIN_BOOTSTRAP_SAMPLES);
    expect(samplesFor(100_000)).toBe(MIN_BOOTSTRAP_SAMPLES);
  });

  it('still brackets the observed ROI at the reduced count', () => {
    // The trade is only defensible if the answer is still an answer.
    const interval = bootstrapRoi(runs(400, BREAK_EVEN))!;
    expect(interval.lower).toBeLessThan(interval.roi);
    expect(interval.upper).toBeGreaterThan(interval.roi);
    expect(interval.samples).toBeLessThan(BOOTSTRAP_SAMPLES);
  });

  it('is the same interval every time, so it cannot twitch between renders', () => {
    const once = bootstrapRoi(runs(40, BREAK_EVEN));
    const twice = bootstrapRoi(runs(40, BREAK_EVEN));
    expect(once).toEqual(twice);
  });

  it('signs an entry list so a caller can tell when the answer could move', () => {
    // What the screens key their cache on. It has to change when a result
    // changes and stay put when the store merely hands out a new array.
    const a = runs(12, BREAK_EVEN);
    expect(entriesSignature(a)).toBe(entriesSignature(runs(12, BREAK_EVEN)));
    expect(entriesSignature(a)).not.toBe(entriesSignature(runs(13, BREAK_EVEN)));
    expect(entriesSignature(a)).not.toBe(
      entriesSignature([...a.slice(0, 11), { invested: 11_000, returned: 99_000 }]),
    );
    // Order is in it, because the draw picks by index.
    expect(entriesSignature(a)).not.toBe(entriesSignature([...a].reverse()));
  });

  it('actually uses the seed it is given', () => {
    const a = bootstrapRoi(runs(40, BREAK_EVEN), { seed: 1 });
    const b = bootstrapRoi(runs(40, BREAK_EVEN), { seed: 2 });
    expect(a).not.toEqual(b);
    // Different draws, same underlying results: the two agree on the answer.
    expect(a!.lower).toBeCloseTo(b!.lower, 1);
  });

  it('narrows as the sample grows, which is the whole point', () => {
    const few = bootstrapRoi(runs(20, BREAK_EVEN))!;
    const many = bootstrapRoi(runs(200, BREAK_EVEN))!;
    // Ten times the entries, so a little over three times narrower.
    expect(width(many)).toBeLessThan(width(few) * 0.6);
    expect(few.roi).toBeCloseTo(many.roi, 10);
  });

  it('widens as the confidence level rises', () => {
    const results = runs(60, BREAK_EVEN);
    const ninety = bootstrapRoi(results, { level: 90 })!;
    const ninetyFive = bootstrapRoi(results, { level: 95 })!;
    expect(ninetyFive.lower).toBeLessThanOrEqual(ninety.lower);
    expect(ninetyFive.upper).toBeGreaterThanOrEqual(ninety.upper);
  });

  it('collapses to a point when every entry is identical', () => {
    // Nothing to resample: every draw is the same number, so there is no spread
    // and the interval says exactly that rather than inventing one.
    const identical = runs(30, [22_000]);
    const interval = bootstrapRoi(identical)!;
    expect(interval.roi).toBeCloseTo(1, 10);
    expect(width(interval)).toBeCloseTo(0, 10);
  });

  it('calls a player who has never cashed a loser, with no range at all', () => {
    const interval = bootstrapRoi(runs(30, [0]))!;
    expect(interval.roi).toBeCloseTo(-1, 10);
    expect(interval.verdict).toBe('losing');
  });

  it('calls it winning only when the whole range clears break even', () => {
    // Every entry returns more than it cost, so every resample does too.
    expect(bootstrapRoi(runs(40, [15_000, 20_000, 12_000]))!.verdict).toBe('winning');
  });

  it('leaves a straddling range undetermined rather than picking a side', () => {
    expect(bootstrapRoi(runs(40, BREAK_EVEN))!.verdict).toBe('undetermined');
  });

  it('needs a great many entries before a thin edge separates from zero', () => {
    // A genuine 5% winner, paying the way tournaments actually pay: one entry in
    // ten returning ten and a half times the buy-in. Five thousand entries is
    // still not enough to tell that player from a break-even one, which is the
    // most useful thing this whole calculation has to say. Analytically the
    // interval clears zero at around fifteen thousand.
    const edge = [0, 0, 0, 0, 0, 0, 0, 0, 0, 115_500];
    const fewer = { samples: 400 };

    expect(bootstrapRoi(runs(50, edge), fewer)!.verdict).toBe('undetermined');
    expect(bootstrapRoi(runs(5_000, edge), fewer)!.verdict).toBe('undetermined');
    expect(bootstrapRoi(runs(25_000, edge), { samples: 200 })!.verdict).toBe('winning');
  });
});

describe('roiConcentration', () => {
  it('is null when nothing has come back', () => {
    expect(roiConcentration([])).toBeNull();
    expect(roiConcentration([{ invested: 11_000, returned: 0 }])).toBeNull();
  });

  it('measures the biggest score against everything returned', () => {
    const result = roiConcentration([
      { invested: 11_000, returned: 0 },
      { invested: 11_000, returned: 20_000 },
      { invested: 11_000, returned: 60_000 },
    ])!;
    expect(result.topShare).toBeCloseTo(0.75, 5);
  });

  it('says what the same entries read without it', () => {
    const result = roiConcentration([
      { invested: 11_000, returned: 0 },
      { invested: 11_000, returned: 0 },
      { invested: 11_000, returned: 99_000 },
    ])!;
    expect(result.topShare).toBeCloseTo(1, 5);
    // Two entries, nothing back: minus everything.
    expect(result.roiWithoutTop).toBeCloseTo(-1, 5);
  });

  it('has nothing to remove when there is only one entry', () => {
    expect(roiConcentration([{ invested: 11_000, returned: 40_000 }])!.roiWithoutTop).toBeNull();
  });
});

describe('formatRoi', () => {
  it('signs a gain and not a loss', () => {
    expect(formatRoi(0.153)).toBe('+15%');
    expect(formatRoi(-0.08)).toBe('-8%');
    expect(formatRoi(0)).toBe('0%');
  });

  it('keeps the sign on a number that is only zero because it was rounded', () => {
    // An upper bound of -0.4% printed a bare "0%", so an interval the code had
    // just called losing read "between -12% and 0%" under a sentence asserting
    // the whole range sat below break even.
    expect(formatRoi(-0.004)).toBe('-0%');
    expect(formatRoi(0.004)).toBe('+0%');
    expect(formatRoi(0)).toBe('0%');
  });

  it('never prints a range that reads as straddling break even when it does not', () => {
    const losing = assessRoi(
      { roi: -0.06, lower: -0.12, upper: -0.004, level: 95, entries: 20, samples: 2_000, verdict: 'losing' },
      null,
      20,
    );
    expect(losing.headline).toContain('-0%');
    expect(losing.headline).not.toMatch(/and 0%/);
  });
});

describe('assessRoi', () => {
  const runs = (count: number, pattern: readonly number[]): EntryResult[] =>
    Array.from({ length: count }, (_, index) => ({
      invested: 11_000,
      returned: pattern[index % pattern.length],
    }));
  const BREAK_EVEN = [0, 0, 0, 22_000, 0, 0, 0, 0, 33_000, 55_000];

  const assess = (results: EntryResult[]) =>
    assessRoi(bootstrapRoi(results), roiConcentration(results), results.length);

  it('says how many more entries it needs when it cannot say anything', () => {
    const assessment = assess(runs(4, BREAK_EVEN));
    expect(assessment.verdict).toBe('insufficient_data');
    expect(assessment.body).toContain('Log 6 more');
  });

  it('names the range in the headline', () => {
    const assessment = assess(runs(40, BREAK_EVEN));
    expect(assessment.headline).toMatch(/^Somewhere between [-+]?\d+% and [-+]?\d+%$/);
  });

  it('explains a straddling range as a fact about tournaments', () => {
    const assessment = assess(runs(40, BREAK_EVEN));
    expect(assessment.verdict).toBe('undetermined');
    expect(assessment.body).toContain('fact about tournaments rather than about you');
  });

  it('calls a clear winner a signal rather than a good run', () => {
    const assessment = assess(runs(40, [15_000, 20_000, 12_000]));
    expect(assessment.verdict).toBe('winning');
    expect(assessment.body).toContain('real signal');
  });

  it('tells a losing player what the reading is of, without a verdict on them', () => {
    const assessment = assess(runs(30, [0]));
    expect(assessment.verdict).toBe('losing');
    expect(assessment.body).toContain('games you have actually been playing');
  });

  it('never tells the player they are broken or that anything is owed', () => {
    const samples = [
      runs(4, BREAK_EVEN),
      runs(40, BREAK_EVEN),
      runs(40, [15_000, 20_000, 12_000]),
      runs(30, [0]),
      runs(200, [0, 0, 0, 0, 0, 0, 0, 0, 0, 115_500]),
    ];
    for (const results of samples) {
      const { headline, body, concentrationNote } = assess(results);
      expect(`${headline} ${body} ${concentrationNote ?? ""}`).not.toMatch(
        /due|owed|deserve|broken|leak|tilting/i,
      );
    }
  });

  it('says out loud when one score is carrying the sample', () => {
    // Ten entries, one of them everything that came back.
    const carried = runs(20, [0, 0, 0, 0, 0, 0, 0, 0, 0, 220_000]);
    const note = assess(carried).concentrationNote;
    expect(note).toContain('of everything that has come back');
    expect(note).toContain('deep runs are where tournament money comes from');
  });

  it('stays quiet when the returns are spread across many cashes', () => {
    expect(assess(runs(40, [15_000, 20_000, 12_000])).concentrationNote).toBeNull();
  });
});
