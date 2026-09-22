/**
 * Parse a file, write it, read it back -- the whole import path against a real
 * SQLite engine.
 *
 * The unit tests either side of this one prove the parser reads a file and the
 * repository stores a session. This proves the two fit together, and in
 * particular that running the same export twice does not double a bankroll,
 * which is the one failure mode a player would not notice until it had
 * compounded for months.
 *
 * ## It drives the store rather than a copy of it
 *
 * This used to call a local `applyImport` that did what the store does --
 * plan, create the venues, create the sessions -- under a comment saying so.
 * A test that reimplements the code it covers passes whatever the code does,
 * and the two had already parted company: the store wraps the writes in a
 * `try` and deletes the venues it invented when the session batch fails, so a
 * file that cannot land does not leave rooms in the picker for sessions that
 * never arrived. The copy had no such thing, and `importSessions` had no test
 * anywhere.
 *
 * So the repository goes in behind `getRepository` and the store's own action
 * is what runs. The last case here is the one the copy could never have
 * reached.
 */

import { SqlRepository } from '../../../data/sql/SqlRepository';
import { NodeSqliteDriver } from '../../../data/__tests__/support/nodeSqliteDriver';
import type { Repository } from '../../../data/repository';
import { netResult, totalInvested } from '../../stats';
import { toObservations } from '../../variance';
import { parseSessionCsv, type ImportedSession } from '../sessionImport';
import { SESSION_HEADERS, sessionRows } from '../../export/sessionExport';
import { session } from '../../__tests__/support';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What `getRepository` hands back, swapped per test. */
const live: { repository: Repository | null } = { repository: null };

jest.mock('../../../data', () => ({
  getRepository: async () => live.repository as Repository,
  onSyncApplied: () => () => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useLogStore } = require('../../../store/useLogStore') as typeof import('../../../store/useLogStore');

const CSV = [
  'Date,Site,Game,Limit,Total Buyin,Total Cashout,Duration',
  '2024-01-15 20:00,PokerStars,"Hold\'em No Limit",$0.25/$0.50,$50.00,$88.25,3:30',
  '2024-01-16 21:15,PokerStars,"Hold\'em No Limit",$0.25/$0.50,$50.00,$12.00,2:00',
  '2024-01-17 19:00,GGPoker,PLO,$1/$2,$200.00,$310.00,4:00',
].join('\n');

/** The shipping write path: the store's own action, over the repository below. */
const applyImport = async (
  _repository: Repository,
  sessions: readonly ImportedSession[],
): Promise<number> => (await useLogStore.getState().importSessions(sessions)).imported;

describe('importing a session summary end to end', () => {
  let driver: NodeSqliteDriver;
  let repository: Repository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(':memory:');
    repository = new SqlRepository(driver);
    await repository.init();
    live.repository = repository;
    useLogStore.setState({ status: 'ready', sessions: [], venues: [], moodEntries: [] });
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

  it('reports the rooms it invented, which is what the screen tells the player', async () => {
    const answer = await useLogStore.getState().importSessions(parseSessionCsv(CSV).sessions);
    expect(answer.imported).toBe(3);
    expect(answer.duplicates).toBe(0);
    expect([...answer.venuesCreated].sort()).toEqual(['GGPoker', 'PokerStars']);
  });

  it('takes back the rooms it invented when the sessions do not land', async () => {
    // The venues cannot go in the same all-or-nothing batch as the sessions,
    // because creating one is its own write. So the store catches and deletes
    // them, and without that a file that failed to import left rooms in the
    // picker for sessions that never arrived -- on the screen where a venue is
    // picked from a list, for a room the player has never played in.
    const room = 'PokerStars';
    live.repository = new Proxy(repository, {
      get: (target, key, receiver) =>
        key === 'createSessions'
          ? async () => {
              throw new Error('The database is full.');
            }
          : Reflect.get(target, key, receiver),
    }) as Repository;

    await expect(
      useLogStore.getState().importSessions(parseSessionCsv(CSV).sessions),
    ).rejects.toThrow('The database is full.');

    live.repository = repository;
    expect(await repository.listVenues()).toEqual([]);
    expect(await repository.listSessions()).toEqual([]);
    // And the keys are free, so the same file imports cleanly on the next try.
    expect(await repository.listImportKeys()).toEqual([]);
    expect(await applyImport(repository, parseSessionCsv(CSV).sessions)).toBe(3);
    expect((await repository.listVenues()).map((venue) => venue.name)).toContain(room);
  });
});

describe('the round trip the export card sells as a backup', () => {
  /**
   * "Import it here and every finished session lands as the session it came
   * from, which makes it a backup as well as a record."
   *
   * There are two kinds of row that do not come back, not one. A night still
   * in progress is the one the copy named. The other is a session the merge
   * closed: when two devices both had one running, `settleActiveSessions`
   * writes `endedAt` and leaves `cashOut` null on purpose, so the session
   * "stays out of every total until the player says what came off the table".
   *
   * That row exports with an end time filled in and a blank cash-out, which
   * looks finished in the file, and the importer passes over it -- so on a
   * restore it is gone, and it is precisely the session the app wanted the
   * player to come back and fix.
   */
  const write = (rows: string[][]) =>
    [SESSION_HEADERS, ...rows].map((row) => row.join(',')).join('\n') + '\n';

  const needsACashOut = session({
    startedAt: new Date(2026, 2, 1, 19).getTime(),
    endedAt: new Date(2026, 2, 1, 23).getTime(),
    cashOut: null,
  });

  it('writes a session the merge closed, and reads none back', async () => {
    const csv = write(sessionRows([needsACashOut]));
    // It looks finished in the file: an end time, and no result.
    expect(csv).toMatch(/2026-03-01 23:00/);

    const read = parseSessionCsv(csv);
    expect(read.sessions).toHaveLength(0);
    expect(read.skipped).toBe(1);
  });

  it('and the export card says so rather than naming one kind of row', async () => {
    // The sentence a player reads before they trust this as a backup. It said
    // a night in progress was "the one row an import will pass over".
    // Whitespace flattened, because JSX wraps the sentence across lines.
    const settings = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'app', '(tabs)', 'settings.tsx'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(settings).not.toMatch(/the one row an import will pass over/);
    expect(settings).toMatch(/two devices both had running/);
  });
});

