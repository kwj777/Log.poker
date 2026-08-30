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
export const formatStakes = (stakes: Stakes): string => {
  const base = `${formatMoney(stakes.smallBlind, { currency: stakes.currency })}/${formatMoney(
    stakes.bigBlind,
    { currency: stakes.currency },
  )}`;
  if (stakes.ante != null && stakes.ante > 0) {
    return `${base} (${formatMoney(stakes.ante, { currency: stakes.currency })} ante)`;
  }
  return base;
};

/**
 * Grouping key for "profit by stakes". Built from the numeric blinds rather than
 * the display string so 1/2 typed two different ways still groups together.
 */
export const stakesKey = (stakes: Stakes): string =>
  `${stakes.currency}:${stakes.smallBlind}/${stakes.bigBlind}`;
