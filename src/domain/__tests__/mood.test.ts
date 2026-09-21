/**
 * What tilt costs, and the far more important question of when to say nothing.
 *
 * Two halves. The first is ordinary: the right sessions go into the right
 * groups, and the ones that cannot be measured stay out. The second is the
 * reason this module needs a suite at all.
 *
 * A difference of means between two handfuls of poker sessions is almost always
 * noise, and a feature that reported one every time would be manufacturing
 * exactly the illusion `variance.ts` exists to argue against, with the app's own
 * authority behind it. So the last two describes simulate players whose mood has
 * *no effect whatsoever* and check how often this claims otherwise, and then
 * simulate a player where it plainly does and check it is not simply mute.
 * Calibration without power is a function that returns false.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeRandom } from '../random';
import { MOOD_SCALE, type MoodEntry, type MoodPhase, type MoodScore, type SessionWithChildren } from '../types';
import {
  MIN_HOURS_PER_GROUP,
  MIN_SESSIONS_PER_GROUP,
  RATTLED_SCORES,
  STEADY_SCORES,
  startMoodComparison,
  startMoodSpread,
  startScoreOf,
  toMoodObservations,
  wantsReset,
  worthActingOn,
} from '../mood';
import { Z_SCORES } from '../variance';
import { HOUR, STAKES_1_2, T0, completed, session } from './support';

const BUY_IN = 30_000;
const BIG_BLIND = STAKES_1_2.bigBlind;

/** A finished cash session returning exactly `resultBb` over `hours`. */
const played = (id: string, resultBb: number, hours: number, startedAt = T0) =>
  completed({
    id,
    hours,
    startedAt,
    buyIn: BUY_IN,
    cashOut: Math.round(BUY_IN + resultBb * BIG_BLIND),
  });

const mood = (
  sessionId: string,
  phase: MoodPhase,
  score: MoodScore,
  at = T0,
): MoodEntry => ({
  id: `${sessionId}-${phase}-${at}`,
  sessionId,
  phase,
  score,
  at,
  createdAt: at,
  updatedAt: at,
});

/**
 * A run of sessions all starting on the same mood, every one the same size.
 *
 * `spreadBb` alternates the result either side of the mean, leaving the group's
 * rate exactly what the caller asked for while giving it a within-group spread.
 * It defaults to none, which keeps the grouping tests reading as arithmetic,
 * but **any test about significance has to pass one**: with identical results
 * inside a group the only residuals are the gap between the groups, so the
 * estimated sigma collapses and everything looks significant. Two tests below
 * were written without it and asserted the opposite of what they got.
 */
const run = (
  prefix: string,
  { score, count, resultBb, hours, spreadBb = 0 }: {
    score: MoodScore;
    count: number;
    resultBb: number;
    hours: number;
    spreadBb?: number;
  },
): { sessions: SessionWithChildren[]; moods: MoodEntry[] } => {
  const sessions: SessionWithChildren[] = [];
  const moods: MoodEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `${prefix}-${index}`;
    const startedAt = T0 + index * 24 * HOUR;
    const swing = index % 2 === 0 ? spreadBb : -spreadBb;
    sessions.push(played(id, resultBb + swing, hours, startedAt));
    moods.push(mood(id, 'start', score, startedAt));
  }
  return { sessions, moods };
};

const merge = (...runs: { sessions: SessionWithChildren[]; moods: MoodEntry[] }[]) => ({
  sessions: runs.flatMap((r) => r.sessions),
  moods: runs.flatMap((r) => r.moods),
});

/* ------------------------------------------------------- which mood counts */

describe('the mood a session is grouped by', () => {
  it('is the one logged before it started', () => {
    const entries = [
      mood('s1', 'start', 1, T0),
      mood('s1', 'mid', 4, T0 + HOUR),
      mood('s1', 'end', 5, T0 + 2 * HOUR),
    ];
    expect(startScoreOf('s1', entries)).toBe(1);
  });

  it('and never the one logged after, because that is downstream of the result', () => {
    // The whole design. A player who loses four buy-ins reports feeling
    // terrible at the end of it, so grouping on the end score would mostly
    // measure "losing makes people feel bad": true, circular, and no use to
    // anybody deciding whether to sit down tonight.
    const calm = run('calm', { score: 1, count: 6, resultBb: -60, hours: 4 });
    // Every one of these ended tilted. None of it may move them out of steady.
    const ends = calm.sessions.map((s) => mood(s.id, 'end', 5, s.endedAt ?? T0));
    const observations = toMoodObservations(calm.sessions, [...calm.moods, ...ends]);

    expect(observations).toHaveLength(6);
    expect(observations.every((o) => o.startScore === 1)).toBe(true);
    expect(startMoodSpread(observations)[5]).toBe(0);
  });

  it('takes the earliest start entry when a correction was typed after it', () => {
    const entries = [
      mood('s1', 'start', 4, T0 + 5_000),
      mood('s1', 'start', 2, T0),
    ];
    expect(startScoreOf('s1', entries)).toBe(2);
  });

  it('is nothing when the session has none, and never another session’s', () => {
    expect(startScoreOf('s1', [])).toBeNull();
    expect(startScoreOf('s1', [mood('s2', 'start', 1)])).toBeNull();
    expect(startScoreOf('s1', [mood('s1', 'mid', 1)])).toBeNull();
  });
});

/* ------------------------------------------------------ which sessions count */

describe('which sessions count', () => {
  it('drops one with no start mood rather than guessing at it', () => {
    const sessions = [played('a', 10, 4), played('b', 10, 4)];
    const observations = toMoodObservations(sessions, [mood('a', 'start', 1)]);
    expect(observations.map((o) => o.sessionId)).toEqual(['a']);
  });

  it('inherits every exclusion the variance model already makes', () => {
    // Tournaments have no big blind to divide by; a cash session with no
    // recorded blinds has none either; a session with no duration has no rate.
    // None of that is re-litigated here, it is `toObservations`, and this is
    // the test that says so.
    const tournament = session({
      id: 't',
      format: 'tournament',
      hours: 4,
      cashOut: 50_000,
      buyIn: BUY_IN,
    });
    const noStakes = completed({ id: 'n', hours: 4, cashOut: 40_000, stakes: null });
    const instant = completed({ id: 'i', hours: 0, cashOut: 40_000 });
    const good = played('g', 10, 4);

    const moods = ['t', 'n', 'i', 'g'].map((id) => mood(id, 'start', 1));
    const observations = toMoodObservations([tournament, noStakes, instant, good], moods);
    expect(observations.map((o) => o.sessionId)).toEqual(['g']);
  });

  it('reads results in big blinds, so different stakes pool', () => {
    const observations = toMoodObservations([played('a', 25, 4)], [mood('a', 'start', 2)]);
    expect(observations[0].resultBb).toBeCloseTo(25, 6);
  });
});

/* ------------------------------------------------------------- the grouping */

describe('the two groups', () => {
  it('put 1 and 2 on the steady side and 4 and 5 on the rattled side', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 3, resultBb: 40, hours: 5 }),
      run('b', { score: 2, count: 3, resultBb: 40, hours: 5 }),
      run('c', { score: 4, count: 3, resultBb: -40, hours: 5 }),
      run('d', { score: 5, count: 3, resultBb: -40, hours: 5 }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.steady.sessions).toBe(6);
    expect(result.rattled.sessions).toBe(6);
    expect(result.steady.bbPerHour).toBeCloseTo(8, 6);
    expect(result.rattled.bbPerHour).toBeCloseTo(-8, 6);
  });

  it('leave 3 out of both, rather than blurring the contrast or counting twice', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 5, resultBb: 40, hours: 5 }),
      run('e', { score: 3, count: 20, resultBb: -500, hours: 5 }),
      run('c', { score: 5, count: 5, resultBb: -40, hours: 5 }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.steady.sessions).toBe(5);
    expect(result.rattled.sessions).toBe(5);
    // Twenty terrible Edgy sessions, and neither rate moves.
    expect(result.steady.bbPerHour).toBeCloseTo(8, 6);
    expect(result.rattled.bbPerHour).toBeCloseTo(-8, 6);
  });

  it('report the gap as rattled minus steady, so worse reads negative', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 8, resultBb: 100, hours: 5 }),
      run('c', { score: 5, count: 8, resultBb: -100, hours: 5 }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.differenceBbPerHour).toBeLessThan(0);
    expect(result.differenceBbPerHour).toBeCloseTo(-40, 6);
  });
});

/* --------------------------------------------------- when it will not speak */

describe('when it refuses to speak', () => {
  it('says so when there is nothing at all', () => {
    const result = startMoodComparison([], []);
    expect(result.settled).toBe(false);
    expect(result.blocker).toBe('no-data');
  });

  it('names the thin side when one group is short of sessions', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: MIN_SESSIONS_PER_GROUP - 1, resultBb: 100, hours: 10 }),
      run('c', { score: 5, count: 10, resultBb: -100, hours: 10 }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.settled).toBe(false);
    expect(result.blocker).toBe('thin-steady');
  });

  it('and when one group is short of hours despite having the sessions', () => {
    // Five sessions of one hour clears the session floor and not the hour one,
    // which is the case the hour floor exists for.
    const hours = (MIN_HOURS_PER_GROUP - 2) / MIN_SESSIONS_PER_GROUP;
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 10, resultBb: 100, hours: 10 }),
      run('c', { score: 5, count: MIN_SESSIONS_PER_GROUP, resultBb: -100, hours }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.rattled.sessions).toBeGreaterThanOrEqual(MIN_SESSIONS_PER_GROUP);
    expect(result.rattled.hours).toBeLessThan(MIN_HOURS_PER_GROUP);
    expect(result.blocker).toBe('thin-rattled');
  });

  it('still reports both groups while refusing, because the refusal is the answer', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 2, resultBb: 100, hours: 10 }),
      run('c', { score: 5, count: 10, resultBb: -100, hours: 10 }),
    );
    const result = startMoodComparison(sessions, moods);
    // A screen showing "not yet" should be able to show what it is short of.
    expect(result.steady.sessions).toBe(2);
    expect(result.rattled.sessions).toBe(10);
    expect(result.differenceBbPerHour).toBeNull();
  });
});

/* ---------------------------------------------------------- when it does */

describe('when it does speak', () => {
  const wide = () =>
    merge(
      run('a', { score: 1, count: 20, resultBb: 200, hours: 5 }),
      run('c', { score: 5, count: 20, resultBb: -200, hours: 5 }),
    );

  it('settles a gap that is far outside the noise', () => {
    const { sessions, moods } = wide();
    const result = startMoodComparison(sessions, moods);
    expect(result.settled).toBe(true);
    expect(result.blocker).toBeNull();
    expect(result.hoursNeeded).toBeNull();
    expect(result.pValue).toBeLessThan(0.1);
  });

  it('and carries the uncertainty rather than only the number', () => {
    const { sessions, moods } = wide();
    const result = startMoodComparison(sessions, moods);
    expect(result.standardError).toBeGreaterThan(0);
    expect(result.z).toBeCloseTo(
      (result.differenceBbPerHour ?? 0) / (result.standardError ?? 1),
      6,
    );
  });

  it('is harder to convince at 95 than at 90', () => {
    // Swept rather than asserted on one fixture, because picking a gap that
    // lands between the two bars by hand is guesswork and the first attempt at
    // it landed outside both. The property holds for every gap; the sweep also
    // proves the two bars are not the same bar.
    let onlyAtNinety = 0;
    for (let rattledBb = 60; rattledBb >= -220; rattledBb -= 10) {
      const { sessions, moods } = merge(
        run('a', { score: 1, count: 10, resultBb: 60, hours: 5, spreadBb: 200 }),
        run('c', { score: 5, count: 10, resultBb: rattledBb, hours: 5, spreadBb: 200 }),
      );
      const at90 = startMoodComparison(sessions, moods, 90).settled;
      const at95 = startMoodComparison(sessions, moods, 95).settled;
      if (at95) expect(at90).toBe(true);
      if (at90 && !at95) onlyAtNinety += 1;
    }
    expect(onlyAtNinety).toBeGreaterThan(0);
  });
});

/* ----------------------------------------------- how much more would settle it */

describe('what it says instead of a number', () => {
  it('offers the hours that would settle the gap it can see', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 30, resultBb: 60, hours: 5, spreadBb: 120 }),
      run('c', { score: 5, count: 5, resultBb: -10, hours: 3, spreadBb: 120 }),
    );
    const result = startMoodComparison(sessions, moods);
    if (result.settled) return; // the fixture is only useful while it is not
    expect(result.blocker).toBe('inside-the-noise');
    if (result.hoursNeeded !== null) expect(result.hoursNeeded).toBeGreaterThan(0);
  });

  it('offers hours to add, not the total to end up with', () => {
    // The number is rendered as "Another N hours or so on the thinner side", and
    // it was the total that side has to reach rather than what is left to play.
    // Always too big by exactly the hours already banked there, and worst right
    // at the bar, where the card finally has something useful to say: a player
    // one short session from an answer was told to log another ten.
    //
    // Checked against the definition rather than against a number: the standard
    // error with the thinner group grown by `hoursNeeded` has to put the gap
    // exactly on the bar.
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 30, resultBb: 60, hours: 4, spreadBb: 120 }),
      run('c', { score: 5, count: 10, resultBb: -10, hours: 4, spreadBb: 120 }),
    );
    const result = startMoodComparison(sessions, moods, 90);
    expect(result.settled).toBe(false);
    expect(result.hoursNeeded).not.toBeNull();

    const { steady, rattled, differenceBbPerHour, standardError, hoursNeeded } = result;
    const sigma =
      standardError! / Math.sqrt(1 / steady.hours + 1 / rattled.hours);
    const thinner = steady.hours <= rattled.hours ? steady : rattled;
    const other = thinner === steady ? rattled : steady;

    const grown = sigma * Math.sqrt(1 / other.hours + 1 / (thinner.hours + hoursNeeded!));
    expect(Math.abs(differenceBbPerHour!) / grown).toBeCloseTo(Z_SCORES[90], 6);

    // And it really is an addition: the hours the player has already put in on
    // that side are not being asked for a second time.
    const asTotal = sigma * Math.sqrt(1 / other.hours + 1 / hoursNeeded!);
    expect(Math.abs(differenceBbPerHour!) / asTotal).toBeLessThan(Z_SCORES[90]);
  });

  it('and offers nothing when no amount of the thin side would do it', () => {
    // The binding constraint is the *other* group: its own contribution to the
    // error already exceeds what the gap can absorb, so promising "another 40
    // hours" would be a promise the arithmetic cannot keep. A tiny gap against
    // a realistic spread is exactly that case.
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 6, resultBb: 30, hours: 2.5, spreadBb: 250 }),
      run('c', { score: 5, count: 6, resultBb: 25, hours: 2.5, spreadBb: 250 }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.settled).toBe(false);
    expect(result.hoursNeeded).toBeNull();
  });
});

/* ------------------------------------------------------------- calibration */

/** Standard normal draws from the seeded uniform, via Box-Muller. */
const normals = (seed: number) => {
  const random = makeRandom(seed);
  return (): number => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
};

/**
 * One simulated player. Mood is assigned at random and, unless `penaltyBbPerHour`
 * says otherwise, has no effect on anything.
 */
const simulate = (
  draw: () => number,
  { sessionsPerGroup, hours, sigma, penaltyBbPerHour }: {
    sessionsPerGroup: number;
    hours: number;
    sigma: number;
    penaltyBbPerHour: number;
  },
) => {
  const sessions: SessionWithChildren[] = [];
  const moods: MoodEntry[] = [];
  let index = 0;
  for (const [score, penalty] of [
    [1 as MoodScore, 0],
    [5 as MoodScore, penaltyBbPerHour],
  ] as const) {
    for (let n = 0; n < sessionsPerGroup; n += 1) {
      const id = `sim-${index}`;
      const startedAt = T0 + index * 24 * HOUR;
      const resultBb = penalty * hours + draw() * sigma * Math.sqrt(hours);
      sessions.push(played(id, resultBb, hours, startedAt));
      moods.push(mood(id, 'start', score, startedAt));
      index += 1;
    }
  }
  return startMoodComparison(sessions, moods);
};

describe('and it does not invent a finding out of noise', () => {
  const TRIALS = 300;
  const SPEC = { sessionsPerGroup: 12, hours: 4, sigma: 100 };

  it('claims a difference near the rate it is supposed to, on players who have none', () => {
    // Three hundred players whose mood changes nothing. At the 90 bar a
    // two-sided test should cry wolf about one time in ten, and this measures
    // 9.7%, which is close enough to nominal that the window can be a real
    // calibration check rather than a sanity bound. It is about three standard
    // errors either side of the measurement, so a changed seed will not trip it
    // and a module that started reporting half its players would.
    //
    // Sigma is estimated from the same twenty-four sessions rather than known,
    // which is the reason to expect any drift at all; there is evidently not
    // much of it at this size.
    const draw = normals(20260907);
    let settled = 0;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      if (simulate(draw, { ...SPEC, penaltyBbPerHour: 0 }).settled) settled += 1;
    }
    const rate = settled / TRIALS;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.16);
  });

  it('and is not simply mute, which would pass the test above perfectly', () => {
    // The same players, except arriving rattled really does cost 40bb/hour.
    // Calibration without power is `() => false`, so this is the half that
    // stops the module being that.
    const draw = normals(20260908);
    let settled = 0;
    for (let trial = 0; trial < TRIALS; trial += 1) {
      if (simulate(draw, { ...SPEC, penaltyBbPerHour: -40 }).settled) settled += 1;
    }
    expect(settled / TRIALS).toBeGreaterThan(0.5);
  });

  it('and points the right way when it does speak', () => {
    const draw = normals(20260909);
    const found = simulate(draw, { ...SPEC, sessionsPerGroup: 60, penaltyBbPerHour: -40 });
    expect(found.settled).toBe(true);
    expect(found.differenceBbPerHour).toBeLessThan(0);
    expect(found.differenceBbPerHour).toBeGreaterThan(-80);
  });
});

/* --------------------------------------------------- whether to say anything */

describe('whether a finding earns a nudge toward a reset', () => {
  const spread = 200;

  it('does when it is settled and points the wrong way', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 20, resultBb: 300, hours: 5, spreadBb: spread }),
      run('c', { score: 5, count: 20, resultBb: -300, hours: 5, spreadBb: spread }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.settled).toBe(true);
    expect(worthActingOn(result)).toBe(true);
  });

  it('does not when the gap is inside the noise, however suggestive it looks', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 6, resultBb: 60, hours: 3, spreadBb: 400 }),
      run('c', { score: 5, count: 6, resultBb: -60, hours: 3, spreadBb: 400 }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.settled).toBe(false);
    expect(result.differenceBbPerHour).toBeLessThan(0);
    // A real gap in the right direction and it still does not qualify. This is
    // the assertion that keeps the card from being an advertisement.
    expect(worthActingOn(result)).toBe(false);
  });

  it('does not when there is not enough to compare', () => {
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 2, resultBb: 300, hours: 5 }),
      run('c', { score: 5, count: 20, resultBb: -300, hours: 5 }),
    );
    expect(worthActingOn(startMoodComparison(sessions, moods))).toBe(false);
  });

  it('and does not when it settles the other way, which is still a real finding', () => {
    // Rattled sessions are this player's better ones. Reporting that is right;
    // selling them a reset on the back of it is not.
    const { sessions, moods } = merge(
      run('a', { score: 1, count: 20, resultBb: -300, hours: 5, spreadBb: spread }),
      run('c', { score: 5, count: 20, resultBb: 300, hours: 5, spreadBb: spread }),
    );
    const result = startMoodComparison(sessions, moods);
    expect(result.settled).toBe(true);
    expect(result.differenceBbPerHour).toBeGreaterThan(0);
    expect(worthActingOn(result)).toBe(false);
  });

  it('never on an empty history', () => {
    expect(worthActingOn(startMoodComparison([], []))).toBe(false);
  });
});

describe('the card that shows it', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'features', 'sessions', 'MoodCost.tsx'),
    'utf8',
  );

  it('reaches the hand-off through that one gate and no other way', () => {
    // Source-read rather than rendered, the same way `endpoint.test.ts` reads
    // the file it cannot run: this repository has no component renderer. What
    // it pins is the property that matters, which is that no branch of the copy
    // can reach `untiltHandOff` on its own.
    expect(source).toContain('const offerUntilt = worthActingOn(comparison);');
    const gate = source.indexOf('const offerUntilt');
    expect(gate).toBeGreaterThan(-1);
    expect(source.slice(0, gate)).not.toMatch(/untiltHandOff\(/);
    expect(source.slice(gate)).toMatch(/untiltHandOff\(/);
  });

  it('and says what the grouping is in every state', () => {
    // The number is about the mood somebody arrived in. A reader who assumes it
    // is about how the session felt has been misled by omission, so the basis
    // line is not optional per branch.
    const branches = source.split('return (').length - 1;
    expect(source.match(/<Basis \/>/g) ?? []).toHaveLength(branches - 1);
  });
});

describe('whether a mid-session tap is worth offering a reset for', () => {
  it('is the two scores the comparison also calls rattled', () => {
    // One definition, reused rather than restated. A player who would land in
    // that group at the end of the month is the one worth offering something to
    // tonight, and two definitions of rattled in one app is one too many.
    expect(RATTLED_SCORES.map(wantsReset)).toEqual([true, true]);
    expect(STEADY_SCORES.map(wantsReset)).toEqual([false, false]);
  });

  it('and never the middle of the scale, which is most sessions', () => {
    // 3 is Edgy, the honest answer for a normal night. Offering something there
    // would make the check-in cost the player an interruption most times they
    // answered it honestly, which is how a check-in stops being answered.
    expect(wantsReset(3)).toBe(false);
  });

  it('covers the whole scale between them, so no score falls through', () => {
    expect(MOOD_SCALE.filter(wantsReset)).toEqual([...RATTLED_SCORES]);
  });
});
