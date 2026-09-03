import { DEFAULT_VENUE_NAME, parseSessionCsv } from '../sessionImport';

const local = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

const HOUR = 3_600_000;

const messages = (result: ReturnType<typeof parseSessionCsv>): string =>
  result.warnings.map((warning) => warning.message).join(' | ');

describe('parseSessionCsv', () => {
  describe('a tracker export with everything in it', () => {
    const csv = [
      'Date,Site,Game,Limit,Total Buyin,Total Cashout,Duration,Notes',
      '2024-01-15 20:00,PokerStars,"Hold\'em No Limit",$0.25/$0.50,$50.00,$88.25,3:30,Good table',
      '2024-01-16 21:15,PokerStars,"Hold\'em No Limit",$0.25/$0.50,$50.00,$12.00,2:00,',
    ].join('\n');

    it('reads every session', () => {
      const result = parseSessionCsv(csv);
      expect(result.error).toBeNull();
      expect(result.sessions).toHaveLength(2);
      expect(result.skipped).toBe(0);
    });

    it('maps the columns onto the domain model', () => {
      const [first] = parseSessionCsv(csv).sessions;
      expect(first.venueName).toBe('PokerStars');
      expect(first.draft).toEqual({
        gameType: 'NLHE',
        stakes: { smallBlind: 25, bigBlind: 50, currency: 'USD' },
        buyIn: 5000,
        cashOut: 8825,
        startedAt: local(2024, 1, 15, 20, 0),
        endedAt: local(2024, 1, 15, 20, 0) + 3.5 * HOUR,
        notes: 'Good table',
      });
    });

    it('leaves an empty note null rather than an empty string', () => {
      expect(parseSessionCsv(csv).sessions[1].draft.notes).toBeNull();
    });

    it('has nothing to warn about', () => {
      expect(parseSessionCsv(csv).warnings).toEqual([]);
    });
  });

  describe('a file with only a date and a result', () => {
    const csv = 'Date,Result\n2024-01-15,120\n2024-01-16,-40.50\n';

    it('turns a winning result into a cash-out against a zero buy-in', () => {
      const [first] = parseSessionCsv(csv).sessions;
      expect(first.draft.buyIn).toBe(0);
      expect(first.draft.cashOut).toBe(12_000);
    });

    it('books a loss as the buy-in rather than a negative cash-out', () => {
      const [, second] = parseSessionCsv(csv).sessions;
      expect(second.draft.buyIn).toBe(4050);
      expect(second.draft.cashOut).toBe(0);
    });

    it('keeps the net exact either way', () => {
      const nets = parseSessionCsv(csv).sessions.map(
        (session) => session.draft.cashOut - session.draft.buyIn,
      );
      expect(nets).toEqual([12_000, -4050]);
    });

    it('says plainly what a missing buy-in column costs', () => {
      expect(messages(parseSessionCsv(csv))).toContain('No buy-in column');
    });

    it('still derives a cash-out from a buy-in column when there is one', () => {
      const withBuyIn = 'Date,Buyin,Result\n2024-01-15,50,-40\n';
      const [session] = parseSessionCsv(withBuyIn).sessions;
      expect(session.draft.buyIn).toBe(5000);
      expect(session.draft.cashOut).toBe(1000);
    });

    it('warns that these sessions cannot reach the variance view', () => {
      const text = messages(parseSessionCsv(csv));
      expect(text).toContain('no readable stakes');
      expect(text).toContain('no duration');
    });
  });

  describe('files it refuses', () => {
    it('rejects an empty file', () => {
      expect(parseSessionCsv('').error).toContain('empty');
    });

    it('rejects a header with no rows under it', () => {
      expect(parseSessionCsv('Date,Result\n').error).toContain('no sessions');
    });

    it('rejects a file with no date column', () => {
      expect(parseSessionCsv('Site,Result\nPokerStars,120\n').error).toContain('No date column');
    });

    it('rejects a file with no result column', () => {
      expect(parseSessionCsv('Date,Site\n2024-01-15,PokerStars\n').error).toContain(
        'No result column',
      );
    });

    it('rejects a cash-out with nothing to measure it against', () => {
      const result = parseSessionCsv('Date,Cashout\n2024-01-15,120\n');
      expect(result.error).toContain('no way to tell profit from money moved');
      expect(result.sessions).toEqual([]);
    });

    it('rejects a file where no row could be read', () => {
      expect(parseSessionCsv('Date,Result\nlast Tuesday,120\n').error).toContain(
        'Nothing in that file',
      );
    });
  });

  describe('the invariants every imported session holds', () => {
    const csv = [
      'Date,Result,End',
      '2024-01-15,120,2024-01-15 23:00',
      '2024-01-16,-40,',
      '2024-01-17,0,2024-01-16 09:00',
    ].join('\n');

    it('never produces a session that would look live', () => {
      for (const session of parseSessionCsv(csv).sessions) {
        expect(session.draft.cashOut).not.toBeNull();
        expect(session.draft.endedAt).not.toBeNull();
      }
    });

    it('never ends a session before it started', () => {
      for (const session of parseSessionCsv(csv).sessions) {
        expect(session.draft.endedAt).toBeGreaterThanOrEqual(session.draft.startedAt);
      }
    });

    it('says so when it had to discard a backwards end time', () => {
      const result = parseSessionCsv(csv);
      expect(messages(result)).toContain('end time is before the start time');
      expect(result.sessions[2].draft.endedAt).toBe(result.sessions[2].draft.startedAt);
    });
  });

  describe('import keys', () => {
    const csv = 'Date,Site,Result\n2024-01-15,PokerStars,120\n2024-01-16,PokerStars,-40\n';

    it('are stable across reads of the same file', () => {
      const first = parseSessionCsv(csv).sessions.map((session) => session.importKey);
      const second = parseSessionCsv(csv).sessions.map((session) => session.importKey);
      expect(first).toEqual(second);
    });

    it('differ between different sessions', () => {
      const keys = parseSessionCsv(csv).sessions.map((session) => session.importKey);
      expect(new Set(keys).size).toBe(2);
    });

    it('number genuinely identical rows so both survive', () => {
      const twice = 'Date,Site,Result\n2024-01-15,PokerStars,120\n2024-01-15,PokerStars,120\n';
      const keys = parseSessionCsv(twice).sessions.map((session) => session.importKey);
      expect(new Set(keys).size).toBe(2);
      expect(keys[1]).toBe(`${keys[0]}#2`);
    });

    it('change when the row changes, so an edited row imports again', () => {
      const edited = 'Date,Site,Result\n2024-01-15,PokerStars,130\n';
      expect(parseSessionCsv(edited).sessions[0].importKey).not.toBe(
        parseSessionCsv(csv).sessions[0].importKey,
      );
    });
  });

  describe('dates', () => {
    it('reads day-first when the column proves it', () => {
      const csv = 'Date,Result\n13/04/2024,120\n03/04/2024,50\n';
      const result = parseSessionCsv(csv);
      expect(result.dateOrder).toBe('dmy');
      expect(result.dateOrderCertain).toBe(true);
      expect(result.sessions[1].draft.startedAt).toBe(local(2024, 4, 3));
    });

    it('falls back to month-first and says so when nothing settles it', () => {
      const result = parseSessionCsv('Date,Result\n03/04/2024,120\n');
      expect(result.dateOrder).toBe('mdy');
      expect(result.dateOrderCertain).toBe(false);
      expect(messages(result)).toContain('could be March 4th or the 3rd of April');
    });

    it('does not raise ambiguity over ISO dates', () => {
      const result = parseSessionCsv('Date,Result\n2024-01-15,120\n');
      expect(messages(result)).not.toContain('March 4th');
    });

    it('takes an explicit order over its own reading', () => {
      const result = parseSessionCsv('Date,Result\n13/04/2024,120\n03/04/2024,50\n', {
        dateOrder: 'mdy',
      });
      expect(result.dateOrder).toBe('mdy');
      expect(result.dateOrderCertain).toBe(true);
      // The 13th is not a month, so that row cannot be read at all.
      expect(result.skipped).toBe(1);
    });
  });

  describe('rows it cannot read', () => {
    const csv = 'Date,Result\n2024-01-15,120\nnot a date,50\n2024-01-17,\n';

    it('skips them and counts them', () => {
      const result = parseSessionCsv(csv);
      expect(result.sessions).toHaveLength(1);
      expect(result.skipped).toBe(2);
    });

    it('points each warning at the line it came from', () => {
      const lines = parseSessionCsv(csv).warnings.map((warning) => warning.line);
      expect(lines).toContain(3);
      expect(lines).toContain(4);
    });

    it('ignores blank padding lines without complaining', () => {
      const padded = 'Date,Result\n2024-01-15,120\n\n\n';
      const result = parseSessionCsv(padded);
      expect(result.sessions).toHaveLength(1);
      expect(result.skipped).toBe(0);
    });
  });

  describe('venues and currency', () => {
    it('names sessions from the site column', () => {
      const csv = 'Date,Site,Result\n2024-01-15,GGPoker,120\n';
      expect(parseSessionCsv(csv).sessions[0].venueName).toBe('GGPoker');
    });

    it('falls back to a single online venue when the file has no site', () => {
      const csv = 'Date,Result\n2024-01-15,120\n';
      expect(parseSessionCsv(csv).sessions[0].venueName).toBe(DEFAULT_VENUE_NAME);
      expect(parseSessionCsv(csv, { defaultVenue: 'ACR' }).sessions[0].venueName).toBe('ACR');
    });

    it('takes the currency from the money cells when there is no currency column', () => {
      const csv = 'Date,Buyin,Cashout\n2024-01-15,£50,£88\n';
      expect(parseSessionCsv(csv).sessions[0].draft.stakes.currency).toBe('GBP');
    });

    it('prefers an explicit currency column', () => {
      const csv = 'Date,Currency,Buyin,Cashout\n2024-01-15,EUR,50,88\n';
      expect(parseSessionCsv(csv).sessions[0].draft.stakes.currency).toBe('EUR');
    });
  });

  describe('other shapes of file', () => {
    it('reads a semicolon file with European numbers', () => {
      const csv = 'Date;Limit;Result\n15.01.2024;0,25/0,50;1.234,56\n';
      const result = parseSessionCsv(csv, { dateOrder: 'dmy' });
      expect(result.delimiter).toBe(';');
      expect(result.sessions[0].draft.cashOut).toBe(123_456);
      expect(result.sessions[0].draft.stakes.bigBlind).toBe(50);
    });

    it('reads a tab-separated paste', () => {
      const result = parseSessionCsv('Date\tResult\n2024-01-15\t120\n');
      expect(result.delimiter).toBe('\t');
      expect(result.sessions).toHaveLength(1);
    });

    it('prefers a cash-out column over a result column when both are present', () => {
      const csv = 'Date,Buyin,Cashout,Profit\n2024-01-15,50,88,999\n';
      expect(parseSessionCsv(csv).sessions[0].draft.cashOut).toBe(8800);
    });

    it('reports the duplicate columns it ignored', () => {
      const csv = 'Date,Profit,Net\n2024-01-15,120,999\n';
      expect(messages(parseSessionCsv(csv))).toContain('Ignored “Net”');
    });

    it('takes the duration unit from the column name', () => {
      const csv = 'Date,Result,Minutes\n2024-01-15,120,210\n';
      const [session] = parseSessionCsv(csv).sessions;
      expect(session.draft.endedAt - session.draft.startedAt).toBe(210 * 60_000);
    });

    it('notes rows that left the buy-in blank', () => {
      const csv = 'Date,Buyin,Cashout\n2024-01-15,,88\n2024-01-16,50,20\n';
      expect(messages(parseSessionCsv(csv))).toContain('1 row had no buy-in');
    });
  });
});
