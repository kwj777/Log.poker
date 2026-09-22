import {
  DEFAULT_VENUE_NAME,
  draftNet,
  parseSessionCsv,
  type ImportedSessionDraft,
} from '../sessionImport';
import { totalInvested } from '../../stats';
import type { Session } from '../../types';

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
        format: 'cash',
        gameType: 'NLHE',
        stakes: { smallBlind: 25, bigBlind: 50 },
        currency: 'USD',
        buyIn: 5000,
        fee: null,
        cashOut: 8825,
        entrants: null,
        finishPosition: null,
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

  describe('a date that has not happened', () => {
    // The rule `isAhead` exists for and the three typed screens already keep:
    // "2062-09-19 for 2026-09-19 parses, is a real date, and used to be
    // accepted in silence." The importer accepted it. `deriveDefaults` then
    // opened every later session from it, `assessRecentStretch` called it
    // permanently recent, and the bankroll curve got a point decades out.
    // Against the real clock rather than an injected one, so these fail on an
    // assertion rather than on a signature.
    const csv = 'Date,Result\n2199-09-19,120\n2024-01-15,50\n';

    it('is skipped rather than imported, like every screen a date is typed into', () => {
      const result = parseSessionCsv(csv);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].draft.startedAt).toBeLessThan(Date.now());
      expect(result.skipped).toBe(1);
    });

    it('and says which row and why, because a typed year is the likely cause', () => {
      const warning = parseSessionCsv(csv).warnings.find((w) => w.line === 2);
      expect(warning?.message).toMatch(/has not happened yet/);
      expect(warning?.message).toMatch(/year/i);
    });

    it('but a session logged as it ends is not in the future', () => {
      // `FUTURE_TOLERANCE_MS` is five minutes, for exactly this: a device clock
      // a minute fast must not refuse tonight's session.
      const now = new Date(2026, 8, 22, 12).getTime();
      const justNow = new Date(now + 60_000).toISOString();
      const result = parseSessionCsv(`Date,Result\n${justNow},120\n`, { now });
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
      expect(parseSessionCsv(csv).sessions[0].draft.currency).toBe('GBP');
    });

    it('prefers an explicit currency column', () => {
      const csv = 'Date,Currency,Buyin,Cashout\n2024-01-15,EUR,50,88\n';
      expect(parseSessionCsv(csv).sessions[0].draft.currency).toBe('EUR');
    });

    it('takes the currency from the stakes cell when nothing else names one', () => {
      const csv = 'Date,Limit,Result\n2024-01-15,€1/€2,120\n';
      expect(parseSessionCsv(csv).sessions[0].draft.currency).toBe('EUR');
    });
  });

  describe('tournaments', () => {
    const csv = [
      'Date,Site,Format,Buyin,Fee,Prize,Entrants,Place,Duration',
      '2024-01-15 18:00,PokerStars,Tournament,$100,$10,$0,210,88,3:30',
      '2024-01-16 18:00,PokerStars,Tournament,$100,$10,$1250,188,3,9:00',
    ].join('\n');

    it('reads the tournament fields off the row', () => {
      const [first] = parseSessionCsv(csv).sessions;
      expect(first.draft).toMatchObject({
        format: 'tournament',
        buyIn: 10_000,
        fee: 1_000,
        cashOut: 0,
        entrants: 210,
        finishPosition: 88,
      });
    });

    it('gives a tournament no stakes at all', () => {
      expect(parseSessionCsv(csv).sessions[0].draft.stakes).toBeNull();
    });

    it('reads a prize column as the cash-out', () => {
      expect(parseSessionCsv(csv).sessions[1].draft.cashOut).toBe(125_000);
    });

    it('says what it did, since tournaments miss the variance view', () => {
      expect(messages(parseSessionCsv(csv))).toContain('2 rows read as a tournament');
    });

    it('and counts them the same way twice in the same sentence', () => {
      // Four of these warnings counted their rows and then disagreed with
      // themselves: "3 rows was read that way", "3 rows gave itself away",
      // "1 session had no duration. They count toward profit". Each was right
      // at one end of the count and wrong at the other, which is why none of
      // them reads oddly in whichever case somebody happened to look at.
      const byField = 'Date,Buyin,Prize,Entrants\n2024-01-15,$100,$0,210\n2024-01-16,$100,$0,90\n';
      expect(messages(parseSessionCsv(byField))).toContain('2 rows gave themselves away');

      const byFee = 'Date,Buyin,Prize,Entry fee\n2024-01-15,$100,$0,$10\n2024-01-16,$100,$0,$10\n';
      expect(messages(parseSessionCsv(byFee))).toContain('2 rows were read that way');

      const one = 'Date,Buyin,Prize,Entrants\n2024-01-15,$100,$0,210\n';
      const said = messages(parseSessionCsv(one));
      expect(said).toContain('1 row gave itself away');
      expect(said).toContain('1 session had no duration. It counts toward profit');
    });

    it('infers a tournament from a field size when no format column says so', () => {
      const inferred = 'Date,Buyin,Prize,Entrants\n2024-01-15,$100,$0,210\n';
      expect(parseSessionCsv(inferred).sessions[0].draft.format).toBe('tournament');
    });

    it('leaves a cash export with a rake column as cash', () => {
      // The finding. `rake` is one of the fee field's aliases and a rake column
      // is ordinary in online cash exports, most of which carry no format
      // column: every row read as a tournament, which threw away the stakes,
      // took the whole history out of the variance view and booked the rake as
      // an entry fee. A rake of $0.00 was enough to do it.
      const cash = [
        'Date,Stakes,Buy-in,Cash-out,Rake',
        '2024-01-05 18:00,$1/$2,200,320,4.50',
        '2024-01-06 18:00,$1/$2,200,140,0.00',
      ].join('\n');
      const result = parseSessionCsv(cash);
      expect(result.sessions.map((session) => session.draft.format)).toEqual(['cash', 'cash']);
      expect(result.sessions.map((session) => session.draft.stakes)).toEqual([
        { smallBlind: 100, bigBlind: 200 },
        { smallBlind: 100, bigBlind: 200 },
      ]);
      expect(result.warnings.map((warning) => warning.message).join(' ')).not.toMatch(
        /read as a tournament/i,
      );
    });

    it('says which column made it read a row as a tournament', () => {
      // The other half of the finding: the old warning said tournaments had
      // been inferred and never said what from, so a file that guessed wrong
      // gave the player nothing to act on.
      const inferred = 'Date,Buyin,Fee,Prize\n2024-01-15,$100,$10,$0\n';
      const message = parseSessionCsv(inferred)
        .warnings.map((warning) => warning.message)
        .join(' ');
      expect(message).toMatch(/read as a tournament/i);
      expect(message).toMatch(/Prize/);
      expect(message).toMatch(/add a column saying/i);
    });

    it('keeps a tournament finishing position instead of reading it as an end time', () => {
      const tournaments = [
        'Date,Buy-in,Fee,Prize,Entrants,Finish',
        '2024-01-05,100,10,0,500,312',
        '2024-01-06,100,10,900,480,7',
      ].join('\n');
      const result = parseSessionCsv(tournaments);
      expect(result.sessions.map((session) => session.draft.finishPosition)).toEqual([312, 7]);
      expect(result.sessions.map((session) => session.draft.entrants)).toEqual([500, 480]);
    });

    it('infers one from an entry fee alone', () => {
      const inferred = 'Date,Buyin,Fee,Prize\n2024-01-15,$100,$10,$0\n';
      expect(parseSessionCsv(inferred).sessions[0].draft.format).toBe('tournament');
    });

    it('reads the words these files actually use', () => {
      const mixed = [
        'Date,Format,Buyin,Result',
        '2024-01-15,MTT,100,-100',
        '2024-01-16,Sit & Go,50,120',
        '2024-01-17,Cash,300,45',
        '2024-01-18,Zoom,100,-20',
      ].join('\n');
      expect(parseSessionCsv(mixed).sessions.map((s) => s.draft.format)).toEqual([
        'tournament',
        'tournament',
        'cash',
        'cash',
      ]);
    });

    it('leaves a cash row without a fee, a field or a finish', () => {
      const mixed = 'Date,Format,Buyin,Fee,Result,Entrants\n2024-01-15,Cash,300,10,45,9\n';
      expect(parseSessionCsv(mixed).sessions[0].draft).toMatchObject({
        format: 'cash',
        fee: null,
        entrants: null,
        finishPosition: null,
      });
    });

    it('does not warn about missing stakes on a tournament, which has none', () => {
      expect(messages(parseSessionCsv(csv))).not.toContain('no readable stakes');
    });

    it('keys a tournament apart from a cash session on the same day', () => {
      const both = [
        'Date,Format,Buyin,Result',
        '2024-01-15,Tournament,100,-100',
        '2024-01-15,Cash,100,-100',
      ].join('\n');
      const keys = parseSessionCsv(both).sessions.map((session) => session.importKey);
      expect(new Set(keys).size).toBe(2);
      expect(keys[0]).toContain('tournament');
    });

    it('keeps the frozen cash key shape, so an earlier import is not redone', () => {
      // Byte-for-byte what the version before tournaments wrote, including the
      // 0/0 it used for a cash session whose blinds it could not read.
      const [withStakes] = parseSessionCsv(
        'Date,Site,Limit,Buyin,Cashout\n2024-01-15,PokerStars,$1/$2,300,450\n',
      ).sessions;
      expect(withStakes.importKey).toBe(
        `csv|${withStakes.draft.startedAt}|pokerstars|USD:100/200|30000|45000`,
      );

      const [without] = parseSessionCsv(
        'Date,Site,Buyin,Cashout\n2024-01-15,PokerStars,300,450\n',
      ).sessions;
      expect(without.importKey).toBe(
        `csv|${without.draft.startedAt}|pokerstars|USD:0/0|30000|45000`,
      );
    });
  });

  describe('other shapes of file', () => {
    it('reads a semicolon file with European numbers', () => {
      const csv = 'Date;Limit;Result\n15.01.2024;0,25/0,50;1.234,56\n';
      const result = parseSessionCsv(csv, { dateOrder: 'dmy' });
      expect(result.delimiter).toBe(';');
      expect(result.sessions[0].draft.cashOut).toBe(123_456);
      expect(result.sessions[0].draft.stakes?.bigBlind).toBe(50);
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


describe('what a row will be worth', () => {
  it('takes the tournament entry fee off, the way the rest of the app does', () => {
    // The preview card is the whole point of the import screen: see what was
    // parsed, then import. Its headline figure was `cashOut - buyIn` written
    // out inline, so it left the fee on the table while `totalInvested` takes
    // it off everywhere else, and a $100+$10 that cashed for nothing previewed
    // as -$100 and landed as -$110.
    expect(draftNet({ buyIn: 10_000, fee: 1_000, cashOut: 0 } as ImportedSessionDraft)).toBe(
      -11_000,
    );
    expect(
      draftNet({ buyIn: 10_000, fee: 1_000, cashOut: 50_000 } as ImportedSessionDraft),
    ).toBe(39_000);
  });

  it('leaves a cash game exactly where it was, since it has no fee', () => {
    expect(draftNet({ buyIn: 30_000, fee: null, cashOut: 45_000 } as ImportedSessionDraft)).toBe(
      15_000,
    );
  });

  it('agrees with `totalInvested`, which is the number that actually lands', () => {
    const draft = { buyIn: 10_000, fee: 1_000, cashOut: 50_000 } as ImportedSessionDraft;
    const landed =
      draft.cashOut - totalInvested({ buyIn: draft.buyIn, fee: draft.fee } as Session, []);
    expect(draftNet(draft)).toBe(landed);
  });
});


describe('a tournament file that reports a profit rather than a prize', () => {
  const parse = (rows: string[]) =>
    parseSessionCsv(
      ['Date,Game,Buy-in,Entry fee,Entrants,Finish,Profit', ...rows].join('\n'),
    );

  /** What the app will actually call this session's result once it is stored. */
  const landed = (draft: ImportedSessionDraft) =>
    draft.cashOut - totalInvested({ buyIn: draft.buyIn, fee: draft.fee } as Session, []);

  it('stores the profit the file states, fee and all', () => {
    // The result column has already had the fee taken off it, so rebuilding
    // the cash-out as buy-in plus result left `netResult` to subtract the fee
    // a second time: the file said +$50 and the dashboard said +$40.
    const [row] = parse(['2026-03-14 19:30,NLHE,100.00,10.00,120,7,50.00']).sessions;
    expect(row.draft.format).toBe('tournament');
    expect(row.draft.buyIn).toBe(10_000);
    expect(row.draft.fee).toBe(1_000);
    expect(landed(row.draft)).toBe(5_000);
  });

  it('and never books a prize nobody was paid to do it', () => {
    // A busted entry: `buyIn + result` is negative, which is a cash-out that
    // does not happen. Adding the fee back keeps the arithmetic where it
    // belongs, on the cost side.
    const [row] = parse(['2026-03-15 19:30,NLHE,100.00,10.00,120,90,-110.00']).sessions;
    expect(row.draft.cashOut).toBe(0);
    expect(landed(row.draft)).toBe(-11_000);
  });

  it('leaves the derived cash-out of a cash game exactly where it was', () => {
    const [row] = parseSessionCsv(
      ['Date,Game,Stakes,Buy-in,Profit', '2026-03-14 19:30,NLHE,$1/$2,300.00,150.00'].join('\n'),
    ).sessions;
    expect(row.draft.format).toBe('cash');
    expect(row.draft.fee).toBeNull();
    expect(row.draft.cashOut).toBe(45_000);
    expect(landed(row.draft)).toBe(15_000);
  });
});


describe('a row that ends exactly where it starts', () => {
  it('is counted as having no duration, which is what it has', () => {
    // Date-only Start and End columns are the ordinary shape of a hand-kept
    // spreadsheet, and a duration cell of 0 reads as zero rather than as
    // nothing. Counted only when the end was missing or backwards, these rows
    // landed with no hours and no warning: the profit went into the dashboard
    // and the hours did not, and the sentence that would have explained the
    // hourly rate moving never appeared.
    const reading = parseSessionCsv(
      [
        'Date,End,Buy-in,Cash-out',
        '2026-03-14,2026-03-14,100,150',
        '2026-03-15,2026-03-15,100,60',
      ].join('\n'),
    );
    expect(reading.sessions).toHaveLength(2);
    for (const row of reading.sessions) {
      expect(row.draft.endedAt).toBe(row.draft.startedAt);
    }
    expect(messages(reading)).toContain('2 sessions had no duration. They count toward profit');
  });

  it('and a row with real hours on it is not', () => {
    const reading = parseSessionCsv(
      ['Date,End,Buy-in,Cash-out', '2026-03-14 19:00,2026-03-14 23:00,100,150'].join('\n'),
    );
    expect(messages(reading)).not.toContain('no duration');
  });
});
