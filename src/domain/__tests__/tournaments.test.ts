import {
  MIN_TOURNAMENTS_FOR_ROI,
  assessTournaments,
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

  it('refuses to call a small sample an ROI', () => {
    const assessment = assessTournaments(tournamentTotals(many(10, 4)));
    expect(assessment.roiIsMeaningful).toBe(false);
    expect(assessment.body).toContain('not yet a number about you');
  });

  it('allows the ROI to mean something once the sample is large', () => {
    const totals = tournamentTotals(many(MIN_TOURNAMENTS_FOR_ROI, 4));
    expect(assessTournaments(totals).roiIsMeaningful).toBe(true);
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
