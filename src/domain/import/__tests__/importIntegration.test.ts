/**
 * Parse a file, write it, read it back -- the whole import path against a real
 * SQLite engine.
 *
 * The unit tests either side of this one prove the parser reads a file and the
 * repository stores a session. This proves the two fit together, and in
 * particular that running the same export twice does not double a bankroll,
 * which is the one failure mode a player would not notice until it had
 * compounded for months.
 */

import { SqlRepository } from '../../../data/sql/SqlRepository';
import { NodeSqliteDriver } from '../../../data/__tests__/support/nodeSqliteDriver';
import type { Repository } from '../../../data/repository';
import { netResult, totalInvested } from '../../stats';
import { toObservations } from '../../variance';
import { planImport, venueNameKey } from '../plan';
import { parseSessionCsv, type ImportedSession } from '../sessionImport';

const CSV = [
  'Date,Site,Game,Limit,Total Buyin,Total Cashout,Duration',
  '2024-01-15 20:00,PokerStars,"Hold\'em No Limit",$0.25/$0.50,$50.00,$88.25,3:30',
  '2024-01-16 21:15,PokerStars,"Hold\'em No Limit",$0.25/$0.50,$50.00,$12.00,2:00',
  '2024-01-17 19:00,GGPoker,PLO,$1/$2,$200.00,$310.00,4:00',
].join('\n');

/** The store's write path, minus Zustand: plan, create venues, create sessions. */
const applyImport = async (
  repository: Repository,
  sessions: readonly ImportedSession[],
): Promise<number> => {
  const venues = await repository.listVenues();
  const plan = planImport(
    sessions,
    new Set(await repository.listImportKeys()),
    venues.map((venue) => venue.name),
  );
  if (plan.writes.length === 0) return 0;

  const byName = new Map(venues.map((venue) => [venueNameKey(venue.name), venue.id]));
  for (const name of plan.venuesToCreate) {
    const venue = await repository.createVenue({ name, isHomeGame: false });
    byName.set(venueNameKey(venue.name), venue.id);
  }

  await repository.createSessions(
    plan.writes.map((session) => ({
      ...session.draft,
      venueId: byName.get(venueNameKey(session.venueName)) as string,
      importKey: session.importKey,
    })),
  );
  return plan.writes.length;
};

describe('importing a session summary end to end', () => {
  let driver: NodeSqliteDriver;
  let repository: Repository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    repository = new SqlRepository(driver);
    await repository.init();
  });

  afterEach(async () => {
    await driver.close();
  });

  it('writes every session in the file', async () => {
    expect(await applyImport(repository, parseSessionCsv(CSV).sessions)).toBe(3);
    expect(await repository.listSessions()).toHaveLength(3);
  });

  it('creates one venue per site named', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    const venues = await repository.listVenues();
    expect(venues.map((venue) => venue.name).sort()).toEqual(['GGPoker', 'PokerStars']);
    expect(venues.every((venue) => !venue.isHomeGame)).toBe(true);
  });

  it('lands the money where the dashboard reads it', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    const sessions = await repository.listSessions();
    const net = sessions.reduce(
      (sum, session) => sum + (netResult(session, session.rebuys) ?? 0),
      0,
    );
    // 38.25 − 38.00 + 110.00
    expect(net).toBe(11_025);
    expect(totalInvested(sessions[0], sessions[0].rebuys)).toBe(20_000);
  });

  it('leaves no session looking live, so the app still has one active slot', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    expect(await repository.getActiveSession()).toBeNull();
  });

  it('reaches the variance model with hours and big blinds intact', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    const observations = toObservations(await repository.listSessions());
    expect(observations).toHaveLength(3);
    expect(observations[0].hours).toBeCloseTo(3.5, 5);
    expect(observations[0].resultBb).toBeCloseTo(3825 / 50, 5);
  });

  it('adds nothing on a second run of the same file', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    expect(await applyImport(repository, parseSessionCsv(CSV).sessions)).toBe(0);
    expect(await repository.listSessions()).toHaveLength(3);
    expect(await repository.listVenues()).toHaveLength(2);
  });

  it('adds only the new rows when the export grows', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    const extended = `${CSV}\n2024-01-18 20:00,PokerStars,"Hold'em No Limit",$0.25/$0.50,$50.00,$95.00,3:00`;
    expect(await applyImport(repository, parseSessionCsv(extended).sessions)).toBe(1);
    expect(await repository.listSessions()).toHaveLength(4);
  });

  it('imports a row again once the session it made has been deleted', async () => {
    await applyImport(repository, parseSessionCsv(CSV).sessions);
    const [newest] = await repository.listSessions();
    await repository.deleteSession(newest.id);
    expect(await applyImport(repository, parseSessionCsv(CSV).sessions)).toBe(1);
    expect(await repository.listSessions()).toHaveLength(3);
  });

  it('imports a result-only file into the same bankroll', async () => {
    await applyImport(repository, parseSessionCsv('Date,Result\n2024-02-01,250\n').sessions);
    const [session] = await repository.listSessions();
    expect(netResult(session, session.rebuys)).toBe(25_000);
    expect(session.venue?.name).toBe('Online');
    // No stakes and no duration, so it stays out of the win-rate estimate.
    expect(toObservations([session])).toEqual([]);
  });
});
