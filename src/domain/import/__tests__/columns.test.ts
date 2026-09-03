import { normaliseHeader, resolveColumns } from '../columns';

describe('normaliseHeader', () => {
  it('reduces a header to letters and digits', () => {
    expect(normaliseHeader('Buy-In ($)')).toBe('buyin');
    expect(normaliseHeader('  TOTAL  CASHOUT ')).toBe('totalcashout');
    expect(normaliseHeader('P/L')).toBe('pl');
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

  it('lists headers it does not recognise and ignores empty ones', () => {
    const map = resolveColumns(['Date', 'Rake', '', 'bb/100']);
    expect(map.unmapped).toEqual(['Rake', 'bb/100']);
  });

  it('does not match a header by substring', () => {
    // "Rebuys" contains "buy"; matching loosely would file rebuys as the buy-in.
    const map = resolveColumns(['Date', 'Rebuys', 'Result']);
    expect(map.indexes.buyIn).toBeUndefined();
    expect(map.unmapped).toContain('Rebuys');
  });
});
