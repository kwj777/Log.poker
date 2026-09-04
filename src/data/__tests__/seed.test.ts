/**
 * The demo dataset is a product surface -- it is the first thing a new user sees
 * with the dev flag on, and the fixture every screenshot is taken against. These
 * assert it stays coherent and stays useful.
 */

import { estimatePlayer, toObservations } from '../../domain/variance';
import { bankrollCurve, totals } from '../../domain/stats';
import {
  MIN_ENTRIES_FOR_INTERVAL,
  bootstrapRoi,
  toEntryResults,
  tournamentTotals,
} from '../../domain/tournaments';
import { DEMO_SESSION_COUNT, DEMO_TOURNAMENT_COUNT, seedDemoData } from '../seed';
import { SqlRepository } from '../sql/SqlRepository';
import type { Repository } from '../repository';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

const NOW = 1_700_000_000_000;

describe('demo dataset', () => {
  let repository: Repository;
  let driver: NodeSqliteDriver;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    repository = new SqlRepository(driver);
    await repository.init();
    await seedDemoData(repository, { now: NOW });
  });

  afterEach(async () => {
    await driver.close();
  });

  it('seeds every planned session across four venues, all finished', async () => {
    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(DEMO_SESSION_COUNT);
    expect(DEMO_SESSION_COUNT).toBe(32);
    expect(sessions.every((session) => session.endedAt !== null)).toBe(true);
    expect(await repository.listVenues()).toHaveLength(4);
  });

  it('seeds both formats, so every screen has something to show', async () => {
    const sessions = await repository.listSessions();
    const tournaments = sessions.filter((session) => session.format === 'tournament');
    expect(tournaments).toHaveLength(DEMO_TOURNAMENT_COUNT);
    expect(DEMO_TOURNAMENT_COUNT).toBe(12);
    expect(sessions.filter((session) => session.format === 'cash')).toHaveLength(20);
  });

  it('gives tournaments the shape tournaments actually have', async () => {
    const result = tournamentTotals(await repository.listSessions());
    // Mostly losses, carried by one deep run: the shape the copy describes.
    expect(result.cashes).toBe(3);
    expect(result.entries).toBe(12);
    expect(result.net).toBeGreaterThan(0);
    expect(result.bestFinish).toBe(3);
    expect(result.fees).toBeGreaterThan(0);
  });

  it('has enough tournaments for the ROI range to draw, which is the point of it', async () => {
    // The demo is the fixture every screenshot is taken against. A tournament
    // count below the interval's floor would leave that card reading "not
    // enough entries" forever, and the feature invisible in the demo.
    const sessions = await repository.listSessions();
    const results = toEntryResults(sessions);
    expect(results.length).toBeGreaterThanOrEqual(MIN_ENTRIES_FOR_INTERVAL);

    const interval = bootstrapRoi(results);
    expect(interval).not.toBeNull();
    // Twelve entries carried by one score: the range is enormous and straddles
    // break even, which is the honest answer and the one the copy is about.
    expect(interval!.verdict).toBe('undetermined');
    expect(interval!.upper - interval!.lower).toBeGreaterThan(1);
  });

  it('keeps tournaments out of the cash-game variance estimate', async () => {
    const sessions = await repository.listSessions();
    const observed = toObservations(sessions);
    expect(observed).toHaveLength(20);
    expect(
      observed.every((observation) =>
        sessions.some(
          (session) => session.id === observation.sessionId && session.format === 'cash',
        ),
      ),
    ).toBe(true);
  });

  it('leaves no session running, so the app opens on the dashboard', async () => {
    expect(await repository.getActiveSession()).toBeNull();
  });

  it('produces a mix of winning and losing sessions', async () => {
    const result = totals(await repository.listSessions());
    expect(result.winningSessions).toBeGreaterThanOrEqual(8);
    expect(result.losingSessions).toBeGreaterThanOrEqual(6);
  });

  it('nets out to a modest winner rather than a fantasy', async () => {
    const result = totals(await repository.listSessions());
    expect(result.net).toBeGreaterThan(0);
    // A believable live win rate: comfortably under $100/hr at these stakes.
    expect(result.hourly).toBeLessThan(10_000);
  });

  it('records enough hours for the variance view to be meaningful', async () => {
    const sessions = await repository.listSessions();
    const estimate = estimatePlayer(toObservations(sessions));
    expect(estimate.reliable).toBe(true);
    expect(estimate.stdDevBbPerHour).toBeGreaterThan(0);
  });

  it('derives cash-outs so every session’s math ties out to its plan', async () => {
    const sessions = await repository.listSessions();
    for (const session of sessions) {
      const invested = session.buyIn + session.rebuys.reduce((sum, r) => sum + r.amount, 0);
      expect(session.cashOut).not.toBeNull();
      expect(session.cashOut).toBeGreaterThanOrEqual(0);
      expect(invested).toBeGreaterThan(0);
    }
  });

  it('spreads sessions over a couple of months ending near now', async () => {
    const curve = bankrollCurve(await repository.listSessions());
    expect(curve).toHaveLength(DEMO_SESSION_COUNT);
    expect(curve[curve.length - 1].at).toBeLessThanOrEqual(NOW);
    const spanDays = (curve[curve.length - 1].at - curve[0].at) / 86_400_000;
    expect(spanDays).toBeGreaterThan(45);
    expect(spanDays).toBeLessThan(90);
  });

  it('logs hands with valid notation and mood entries on every session', async () => {
    const hands = await repository.listHands();
    expect(hands.length).toBeGreaterThanOrEqual(DEMO_SESSION_COUNT);
    expect(hands.every((hand) => hand.holeCards !== null && hand.tags.length > 0)).toBe(true);

    const moods = await repository.listMoodEntries();
    const sessionsWithStart = new Set(
      moods.filter((mood) => mood.phase === 'start').map((mood) => mood.sessionId),
    );
    expect(sessionsWithStart.size).toBe(DEMO_SESSION_COUNT);
  });

  it('is deterministic for a given seed and different for another', async () => {
    const first = (await repository.listHands()).map((hand) => hand.holeCards).join(',');

    await seedDemoData(repository, { now: NOW });
    const repeated = (await repository.listHands()).map((hand) => hand.holeCards).join(',');
    expect(repeated).toBe(first);

    await seedDemoData(repository, { now: NOW, seed: 999 });
    const different = (await repository.listHands()).map((hand) => hand.holeCards).join(',');
    expect(different).not.toBe(first);
  });

  it('clears previous data rather than stacking a second copy', async () => {
    await seedDemoData(repository, { now: NOW });
    expect(await repository.listSessions()).toHaveLength(DEMO_SESSION_COUNT);
    expect(await repository.listVenues()).toHaveLength(4);
  });
});
