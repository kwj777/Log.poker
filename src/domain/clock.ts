/**
 * Reading and writing the two timestamps a session has, as text.
 *
 * ## Why text
 *
 * A session's start and its length are editable now -- a night logged from the
 * wrong hour, or one left running in a pocket until the next afternoon, used
 * to be permanent, and both feed the hourly rate and the variance estimate
 * through `durationHours`. Editing them needs a control.
 *
 * A native date picker means a native module, a rebuild and a third platform
 * to get right, on an app that has never been run on a device. Typed fields
 * cost none of that and work identically on all three, and the numbers are
 * short: a date and a clock time. So these parse and format, and the screens
 * hold strings.
 *
 * ## Local time throughout
 *
 * A session happened at a wall clock. `new Date(y, m, d, h, min)` builds a
 * local time and `getHours` reads one, so a session logged at 8pm reads back
 * as 8pm in the room it was played in. That is also what `formatTimeOfDay`
 * shows everywhere else, so an edit screen and the screen behind it agree.
 *
 * The consequence, stated rather than discovered: editing a session while in a
 * different time zone from the one it was played in will move it. That is the
 * same thing every other screen already does when it prints the time, and the
 * alternative is asking a player which zone their poker game was in.
 */

import { toNumeric } from './money';
import type { Timestamp } from './types';

/** `2026-09-21`, which is what the date field holds. */
export const formatDateInput = (timestamp: Timestamp): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** `19:45`, 24-hour, which is what the time field holds. */
export const formatTimeInput = (timestamp: Timestamp): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * A date and a clock time back into a timestamp, or null if either is not one.
 *
 * Strict about the shape and then strict about the result: `new Date(2026, 1,
 * 31)` is the 3rd of March rather than an error, so the parts are read back
 * out and compared. A player who types the 31st of February should be told the
 * field is wrong, not silently given a different day.
 */
export const parseDateTime = (date: string, time: string): Timestamp | null => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (dateMatch === null || timeMatch === null) return null;

  const [, year, month, day] = dateMatch.map(Number);
  const [, hours, minutes] = timeMatch.map(Number);
  if (hours > 23 || minutes > 59) return null;

  const built = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    built.getFullYear() !== year ||
    built.getMonth() !== month - 1 ||
    built.getDate() !== day
  ) {
    return null;
  }
  return built.getTime();
};

/**
 * How far ahead of now a typed moment may be before it is read as a typo.
 *
 * Not zero, because a session being logged as it starts is the ordinary case
 * and a device clock that is a minute fast should not refuse it. Small enough
 * that a year typed wrong, which is the mistake this exists for, never lands
 * inside it.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Whether a moment is far enough ahead of now to be a mistake.
 *
 * `2062-09-19` for `2026-09-19` parses, is a real date, and used to be
 * accepted in silence -- and one of them is expensive out of proportion to
 * the typo. `deriveDefaults` takes the session with the newest `startedAt` as
 * the template every later session opens with, `assessRecentStretch` takes the
 * most recent by end time so the mistake is permanently "recent", and the
 * bankroll curve gets a point decades out that flattens everything real into
 * the left edge.
 */
export const isAhead = (at: Timestamp, now: number = Date.now()): boolean =>
  at > now + FUTURE_TOLERANCE_MS;

/** Milliseconds as the two fields a player thinks in. */
export const toHoursAndMinutes = (ms: number): { hours: string; minutes: string } => {
  const total = Math.max(0, Math.round(ms / 60_000));
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
};

/**
 * One of the two fields, read the way `parseAmount` reads a money field.
 *
 * `Number` was the whole of it, and `Number('3,5')` is `NaN`. The hours box
 * opens a `decimal-pad` (`WhenInput.tsx`), and on a phone set to a
 * comma-decimal locale that keypad draws a comma as its decimal key -- which
 * is the case `money.ts` documents at length, having been bitten by it, and
 * routes through `toNumeric` so that a number typed in and the same number in
 * a file read alike. Duration never did.
 *
 * So on a French phone the Edit screen took `3,5` in Buy-in as three fifty and
 * answered `3,5` in Hours played with a dead Save button and "How long did you
 * actually play?" over a field holding a perfectly good number. Two readings
 * of one keystroke, on one screen. `parseDurationMs` already agreed with money
 * about it; only the typed path did not.
 */
const fieldValue = (text: string): number => {
  const cleaned = text.replace(/[^0-9.,-]/g, '');
  // A separator on its own is not a number, and `toNumeric` answers 0 for some
  // of them: `,` strips to an empty string, which `Number` reads as zero.
  if (!/[0-9]/.test(cleaned)) return NaN;
  return toNumeric(cleaned) ?? NaN;
};

/**
 * Two fields back to milliseconds, or null if either is not a number.
 *
 * An empty field is zero rather than a refusal, so "3 hours" can be typed as
 * a 3 and nothing else. Both empty is null: that is a cleared control rather
 * than a session of no length, and the caller decides what to do about it.
 */
export const fromHoursAndMinutes = (hours: string, minutes: string): number | null => {
  const h = hours.trim();
  const m = minutes.trim();
  if (h === '' && m === '') return null;
  const hoursValue = h === '' ? 0 : fieldValue(h);
  const minutesValue = m === '' ? 0 : fieldValue(m);
  if (!Number.isFinite(hoursValue) || !Number.isFinite(minutesValue)) return null;
  if (hoursValue < 0 || minutesValue < 0) return null;
  return Math.round(hoursValue * 3_600_000 + minutesValue * 60_000);
};
