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

/** Milliseconds as the two fields a player thinks in. */
export const toHoursAndMinutes = (ms: number): { hours: string; minutes: string } => {
  const total = Math.max(0, Math.round(ms / 60_000));
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
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
  const hoursValue = h === '' ? 0 : Number(h);
  const minutesValue = m === '' ? 0 : Number(m);
  if (!Number.isFinite(hoursValue) || !Number.isFinite(minutesValue)) return null;
  if (hoursValue < 0 || minutesValue < 0) return null;
  return Math.round(hoursValue * 3_600_000 + minutesValue * 60_000);
};
