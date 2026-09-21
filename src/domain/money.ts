/**
 * Money helpers. Everything in the app is stored in integer cents; these are the
 * only functions that convert to or from a human-facing string.
 */

import type { Cents, Stakes } from './types';

export const DEFAULT_CURRENCY = 'USD';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: '$',
  AUD: '$',
};

/**
 * The currencies a player can pick, in the order the picker offers them.
 *
 * The same five this file has always known how to draw. Until there was a
 * picker they were reachable only by importing a file that named one, so a
 * player in London installed Log and watched it put a dollar sign on every
 * number they had ever won at a pound game.
 *
 * `currency` is a plain string on the record rather than a union of these,
 * deliberately: an import reads whatever a file says, and a session that came
 * in as CHF should keep saying CHF rather than being rewritten to the nearest
 * thing this list has. `currencySymbol` already falls back to the code itself,
 * so such a session reads "CHF 240" and is wrong about nothing.
 */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const;

/**
 * `$ USD`, for a chip narrow enough to sit five across.
 *
 * Both halves, because three of the five draw the same symbol: a row of chips
 * reading $, EUR, GBP, $, $ would be asking somebody to guess which dollar is
 * theirs.
 */
export const currencyLabel = (currency: string): string =>
  CURRENCY_SYMBOLS[currency] === undefined
    ? currency
    : `${CURRENCY_SYMBOLS[currency]} ${currency}`;

export const currencySymbol = (currency: string): string =>
  CURRENCY_SYMBOLS[currency] ?? `${currency} `;

export const toCents = (amount: number): Cents => Math.round(amount * 100);

/**
 * Work out which of `.` and `,` is the decimal separator, then strip the other.
 *
 * With both present the last one wins -- `1.234,50` is European, `1,234.50` is
 * not. With only commas, one comma trailed by one or two digits is a decimal
 * (`1,50`); anything else is a thousands separator (`1,234` and `1,234,567`).
 * With only dots, more than one means thousands (`1.234.567`).
 *
 * Here rather than in `import/values.ts`, where it was written, because the
 * importer is not the only thing that reads a number somebody wrote: it is the
 * rule `parseAmount` below needs too, and the two disagreeing is what made a
 * comma mean one thing in a file and another in a text field.
 */
export const toNumeric = (digits: string): number | null => {
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');

  let cleaned: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    cleaned = `${digits.slice(0, decimalAt).replace(/[.,]/g, '')}.${digits.slice(decimalAt + 1)}`;
  } else if (lastComma >= 0) {
    const commas = (digits.match(/,/g) ?? []).length;
    const decimals = digits.length - lastComma - 1;
    cleaned =
      commas === 1 && decimals >= 1 && decimals <= 2
        ? digits.replace(',', '.')
        : digits.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const dots = (digits.match(/\./g) ?? []).length;
    cleaned = dots > 1 ? digits.replace(/\./g, '') : digits;
  } else {
    cleaned = digits;
  }

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
};

export const fromCents = (cents: Cents): number => cents / 100;

/**
 * Parse user input from a numeric text field. Accepts "12", "12.5", "1,200.50",
 * "1,50", "$40" and returns null for anything it cannot read, so callers can
 * keep the field in an invalid-but-editable state rather than silently coercing
 * to 0.
 *
 * **The comma is read rather than deleted**, which is a hundredfold difference
 * and was the wrong way round. This stripped everything outside `[0-9.-]`, so
 * a comma vanished and `1,50` became `150`, which is a buy-in of a hundred and
 * fifty rather than one fifty. Not a corner: the currency picker offers EUR,
 * GBP, CAD and AUD, and `AmountInput` opens a `decimal-pad`, which on a device
 * set to a comma-decimal locale draws a comma as its decimal key. Every money
 * field in the app comes through here -- buy-in, entry fee, cash-out, rebuy,
 * pot swing, starting balance and both blinds.
 *
 * `toNumeric` is the rule the importer has always used on the same shapes, so
 * a number typed in and the same number in a file now read alike.
 */
export const parseAmount = (input: string): Cents | null => {
  const cleaned = input.replace(/[^0-9.,-]/g, '');
  // A separator on its own is not a number, and `toNumeric` would answer 0 for
  // some of them: `,` strips to an empty string, which `Number` reads as zero.
  if (!/[0-9]/.test(cleaned)) return null;
  const value = toNumeric(cleaned);
  if (value === null) return null;
  return toCents(value);
};

/** `-$1,240.50`. Whole amounts drop the cents: `$40`, not `$40.00`. */
export const formatMoney = (
  cents: Cents,
  options: { currency?: string; signed?: boolean; showCents?: boolean } = {},
): string => {
  const { currency = DEFAULT_CURRENCY, signed = false, showCents } = options;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const withCents = showCents ?? abs % 100 !== 0;
  const value = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  });
  const sign = negative ? '-' : signed ? '+' : '';
  return `${sign}${currencySymbol(currency)}${value}`;
};

const CENTS_PER_THOUSAND = 100_000;
const CENTS_PER_MILLION = 100_000_000;

/** Compact form for chart axes and dense tiles: `$1.2k`, `-$840`. */
export const formatMoneyCompact = (cents: Cents, currency = DEFAULT_CURRENCY): string => {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  const symbol = currencySymbol(currency);
  const oneDecimal = (divisor: number): number => Math.round(abs / (divisor / 10)) / 10;
  if (abs >= CENTS_PER_MILLION) return `${sign}${symbol}${oneDecimal(CENTS_PER_MILLION)}M`;
  if (abs >= CENTS_PER_THOUSAND) return `${sign}${symbol}${oneDecimal(CENTS_PER_THOUSAND)}k`;
  return `${sign}${symbol}${Math.round(abs / 100)}`;
};

/** `$1/$2`, or `$1/$2 ($2 ante)` when the game has a mandatory ante. */
export const formatStakes = (stakes: Stakes, currency: string = DEFAULT_CURRENCY): string => {
  const base = `${formatMoney(stakes.smallBlind, { currency })}/${formatMoney(stakes.bigBlind, {
    currency,
  })}`;
  if (stakes.ante != null && stakes.ante > 0) {
    return `${base} (${formatMoney(stakes.ante, { currency })} ante)`;
  }
  return base;
};

/**
 * Grouping key for "profit by stakes". Built from the numeric blinds rather than
 * the display string so 1/2 typed two different ways still groups together, and
 * carrying the currency so a 1/2 game in euros is not pooled with one in dollars.
 */
export const stakesKey = (stakes: Stakes, currency: string = DEFAULT_CURRENCY): string =>
  `${currency}:${stakes.smallBlind}/${stakes.bigBlind}`;

/**
 * How a tournament entry is written: `$100+$10`, or just `$100` with no fee.
 * The two halves are kept apart because that is how they are advertised, and
 * because only one of them is ever coming back.
 */
export const formatEntry = (
  buyIn: Cents,
  fee: Cents | null,
  currency: string = DEFAULT_CURRENCY,
): string => {
  const base = formatMoney(buyIn, { currency });
  if (fee === null || fee === 0) return base;
  return `${base}+${formatMoney(fee, { currency })}`;
};
