import {
  detectDateOrder,
  durationUnitFromHeader,
  hasAmbiguousDateShape,
  parseCount,
  parseCurrency,
  parseDurationMs,
  parseGameType,
  parseMoney,
  parseStakes,
  parseTimestamp,
} from '../values';

/** Local-time epoch, computed the same way the parser does, so the suite is timezone-independent. */
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0): number =>
  new Date(y, m - 1, d, h, min, s, 0).getTime();

describe('parseCurrency', () => {
  it('reads three-letter codes and symbols', () => {
    expect(parseCurrency('1.234,56 EUR')).toBe('EUR');
    expect(parseCurrency('£40')).toBe('GBP');
    expect(parseCurrency('€30')).toBe('EUR');
    expect(parseCurrency('$40')).toBe('USD');
  });

  it('prefers an explicit code over a bare dollar sign', () => {
    expect(parseCurrency('$40 CAD')).toBe('CAD');
  });

  it('returns null when nothing names a currency', () => {
    expect(parseCurrency('40')).toBeNull();
    expect(parseCurrency('')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('reads plain and signed amounts', () => {
    expect(parseMoney('120')?.cents).toBe(12_000);
    expect(parseMoney('12.50')?.cents).toBe(1250);
    expect(parseMoney('-40')?.cents).toBe(-4000);
    expect(parseMoney('0')?.cents).toBe(0);
  });

  it('reads currency symbols and reports them', () => {
    expect(parseMoney('$1,240.50')).toEqual({ cents: 124_050, currency: 'USD' });
    expect(parseMoney('-$40')).toEqual({ cents: -4000, currency: 'USD' });
    expect(parseMoney('£12')).toEqual({ cents: 1200, currency: 'GBP' });
  });

  it('reads accounting parentheses as negative', () => {
    expect(parseMoney('(52.50)')?.cents).toBe(-5250);
    expect(parseMoney('($1,200)')?.cents).toBe(-120_000);
  });

  it('reads a European decimal comma', () => {
    expect(parseMoney('1.234,56')?.cents).toBe(123_456);
    expect(parseMoney('12,50 EUR')?.cents).toBe(1250);
    expect(parseMoney('-1,5')?.cents).toBe(-150);
  });

  it('reads commas and dots as thousands separators when they cannot be decimals', () => {
    expect(parseMoney('1,234')?.cents).toBe(123_400);
    expect(parseMoney('1,234,567')?.cents).toBe(123_456_700);
    expect(parseMoney('1.234.567')?.cents).toBe(123_456_700);
  });

  it('does not read the dashes in a date as a minus sign', () => {
    expect(parseMoney('2024-01-15')?.cents).toBeGreaterThan(0);
  });

  it('reads a minus that follows the currency symbol', () => {
    expect(parseMoney('$-40')?.cents).toBe(-4000);
    expect(parseMoney('USD -40')?.cents).toBe(-4000);
  });

  it('returns null for anything with no digits in it', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('  ')).toBeNull();
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
    expect(parseMoney('$')).toBeNull();
  });
});

describe('detectDateOrder', () => {
  it('settles a column from a day past the twelfth', () => {
    expect(detectDateOrder(['03/04/2024', '13/04/2024'])).toBe('dmy');
    expect(detectDateOrder(['03/04/2024', '04/13/2024'])).toBe('mdy');
  });

  it('gives up when the column proves both or neither', () => {
    expect(detectDateOrder(['13/04/2024', '04/13/2024'])).toBe('unknown');
    expect(detectDateOrder(['03/04/2024', '05/06/2024'])).toBe('unknown');
    expect(detectDateOrder([])).toBe('unknown');
  });

  it('takes no evidence from ISO dates', () => {
    expect(detectDateOrder(['2024-01-15', '2024-12-31'])).toBe('unknown');
  });
});

describe('hasAmbiguousDateShape', () => {
  it('is true only for non-ISO numeric dates', () => {
    expect(hasAmbiguousDateShape(['03/04/2024'])).toBe(true);
    expect(hasAmbiguousDateShape(['2024-01-15', '2024-01-16'])).toBe(false);
    expect(hasAmbiguousDateShape(['not a date'])).toBe(false);
  });
});

describe('parseTimestamp', () => {
  it('reads ISO dates as local time', () => {
    expect(parseTimestamp('2024-01-15')).toBe(local(2024, 1, 15));
    expect(parseTimestamp('2024-01-15 20:14')).toBe(local(2024, 1, 15, 20, 14));
    expect(parseTimestamp('2024-01-15T20:14:32')).toBe(local(2024, 1, 15, 20, 14, 32));
  });

  it('honors an explicit offset', () => {
    expect(parseTimestamp('2024-01-15T20:14:32Z')).toBe(Date.UTC(2024, 0, 15, 20, 14, 32));
    expect(parseTimestamp('2024-01-15T20:14:32+02:00')).toBe(Date.UTC(2024, 0, 15, 18, 14, 32));
    expect(parseTimestamp('2024-01-15T20:14:32+0200')).toBe(Date.UTC(2024, 0, 15, 18, 14, 32));
  });

  it('and still honors it when the stamp carries a fraction of a second', () => {
    // `.000Z` is what `toISOString` writes, so it is the commonest machine
    // stamp there is, and it was the one shape read in the wrong zone: the
    // fraction stayed in the trailing text, failed the zone test, and the cell
    // fell through to local time. Five hours out in New York, and correct the
    // moment the `.000` was removed, which made it look like a quirk of one
    // file rather than a bug in the parser.
    expect(parseTimestamp('2024-01-15T20:14:32.000Z')).toBe(
      parseTimestamp('2024-01-15T20:14:32Z'),
    );
    expect(parseTimestamp('2024-01-15T20:14:32.123Z')).toBe(Date.UTC(2024, 0, 15, 20, 14, 32));
    expect(parseTimestamp('2024-01-15T20:14:32.500+02:00')).toBe(
      Date.UTC(2024, 0, 15, 18, 14, 32),
    );
    // And a fraction with no zone is still local, which is what it always was.
    expect(parseTimestamp('2024-01-15T20:14:32.250')).toBe(local(2024, 1, 15, 20, 14, 32));
  });

  it('reads slash dates in the order it is given', () => {
    expect(parseTimestamp('03/04/2024', 'mdy')).toBe(local(2024, 3, 4));
    expect(parseTimestamp('03/04/2024', 'dmy')).toBe(local(2024, 4, 3));
    expect(parseTimestamp('15.01.2024', 'dmy')).toBe(local(2024, 1, 15));
  });

  it('reads the PokerStars date shape and ignores a zone abbreviation', () => {
    expect(parseTimestamp('2024/01/15 20:14:32 ET')).toBe(local(2024, 1, 15, 20, 14, 32));
  });

  it('reads a twelve-hour clock', () => {
    expect(parseTimestamp('01/15/2024 8:14 PM')).toBe(local(2024, 1, 15, 20, 14));
    expect(parseTimestamp('01/15/2024 12:30 AM')).toBe(local(2024, 1, 15, 0, 30));
    expect(parseTimestamp('01/15/2024 12:30 PM')).toBe(local(2024, 1, 15, 12, 30));
  });

  it('expands two-digit years around 1970', () => {
    expect(parseTimestamp('01/15/24', 'mdy')).toBe(local(2024, 1, 15));
    expect(parseTimestamp('01/15/98', 'mdy')).toBe(local(1998, 1, 15));
  });

  it('reads bare epoch seconds and milliseconds', () => {
    expect(parseTimestamp('1705348800')).toBe(1_705_348_800_000);
    expect(parseTimestamp('1705348800000')).toBe(1_705_348_800_000);
  });

  it('rejects impossible and unreadable dates', () => {
    expect(parseTimestamp('2024-02-30')).toBeNull();
    expect(parseTimestamp('2024-13-01')).toBeNull();
    expect(parseTimestamp('2024-01-15 25:00')).toBeNull();
    expect(parseTimestamp('last Tuesday')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('parseDurationMs', () => {
  const HOUR = 3_600_000;

  it('reads clock form', () => {
    expect(parseDurationMs('3:45')).toBe(3 * HOUR + 45 * 60_000);
    expect(parseDurationMs('3:45:20')).toBe(3 * HOUR + 45 * 60_000 + 20_000);
    expect(parseDurationMs('12:00')).toBe(12 * HOUR);
  });

  it('reads spelled form', () => {
    expect(parseDurationMs('3h 45m')).toBe(3 * HOUR + 45 * 60_000);
    expect(parseDurationMs('3h')).toBe(3 * HOUR);
    expect(parseDurationMs('90m')).toBe(90 * 60_000);
    expect(parseDurationMs('2 hours 30 minutes')).toBe(2 * HOUR + 30 * 60_000);
  });

  it('reads a bare number in the unit the header named', () => {
    expect(parseDurationMs('3.5', 'hours')).toBe(3.5 * HOUR);
    expect(parseDurationMs('210', 'minutes')).toBe(210 * 60_000);
    expect(parseDurationMs('5400', 'seconds')).toBe(5_400_000);
  });

  it('reads seconds spelled out beside the rest', () => {
    expect(parseDurationMs('3h 45m 20s')).toBe(3 * HOUR + 45 * 60_000 + 20_000);
    expect(parseDurationMs('20s')).toBe(20_000);
    expect(parseDurationMs('2 hrs 5 mins')).toBe(2 * HOUR + 5 * 60_000);
  });

  it('returns null for anything with no number in it', () => {
    expect(parseDurationMs('')).toBeNull();
    expect(parseDurationMs('a while')).toBeNull();
  });

  it('returns null rather than inventing hours out of a cell it cannot read', () => {
    // The bare-number fallback stripped every non-digit and read what was
    // left, so a cell the two patterns above could not parse came back four
    // orders of magnitude too large instead of null. `sessionImport` takes
    // that as the length of the night: the session ends years after it began,
    // its hourly rate collapses to nothing, and it goes into the variance
    // estimate with no warning, because a duration that parsed is one nothing
    // complains about.
    expect(parseDurationMs('1h30')).toBeNull();
    expect(parseDurationMs('3 to 4')).toBeNull();
    expect(parseDurationMs('19:00-23:30')).toBeNull();
    // A night cannot run backwards, so the minus is refused rather than
    // stripped along with the colon and read as 130 hours.
    expect(parseDurationMs('-1:30')).toBeNull();
    expect(parseDurationMs('-2')).toBeNull();
  });
});

describe('durationUnitFromHeader', () => {
  it('takes the unit from the column name', () => {
    expect(durationUnitFromHeader('Duration (minutes)')).toBe('minutes');
    expect(durationUnitFromHeader('Mins')).toBe('minutes');
    expect(durationUnitFromHeader('Seconds played')).toBe('seconds');
    expect(durationUnitFromHeader('Duration')).toBe('hours');
    expect(durationUnitFromHeader('')).toBe('hours');
  });
});

describe('parseStakes', () => {
  it('reads two blinds with or without symbols', () => {
    expect(parseStakes('$0.25/$0.50')).toEqual({ smallBlind: 25, bigBlind: 50 });
    expect(parseStakes('1/2')).toEqual({ smallBlind: 100, bigBlind: 200 });
  });

  it('reads European decimals', () => {
    expect(parseStakes('0,25/0,50 EUR')).toEqual({ smallBlind: 25, bigBlind: 50 });
  });

  it('reads an ante when the cell names one', () => {
    expect(parseStakes('50/100 ante 12')).toEqual({
      smallBlind: 5000,
      bigBlind: 10_000,
      ante: 1200,
    });
  });

  it('carries no currency: a session has one, its blinds do not', () => {
    expect(parseStakes('$1/$2')).not.toHaveProperty('currency');
  });

  it('refuses shorthand that does not name both blinds', () => {
    expect(parseStakes('NL50')).toBeNull();
    expect(parseStakes('$2')).toBeNull();
    expect(parseStakes('')).toBeNull();
    expect(parseStakes('0/0')).toBeNull();
  });

  it('reads a blind that opens on its own decimal point', () => {
    // Half a dollar is written this way on half the sites there are, and a
    // pattern that has to start on a digit steps over the point: `$.50` was
    // read as fifty dollars, stored, shown as "$50/$1" and keyed that way, and
    // nothing warned, because the importer only complains about a cell it
    // could not read and this one read.
    expect(parseStakes('$.50/$1')).toEqual({ smallBlind: 50, bigBlind: 100 });
    expect(parseStakes('.5/1')).toEqual({ smallBlind: 50, bigBlind: 100 });
    expect(parseStakes(',25/,50')).toEqual({ smallBlind: 25, bigBlind: 50 });
    // Both blinds dotted used to fail the second group as well and come back
    // null, which is why the mixed form was the one that got through.
    expect(parseStakes('$.25/$.50')).toEqual({ smallBlind: 25, bigBlind: 50 });
  });

  it('and an ante that opens on one, rather than reading the cents as dollars', () => {
    expect(parseStakes('1/2 ante .25')).toEqual({
      smallBlind: 100,
      bigBlind: 200,
      ante: 25,
    });
  });

  it('refuses a small blind above the big one, whatever produced it', () => {
    // Not a game anybody plays, so it is a misread rather than a stake, and
    // refusing the pair sends it down the same path as a cell with no blinds
    // in it -- which the importer already warns about. The guard is on the
    // answer rather than the pattern, so a later hole in the pattern lands
    // here too.
    expect(parseStakes('$2/$1')).toBeNull();
    expect(parseStakes('100/2')).toBeNull();
    // Equal is left alone: unusual, and a real table.
    expect(parseStakes('1/1')).toEqual({ smallBlind: 100, bigBlind: 100 });
  });
});

describe('parseGameType', () => {
  it('recognizes the two variants Log names', () => {
    expect(parseGameType("Hold'em No Limit")).toBe('NLHE');
    expect(parseGameType('NLHE')).toBe('NLHE');
    expect(parseGameType('Texas Holdem')).toBe('NLHE');
    expect(parseGameType('Pot Limit Omaha')).toBe('PLO');
    expect(parseGameType('PLO')).toBe('PLO');
    expect(parseGameType('Omaha Hi/Lo')).toBe('PLO');
  });

  it('files fixed-limit hold’em under OTHER rather than mislabelling it', () => {
    expect(parseGameType("Limit Hold'em")).toBe('OTHER');
    expect(parseGameType("Fixed Limit Hold'em")).toBe('OTHER');
  });

  it('files anything else under OTHER, and an empty cell under nothing', () => {
    expect(parseGameType('Stud')).toBe('OTHER');
    expect(parseGameType('')).toBeNull();
  });
});

describe('parseCount', () => {
  it('reads the shapes a file writes a field size or a finish in', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount('1,240')).toBe(1240);
    expect(parseCount('1 240')).toBe(1240);
    expect(parseCount('12th')).toBe(12);
    expect(parseCount('21st')).toBe(21);
    expect(parseCount('#12')).toBe(12);
    expect(parseCount('1,240th')).toBe(1240);
    expect(parseCount('  7  ')).toBe(7);
  });

  it('refuses a cell that is not one number, rather than keeping its digits', () => {
    // The whole of the old bug in one list. Every one of these came back as a
    // number: `-5` as 5, `12.5` as 125, `1 of 100` as 1100, `3rd of 9` as 39,
    // `1e3` as 13. They were stripped of everything but their digits and the
    // remainder was read, so "refuses anything that is not a positive whole
    // number" only ever fired on a cell with no digits in it at all.
    //
    // Which matters because of where the answer goes: a non-null count is what
    // `impliedByField` in `sessionImport.ts` reads to call the row a
    // tournament, and calling it one throws the stakes away. A mis-mapped
    // column is precisely the cell that lands here.
    expect(parseCount('-5')).toBeNull();
    expect(parseCount('12.5')).toBeNull();
    expect(parseCount('1 of 100')).toBeNull();
    expect(parseCount('3rd of 9')).toBeNull();
    expect(parseCount('1e3')).toBeNull();
    expect(parseCount('1/100')).toBeNull();
    expect(parseCount('+4')).toBeNull();
    expect(parseCount('$12')).toBeNull();
  });

  it('refuses a zeroth place, an empty cell and a number too large to be one', () => {
    expect(parseCount('0')).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount('N/A')).toBeNull();
    expect(parseCount('9999999999999999999')).toBeNull();
  });

  it('reads its separators by the rule the rest of the file reads them by', () => {
    // `toNumeric`, so a comma means here what it means in a money cell and in
    // a typed amount. A lone dot is a decimal point, which leaves a European
    // `1.240` unreadable as a count -- refused rather than guessed at, because
    // a null leaves the row a cash game and a guess writes a field size
    // nobody's file contained.
    expect(parseCount('1,234,567')).toBe(1234567);
    expect(parseCount('1,24')).toBeNull();
    expect(parseCount('1.240')).toBeNull();
  });
});
