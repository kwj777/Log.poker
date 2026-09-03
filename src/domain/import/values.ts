/**
 * Cell parsers: money, dates, durations, stakes, game types.
 *
 * Every one of these takes a string a human or a tracker wrote and returns
 * either a domain value or `null`. None of them guess: a cell that cannot be
 * read returns `null` so the importer can warn about it, rather than coercing to
 * a zero that would quietly land in a bankroll curve.
 *
 * The awkwardness here is real and unavoidable. `1,234.50` and `1.234,50` are
 * the same amount written by two locales; `03/04/2024` is two different days
 * depending on which side of the Atlantic exported it. The rules below are
 * written out rather than delegated to `Date.parse`, which is permitted by spec
 * to accept almost anything and does -- including reading `03/04/2024` one way on
 * one engine and another way somewhere else.
 */

import { toCents } from '../money';
import type { Cents, GameType, Stakes } from '../types';

// ------------------------------------------------------------------- money

const CURRENCY_BY_SYMBOL: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
};

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'CHF', 'SEK', 'NZD'];

/**
 * The currency a cell names, if it names one. `$` is read as USD: it is also
 * Canadian and Australian and several more, and no exporter that writes a bare
 * `$` gives us anything to tell them apart with.
 */
export const parseCurrency = (input: string): string | null => {
  const upper = input.toUpperCase();
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }
  for (const [symbol, code] of Object.entries(CURRENCY_BY_SYMBOL)) {
    if (input.includes(symbol)) return code;
  }
  return null;
};

export interface ParsedMoney {
  cents: Cents;
  /** Whatever the cell itself named, so a file with no currency column still works. */
  currency: string | null;
}

/**
 * Work out which of `.` and `,` is the decimal separator, then strip the other.
 *
 * With both present the last one wins -- `1.234,50` is European, `1,234.50` is
 * not. With only commas, one comma trailed by one or two digits is a decimal
 * (`1,50`); anything else is a thousands separator (`1,234` and `1,234,567`).
 * With only dots, more than one means thousands (`1.234.567`).
 */
const toNumeric = (digits: string): number | null => {
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

/**
 * Read a money cell.
 *
 * Accepts `$1,240.50`, `-40`, `1.234,56 EUR`, and `(52.50)` -- accounting
 * parentheses for a negative, which is what a spreadsheet exports and what
 * `parseAmount` in `money.ts` would read as a *positive* fifty-two fifty. That
 * difference is the reason this lives here rather than reusing that function:
 * one is for a numeric keypad, this one is for other people's files.
 */
export const parseMoney = (input: string): ParsedMoney | null => {
  const text = input.trim();
  if (text === '') return null;

  const currency = parseCurrency(text);
  const parenthesised = /^\((.*)\)$/.test(text);
  const inner = parenthesised ? text.slice(1, -1) : text;
  // A minus is a sign only where it precedes every digit: `-40`, `$-40`,
  // `USD -40`. Matching one anywhere would read `2024-01-15` as negative.
  const negative = parenthesised || /^[^\d]*-[^\d]*\d/.test(inner);

  const digits = inner.replace(/[^\d.,]/g, '');
  if (digits === '' || !/\d/.test(digits)) return null;

  const value = toNumeric(digits);
  if (value === null) return null;

  return { cents: toCents(negative ? -value : value), currency };
};

// -------------------------------------------------------------------- dates

/** Which of the first two numbers in `03/04/2024` is the day. */
export type DateOrder = 'dmy' | 'mdy';

const DATE_TIME =
  /^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?/i;

const ZONE = /^(Z|[+-]\d{2}:?\d{2})$/i;

/** `24` → 2024, `98` → 1998. The usual pivot; nobody logged a session in 2098. */
const expandYear = (year: number, digits: number): number => {
  if (digits > 2) return year;
  return year < 70 ? 2000 + year : 1900 + year;
};

/**
 * Decide whether a column of slash-dates is day-first or month-first by looking
 * at all of it at once.
 *
 * A single `03/04/2024` is unknowable, but a column containing one `13/04/2024`
 * settles the whole column. Returns `unknown` when the column never proves it
 * either way -- or, worse, proves both, which means the file is inconsistent and
 * the caller should say so rather than pick.
 */
export const detectDateOrder = (samples: readonly string[]): DateOrder | 'unknown' => {
  let dmy = false;
  let mdy = false;

  for (const sample of samples) {
    const match = DATE_TIME.exec(sample.trim());
    if (!match) continue;
    const [, first, , second, third] = match;
    // A four-digit leading year is ISO -- it says nothing about the other two.
    if (first.length === 4) continue;
    if (third.length < 3 && Number(third) <= 31) continue;
    if (Number(first) > 12) dmy = true;
    if (Number(second) > 12) mdy = true;
  }

  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return 'unknown';
};

/**
 * Read a date cell as epoch milliseconds.
 *
 * A cell carrying an explicit offset (`Z`, `+02:00`) is read as that instant. A
 * cell without one is read as **local time**, because that is what the player
 * meant: they played on the evening of the 15th, in the room they were sitting
 * in. A trailing zone abbreviation like PokerStars' `ET` is ignored rather than
 * guessed at -- `ET` is two different offsets depending on the month.
 */
export const parseTimestamp = (input: string, order: DateOrder = 'mdy'): number | null => {
  const text = input.trim();
  if (text === '') return null;

  if (/^\d{13}$/.test(text)) return Number(text);
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;

  const match = DATE_TIME.exec(text);
  if (!match) return null;

  const [matched, first, , second, third, hourRaw, minuteRaw, secondRaw, meridiem] = match;
  const trailing = text.slice(matched.length).trim();
  const zone = ZONE.test(trailing) ? trailing : null;

  let year: number;
  let month: number;
  let day: number;
  if (first.length === 4) {
    year = Number(first);
    month = Number(second);
    day = Number(third);
  } else {
    year = expandYear(Number(third), third.length);
    if (order === 'dmy') {
      day = Number(first);
      month = Number(second);
    } else {
      month = Number(first);
      day = Number(second);
    }
  }

  let hour = hourRaw === undefined ? 0 : Number(hourRaw);
  const minute = minuteRaw === undefined ? 0 : Number(minuteRaw);
  const seconds = secondRaw === undefined ? 0 : Number(secondRaw);
  if (meridiem !== undefined) {
    const pm = /p/i.test(meridiem);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || seconds > 59) return null;

  if (zone !== null) {
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    const offset = zone.toUpperCase() === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
    const parsed = Date.parse(
      `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(seconds)}${offset}`,
    );
    return Number.isNaN(parsed) ? null : parsed;
  }

  const date = new Date(year, month - 1, day, hour, minute, seconds, 0);
  // Rejects the 30th of February, which the constructor would roll into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
};

// ----------------------------------------------------------------- duration

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** What a bare number in a duration column means, taken from the column's name. */
export type DurationUnit = 'hours' | 'minutes' | 'seconds';

/**
 * Read a duration cell as milliseconds.
 *
 * Handles `3:45` and `3:45:20` (clock form), `3h 45m` and `90m` (spelled form),
 * and a bare `3.5`, which means whatever the column header said it means -- a
 * column called "Minutes" and one called "Hours" both hold bare numbers, and
 * only the header can tell them apart.
 */
export const parseDurationMs = (input: string, unit: DurationUnit = 'hours'): number | null => {
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text);
  if (clock) {
    return (
      Number(clock[1]) * HOUR_MS +
      Number(clock[2]) * MINUTE_MS +
      (clock[3] === undefined ? 0 : Number(clock[3]) * 1000)
    );
  }

  const spelled = /^(?:(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:[.,]\d+)?)\s*m(?:in(?:ute)?s?)?)?$/.exec(
    text,
  );
  if (spelled && (spelled[1] !== undefined || spelled[2] !== undefined)) {
    const hours = spelled[1] === undefined ? 0 : Number(spelled[1].replace(',', '.'));
    const minutes = spelled[2] === undefined ? 0 : Number(spelled[2].replace(',', '.'));
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return Math.round(hours * HOUR_MS + minutes * MINUTE_MS);
    }
  }

  const bare = toNumeric(text.replace(/[^\d.,]/g, ''));
  if (bare === null || !/\d/.test(text)) return null;
  if (unit === 'seconds') return Math.round(bare * 1000);
  if (unit === 'minutes') return Math.round(bare * MINUTE_MS);
  return Math.round(bare * HOUR_MS);
};

/** `duration (minutes)` → minutes. Bare numbers are hours unless told otherwise. */
export const durationUnitFromHeader = (header: string): DurationUnit => {
  const text = header.toLowerCase();
  if (/\bsec|\bsecs\b|seconds/.test(text)) return 'seconds';
  if (/\bmin|minute/.test(text)) return 'minutes';
  return 'hours';
};

// ------------------------------------------------------------------- stakes

const STAKES_PAIR = /(\d[\d.,]*)\s*\/\s*[$€£¥₹\s]*(\d[\d.,]*)/;
const ANTE = /(?:ante|straddle|bring[- ]?in)\D{0,3}(\d[\d.,]*)/i;

/**
 * Read a stakes cell: `$0.25/$0.50`, `1/2`, `0,25/0,50`, `50/100 ante 12`.
 *
 * Returns `null` for anything without two blinds in it -- including shorthand
 * like `NL50`, which encodes a maximum buy-in rather than the blinds and means
 * different things on different sites. Inventing `$0.25/$0.50` from it would be
 * a guess dressed as a measurement, and the caller has a warning for that.
 */
export const parseStakes = (input: string, fallbackCurrency: string): Stakes | null => {
  const text = input.trim();
  if (text === '') return null;

  const pair = STAKES_PAIR.exec(text);
  if (!pair) return null;

  const smallBlind = parseMoney(pair[1]);
  const bigBlind = parseMoney(pair[2]);
  if (smallBlind === null || bigBlind === null) return null;
  if (smallBlind.cents <= 0 || bigBlind.cents <= 0) return null;

  const anteMatch = ANTE.exec(text);
  const ante = anteMatch ? parseMoney(anteMatch[1]) : null;

  return {
    smallBlind: smallBlind.cents,
    bigBlind: bigBlind.cents,
    ...(ante !== null && ante.cents > 0 ? { ante: ante.cents } : {}),
    currency: parseCurrency(text) ?? fallbackCurrency,
  };
};

// ---------------------------------------------------------------- game type

/**
 * Map a game cell onto Log's three variants.
 *
 * Fixed-limit hold'em lands on `OTHER` rather than `NLHE`: the label on `NLHE`
 * reads "No-Limit Hold'em" on screen, and filing a limit game under it would put
 * a wrong word in front of the player to save a category.
 */
export const parseGameType = (input: string): GameType | null => {
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  if (/omaha|\bplo\b/.test(text)) return 'PLO';

  if (/hold\s*'?\s*em|\bnlhe?\b|\bhe\b|texas/.test(text)) {
    const withoutNoLimit = text.replace(/no[-\s]*limit|\bnl\b/g, '');
    return /\blimit\b|\bfl\b/.test(withoutNoLimit) ? 'OTHER' : 'NLHE';
  }

  return 'OTHER';
};

/**
 * Whether any sample is a numeric date that is *not* ISO -- the shape where
 * day-first and month-first disagree. Used to decide whether an undetermined
 * `detectDateOrder` is worth warning about: a column of `2024-01-15` is
 * unambiguous, so saying "these dates could be read two ways" would be noise.
 */
export const hasAmbiguousDateShape = (samples: readonly string[]): boolean =>
  samples.some((sample) => {
    const match = DATE_TIME.exec(sample.trim());
    return match !== null && match[1].length !== 4;
  });
