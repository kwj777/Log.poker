import { ALIAS_COLLISIONS, ALIASES, normalizeHeader, resolveColumns } from '../columns';

describe('normalizeHeader', () => {
  it('reduces a header to letters and digits', () => {
    expect(normalizeHeader('Buy-In ($)')).toBe('buyin');
    expect(normalizeHeader('  TOTAL  CASHOUT ')).toBe('totalcashout');
    expect(normalizeHeader('P/L')).toBe('pl');
  });
});

describe('resolveColumns', () => {
  it('matches the spellings trackers and spreadsheets actually use', () => {
    const map = resolveColumns(['Date', 'Site', 'Game', 'Limit', 'Total Buyin', 'Net Won']);
    expect(map.indexes).toEqual({
      startedAt: 0,
      venue: 1,
      gameType: 2,
      stakes: 3,
      buyIn: 4,
      result: 5,
    });
    expect(map.matched.result).toBe('Net Won');
  });

  it('gives a contested field to the leftmost column and records the loser', () => {
    const map = resolveColumns(['Date', 'Profit', 'Net']);
    expect(map.indexes.result).toBe(1);
    expect(map.duplicates).toEqual([{ header: 'Net', field: 'result' }]);
  });

  it('lists headers it does not recognize and ignores empty ones', () => {
    const map = resolveColumns(['Date', 'Seat', '', 'bb/100']);
    expect(map.unmapped).toEqual(['Seat', 'bb/100']);
  });

  it('matches the tournament columns', () => {
    const map = resolveColumns(['Date', 'Format', 'Buyin', 'Rake', 'Entrants', 'Place', 'Prize']);
    expect(map.indexes).toEqual({
      startedAt: 0,
      format: 1,
      buyIn: 2,
      fee: 3,
      entrants: 4,
      finishPosition: 5,
      cashOut: 6,
    });
  });

  it('reads “Format” as cash-or-tournament and “Game” as the variant', () => {
    const map = resolveColumns(['Date', 'Format', 'Game', 'Result']);
    expect(map.indexes.format).toBe(1);
    expect(map.indexes.gameType).toBe(2);
  });

  it('does not match a header by substring', () => {
    // "Rebuys" contains "buy"; matching loosely would file rebuys as the buy-in.
    const map = resolveColumns(['Date', 'Rebuys', 'Result']);
    expect(map.indexes.buyIn).toBeUndefined();
    expect(map.unmapped).toContain('Rebuys');
  });
});

describe('the alias table itself', () => {
  it('has no alias two fields both claim', () => {
    // `finish` was claimed by `endedAt` and by `finishPosition`, and first-wins
    // gave it to `endedAt`: a tournament export's finishing places were parsed
    // as end times, came out null, and never appeared in `unmapped` or
    // `duplicates`, so nothing anywhere said so. This assertion is the only
    // thing that would have caught it.
    expect(ALIAS_COLLISIONS).toEqual([]);
  });

  it('reads a tournament “Finish” column as a placing', () => {
    const map = resolveColumns(['Date', 'Buy-in', 'Fee', 'Prize', 'Entrants', 'Finish']);
    expect(map.indexes.finishPosition).toBe(5);
    expect(map.indexes.endedAt).toBeUndefined();
  });

  it('still reads the compound end-time spellings as an end time', () => {
    for (const header of ['Finished', 'Finish time', 'Finished at']) {
      expect(resolveColumns(['Date', header]).indexes.endedAt).toBe(1);
    }
  });
});

describe('aliases that matched no header anybody writes', () => {
  /**
   * The table is matched on an exact normalized string, so an alias that is
   * not the normalization of a real header chooses nothing, ever, and looks
   * from the outside exactly like a spelling that is covered.
   *
   * Two were like that. `timeatable` has one `t` where "Time at Table"
   * normalizes to two, so that column fell through to `unmapped` -- and with
   * no duration and no end time the importer records the session as ending
   * when it started, which drops it out of hourly rate and out of the variance
   * estimate entirely. `winnings2` in the cash-out list matches literally
   * "Winnings 2".
   */
  const headers = [
    ['Time at Table', 'duration'],
    ['Table Time', 'duration'],
    ['Hours played', 'duration'],
    ['Buy-In ($)', 'buyIn'],
    ['Cash-out', 'cashOut'],
    ['Prize', 'cashOut'],
    ['P/L', 'result'],
    ['Entry fee', 'fee'],
  ] as const;

  it('map the headers a real export writes', () => {
    for (const [header, field] of headers) {
      expect([header, resolveColumns(['Date', header]).indexes[field]]).toEqual([header, 1]);
    }
  });

  it('and nothing is left in the table that only a typo would reach', () => {
    // Every alias in the list, put back through the normalizer as a header a
    // person might type: `timeattable` reads as "time at table", and a human
    // header with those words normalizes back to it. An alias carrying a digit
    // is the shape `winnings2` had, and no exporter numbers a column that way.
    for (const aliases of Object.values(ALIASES)) {
      for (const alias of aliases) {
        expect([alias, normalizeHeader(alias)]).toEqual([alias, alias]);
        expect([alias, /\d/.test(alias)]).toEqual([alias, false]);
      }
    }
  });
});

