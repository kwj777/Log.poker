/**
 * The export, read back by the importer that ships beside it.
 *
 * This is the claim worth testing and the reason the headers are the ones the
 * importer already knows: a file Log writes is a file Log can read. It makes
 * the export a backup rather than a printout, and it means moving a log
 * between two devices without signing in is a file rather than a retype.
 *
 * Nothing here checks a column list against a column list. The rows go through
 * `toCsv` and come back through `parseSessionCsv`, both of them the real ones,
 * and what is compared is the session that went in against the draft that came
 * out.
 */

import { resolveColumns } from '../../import/columns';
import { parseSessionCsv } from '../../import/sessionImport';
import { toCsv } from '../csv';
import {
  SESSION_HEADERS,
  exportFileName,
  handRows,
  sessionRows,
} from '../sessionExport';
import type { Hand, SessionWithChildren } from '../../types';

const T0 = Date.UTC(2026, 2, 14, 19, 30);
const HOUR = 3_600_000;

const session = (over: Partial<SessionWithChildren> = {}): SessionWithChildren => ({
  id: 's1',
  venueId: 'v1',
  format: 'cash',
  gameType: 'NLHE',
  stakes: { smallBlind: 100, bigBlind: 200 },
  currency: 'USD',
  buyIn: 30_000,
  fee: null,
  cashOut: 45_000,
  entrants: null,
  finishPosition: null,
  startedAt: T0,
  endedAt: T0 + 4 * HOUR,
  notes: null,
  importKey: null,
  createdAt: T0,
  updatedAt: T0,
  rebuys: [],
  venue: { id: 'v1', name: 'Aria', isHomeGame: false, sessionCount: 1, createdAt: T0, updatedAt: T0 },
  ...over,
});

/**
 * Export, then import, both through the code that ships.
 *
 * No date-order option, and it would make no difference if there were: the
 * export writes the year first, and `parseTimestamp` reads a four-digit
 * leading component as a year without consulting the order at all. That is the
 * reason to write ISO rather than something prettier -- see the test below.
 */
const roundTrip = (sessions: SessionWithChildren[]) =>
  parseSessionCsv(toCsv(SESSION_HEADERS, sessionRows(sessions)));

describe('the headers the export writes', () => {
  const resolved = resolveColumns([...SESSION_HEADERS]);

  it('are every one of them a header the importer knows', () => {
    expect(resolved.unmapped).toEqual([]);
  });

  it('and none of them is quietly dropped for clashing with another', () => {
    // This is the one that earned its keep. `Finish` reads like a finishing
    // position and is an alias of `endedAt` in this importer, so a column
    // called that was thrown away as a duplicate of `Ended` -- no error, no
    // warning a person would see, just a tournament that came back without
    // knowing where it placed.
    expect(resolved.duplicates).toEqual([]);
  });

  it('and between them carry every field a session can fill', () => {
    const carried = Object.keys(resolved.matched).sort();
    expect(carried).toEqual(
      [
        'buyIn', 'cashOut', 'currency', 'endedAt', 'entrants', 'fee',
        'finishPosition', 'format', 'gameType', 'notes', 'stakes', 'startedAt',
        'venue',
      ].sort(),
    );
  });
});

describe('a log written out and read back', () => {
  it('comes back as the sessions that went in', () => {
    const back = roundTrip([session()]);
    expect(back.error).toBeNull();
    expect(back.sessions).toHaveLength(1);
    expect(back.sessions[0].draft).toMatchObject({
      format: 'cash',
      gameType: 'NLHE',
      currency: 'USD',
      buyIn: 30_000,
      cashOut: 45_000,
      stakes: { smallBlind: 100, bigBlind: 200 },
    });
    expect(back.sessions[0].venueName).toBe('Aria');
  });

  it('keeps the clock, to the minute it was played at', () => {
    const back = roundTrip([session()]);
    const draft = back.sessions[0].draft;
    expect(new Date(draft.startedAt).getHours()).toBe(new Date(T0).getHours());
    expect(draft.endedAt - draft.startedAt).toBe(4 * HOUR);
  });

  it('keeps an ante, which lives inside the stakes cell', () => {
    const back = roundTrip([
      session({ stakes: { smallBlind: 200, bigBlind: 500, ante: 500 } }),
    ]);
    expect(back.sessions[0].draft.stakes).toEqual({
      smallBlind: 200,
      bigBlind: 500,
      ante: 500,
    });
  });

  it('keeps a tournament whole, fee and finish and all', () => {
    const back = roundTrip([
      session({
        format: 'tournament',
        stakes: null,
        buyIn: 10_000,
        fee: 1_000,
        cashOut: 85_000,
        entrants: 143,
        finishPosition: 3,
      }),
    ]);
    expect(back.sessions[0].draft).toMatchObject({
      format: 'tournament',
      buyIn: 10_000,
      fee: 1_000,
      cashOut: 85_000,
      entrants: 143,
      finishPosition: 3,
      stakes: null,
    });
  });

  it('survives a note with a comma, a quote and a newline in it', () => {
    const notes = 'Ran into aces, again.\nHe said "nice hand"; I did not agree.';
    const back = roundTrip([session({ notes })]);
    expect(back.sessions[0].draft.notes).toBe(notes);
  });

  it('survives a venue with a comma in its name', () => {
    const back = roundTrip([session({ venue: { ...session().venue!, name: 'Bellagio, room 2' } })]);
    expect(back.sessions[0].venueName).toBe('Bellagio, room 2');
  });

  it('folds the rebuys into the buy-in, so the money is right', () => {
    // The importer has no rebuy column. A session that cost 500 must not read
    // back as one that cost 300, whatever is lost about when each went in.
    const back = roundTrip([
      session({
        buyIn: 30_000,
        rebuys: [
          { id: 'r1', sessionId: 's1', amount: 10_000, at: T0 + HOUR, createdAt: T0, updatedAt: T0 },
          { id: 'r2', sessionId: 's1', amount: 10_000, at: T0 + 2 * HOUR, createdAt: T0, updatedAt: T0 },
        ],
      }),
    ]);
    expect(back.sessions[0].draft.buyIn).toBe(50_000);
  });

  it('writes oldest first, whatever order it was handed', () => {
    const back = roundTrip([
      session({ id: 'b', startedAt: T0 + 48 * HOUR, endedAt: T0 + 50 * HOUR }),
      session({ id: 'a', startedAt: T0, endedAt: T0 + HOUR }),
    ]);
    const [first, second] = back.sessions;
    expect(first.draft.startedAt).toBeLessThan(second.draft.startedAt);
  });

  it('writes a header and no rows for a log with nothing in it', () => {
    const text = toCsv(SESSION_HEADERS, sessionRows([]));
    expect(text.trim().split('\r\n')).toHaveLength(1);
    // The importer refuses that file, and is right to: a header with nothing
    // under it is what a broken export looks like. Which is why the screen does
    // not offer to write one -- see `app/(tabs)/settings.tsx`.
    expect(parseSessionCsv(text).error).toBe(
      'That file has a header row but no sessions under it.',
    );
  });

  it('reads the same whichever way round the reader thinks dates go', () => {
    // The failure this rules out is a session played in March coming back in
    // February, silently, because the file was opened by somebody whose
    // spreadsheet is set to the other convention. Year first has no second
    // reading.
    const text = toCsv(SESSION_HEADERS, sessionRows([session()]));
    const dmy = parseSessionCsv(text, { dateOrder: 'dmy' });
    const mdy = parseSessionCsv(text, { dateOrder: 'mdy' });
    expect(dmy.sessions[0].draft.startedAt).toBe(mdy.sessions[0].draft.startedAt);
    expect(new Date(mdy.sessions[0].draft.startedAt).getMonth()).toBe(2);
  });

  it('numbers the money rather than dressing it, so a column sums', () => {
    const row = sessionRows([session()])[0];
    expect(row).toContain('300.00');
    expect(row.join(',')).not.toContain('$');
  });
});

describe('the hands, which are notes rather than a hand history', () => {
  const hand = (over: Partial<Hand> = {}): Hand => ({
    id: 'h1',
    sessionId: 's1',
    holeCards: 'AsKd',
    board: null,
    position: 'BTN',
    note: null,
    tags: [],
    amount: null,
    at: T0 + HOUR,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  });

  it('carries the cards, the runout, the seat, the tags and the line that was typed', () => {
    const rows = handRows(
      [
        hand({
          board: '7c2sKh',
          tags: ['cooler', 'misplayed'],
          note: 'Ran into aces',
          amount: -25_000,
        }),
      ],
      [session()],
    );
    expect(rows[0]).toEqual([
      expect.stringContaining('2026-03-14'),
      expect.stringContaining('2026-03-14'),
      'Aria',
      'AsKd',
      '7c2sKh',
      'BTN',
      'cooler misplayed',
      '-250.00',
      'USD',
      'Ran into aces',
    ]);
  });

  it('leaves the board cell empty on a hand logged without one, which is most', () => {
    const rows = handRows([hand({ board: null })], [session()]);
    expect(rows[0][4]).toBe('');
  });

  it('writes the board in the same notation as the cards', () => {
    // One format, so anything that reads a Log hand reads a Log board.
    const rows = handRows([hand({ holeCards: 'AsKd', board: '7c2sKhAd9d' })], [session()]);
    expect(rows[0][3]).toBe('AsKd');
    expect(rows[0][4]).toBe('7c2sKhAd9d');
  });

  it('names the session by when it started rather than by an id nobody can read', () => {
    const rows = handRows([hand()], [session()]);
    expect(rows[0][1]).not.toContain('s1');
  });

  it('still writes a hand whose session is gone', () => {
    const rows = handRows([hand({ sessionId: 'missing' })], [session()]);
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe('');
  });

  it('writes oldest first', () => {
    const rows = handRows(
      [hand({ id: 'late', at: T0 + 5 * HOUR }), hand({ id: 'early', at: T0 })],
      [session()],
    );
    expect(rows[0][0] < rows[1][0]).toBe(true);
  });
});

describe('what the file is called', () => {
  it('says what it holds and when it was taken', () => {
    expect(exportFileName('sessions', Date.UTC(2026, 2, 14, 12))).toBe(
      'log-sessions-2026-03-14.csv',
    );
    expect(exportFileName('hands', Date.UTC(2026, 11, 1, 12))).toBe('log-hands-2026-12-01.csv');
  });

  it('pads the month and the day, so the names sort', () => {
    const names = [
      exportFileName('sessions', Date.UTC(2026, 10, 2, 12)),
      exportFileName('sessions', Date.UTC(2026, 1, 20, 12)),
    ].sort();
    expect(names[0]).toContain('2026-02-20');
  });
});
