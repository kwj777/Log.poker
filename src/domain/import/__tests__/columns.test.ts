import { ALIAS_COLLISIONS, normalizeHeader, resolveColumns } from '../columns';

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
