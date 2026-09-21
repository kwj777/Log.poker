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

export const fromCents = (cents: Cents): number => cents / 100;

/**
 * Parse user input from a numeric text field. Accepts "12", "12.5", "1,200.50",
 * "$40" and returns null for anything it cannot read, so callers can keep the
 * field in an invalid-but-editable state rather than silently coercing to 0.
 */
export const parseAmount = (input: string): Cents | null => {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
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
