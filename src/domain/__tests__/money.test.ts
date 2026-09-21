import {
  formatMoney,
  formatMoneyCompact,
  formatStakes,
  fromCents,
  parseAmount,
  stakesKey,
  toCents,
} from '../money';
import { parseMoney } from '../import/values';
import { STAKES_1_2, STAKES_2_5 } from './support';

describe('cents conversion', () => {
  it('round-trips whole and fractional dollars', () => {
    expect(toCents(40)).toBe(4_000);
    expect(toCents(12.34)).toBe(1_234);
    expect(fromCents(1_234)).toBe(12.34);
  });

  it('rounds rather than truncating a third of a cent', () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(10.994)).toBe(1_099);
  });

  it('avoids the float error that plagues dollar arithmetic', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in cents it is exact.
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
  });
});

describe('parseAmount', () => {
  it('reads the shapes a player actually types', () => {
    expect(parseAmount('40')).toBe(4_000);
    expect(parseAmount('12.50')).toBe(1_250);
    expect(parseAmount('$300')).toBe(30_000);
    expect(parseAmount('1,200.50')).toBe(120_050);
    expect(parseAmount('-75')).toBe(-7_500);
  });

  it('reads a comma as a decimal where a decimal is what it is', () => {
    // It stripped everything outside `[0-9.-]`, so the comma vanished and
    // `1,50` came back as a hundred and fifty rather than one fifty. Not a
    // corner: the currency picker offers EUR, GBP, CAD and AUD, and
    // `AmountInput` opens a decimal pad, which on a device set to a
    // comma-decimal locale draws a comma as its decimal key.
    expect(parseAmount('1,50')).toBe(150);
    expect(parseAmount('12,5')).toBe(1_250);
    expect(parseAmount('-1,50')).toBe(-150);
    // And the European grouping the other way round.
    expect(parseAmount('1.200,50')).toBe(120_050);
  });

  it('and as a thousands separator where that is what it is', () => {
    expect(parseAmount('1,000')).toBe(100_000);
    expect(parseAmount('1,234,567')).toBe(123_456_700);
    expect(parseAmount('1.234.567')).toBe(123_456_700);
  });

  it('refuses a separator with no number against it', () => {
    // `toNumeric` reads a bare comma as an empty string, which `Number` calls
    // zero, and a buy-in of nothing is not what somebody typing meant.
    expect(parseAmount(',')).toBeNull();
    expect(parseAmount('.')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('reads a file and a text field the same way round', () => {
    // The two used to disagree about what a comma is, which is the whole
    // reason `toNumeric` now lives beside this rather than in the importer.
    for (const written of ['1,50', '1.50', '1,200.50', '1.200,50', '40']) {
      expect(parseAmount(written)).toBe(parseMoney(written)?.cents ?? null);
    }
  });

  it('returns null for input that is not yet a number', () => {
    for (const input of ['', '   ', '-', '.', 'abc', '$']) {
      expect(parseAmount(input)).toBeNull();
    }
  });
});

describe('formatMoney', () => {
  it('drops cents on whole amounts and keeps them otherwise', () => {
    expect(formatMoney(4_000)).toBe('$40');
    expect(formatMoney(4_050)).toBe('$40.50');
  });

  it('groups thousands', () => {
    expect(formatMoney(1_240_50)).toBe('$1,240.50');
    expect(formatMoney(1_000_000)).toBe('$10,000');
  });

  it('puts the minus sign before the currency symbol', () => {
    expect(formatMoney(-4_000)).toBe('-$40');
  });

  it('adds an explicit plus only when asked', () => {
    expect(formatMoney(4_000, { signed: true })).toBe('+$40');
    expect(formatMoney(-4_000, { signed: true })).toBe('-$40');
    expect(formatMoney(0, { signed: true })).toBe('+$0');
  });

  it('honors other currencies', () => {
    expect(formatMoney(4_000, { currency: 'EUR' })).toBe('€40');
    expect(formatMoney(4_000, { currency: 'GBP' })).toBe('£40');
  });

  it('falls back to the code for a currency it has no symbol for', () => {
    expect(formatMoney(4_000, { currency: 'SEK' })).toBe('SEK 40');
  });

  it('can be forced to show or hide cents', () => {
    expect(formatMoney(4_000, { showCents: true })).toBe('$40.00');
    expect(formatMoney(4_050, { showCents: false })).toBe('$41');
  });
});

describe('formatMoneyCompact', () => {
  it('keeps small amounts exact and abbreviates large ones', () => {
    expect(formatMoneyCompact(84_000)).toBe('$840');
    expect(formatMoneyCompact(-84_000)).toBe('-$840');
    expect(formatMoneyCompact(120_000)).toBe('$1.2k');
    expect(formatMoneyCompact(1_250_000)).toBe('$12.5k');
    expect(formatMoneyCompact(15_000_000)).toBe('$150k');
    expect(formatMoneyCompact(100_000_000)).toBe('$1M');
    expect(formatMoneyCompact(325_000_000)).toBe('$3.3M');
  });
});

describe('stakes', () => {
  it('formats blinds the way a player says them', () => {
    expect(formatStakes(STAKES_1_2)).toBe('$1/$2');
    expect(formatStakes(STAKES_2_5)).toBe('$2/$5');
  });

  it('mentions an ante when the game has one', () => {
    expect(formatStakes({ ...STAKES_2_5, ante: 500 })).toBe('$2/$5 ($5 ante)');
  });

  it('ignores a zero ante', () => {
    expect(formatStakes({ ...STAKES_1_2, ante: 0 })).toBe('$1/$2');
  });

  it('groups the same game under one key regardless of ante or entry', () => {
    expect(stakesKey(STAKES_1_2)).toBe(stakesKey({ ...STAKES_1_2, ante: 200 }));
    expect(stakesKey(STAKES_1_2)).not.toBe(stakesKey(STAKES_2_5));
  });

  it('separates the same numbers in different currencies', () => {
    expect(stakesKey(STAKES_1_2, 'USD')).not.toBe(stakesKey(STAKES_1_2, 'EUR'));
  });
});
