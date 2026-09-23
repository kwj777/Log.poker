/**
 * When a hand was dealt, from the way a poker site wrote it down.
 *
 * Getting this right is most of what makes hand import work at all: hands go
 * into the session whose clock they fall inside, so a time read three hours
 * off puts a night's hands next to the wrong night, or next to none. Every site
 * writes a wall-clock time, and most say whose wall clock with an abbreviation
 * after it. That abbreviation is what this file turns into an offset.
 *
 * A time with no zone on it is read as this device's local time and reported
 * as such (`zoned: false`), so the preview can say the match is a guess rather
 * than presenting it with the same confidence as one that is not.
 */

import type { Timestamp } from '../../types';

/** Offsets in minutes east of UTC, for the abbreviations the sites actually print. */
const FIXED_ZONES: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  WET: 0,
  WEST: 60,
  BST: 60,
  CET: 60,
  CEST: 120,
  EET: 120,
  EEST: 180,
  MSK: 180,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  AKST: -540,
  AKDT: -480,
  HST: -600,
  BRT: -180,
  ART: -180,
  AEST: 600,
  AEDT: 660,
  ACST: 570,
  ACDT: 630,
  AWST: 480,
  NZST: 720,
  NZDT: 780,
};

/**
 * The US zones written without saying which half of the year they are in.
 *
 * PokerStars stamps every hand with `ET` in brackets, whatever the player's
 * own setting, and `ET` is Eastern *local* time: minus five in winter, minus
 * four in summer. Reading it as a fixed offset would put every summer hand an
 * hour out, which is enough to push the first hands of a night before the
 * session they belong to.
 */
const US_ZONES: Record<string, number> = { ET: -300, CT: -360, MT: -420, PT: -480 };

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The day of the month of the nth Sunday (1-based) of a month, `month` 1-12. */
const nthSunday = (year: number, month: number, n: number): number => {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  return firstSunday + (n - 1) * 7;
};

/**
 * Whether US daylight time is in force at a local wall-clock moment: from 2 AM
 * on the second Sunday of March to 2 AM on the first Sunday of November, the
 * rule since 2007. The hour that happens twice in November is read as the
 * second one, which is the most a wall clock without an offset can say.
 */
const usDaylight = (clock: WallClock): boolean => {
  const { year, month, day, hour } = clock;
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  if (month === 3) {
    const start = nthSunday(year, 3, 2);
    return day > start || (day === start && hour >= 2);
  }
  const end = nthSunday(year, 11, 1);
  return day < end || (day === end && hour < 1);
};

/** Minutes east of UTC for a zone abbreviation at a wall-clock moment, or null if unknown. */
export const zoneOffset = (zone: string, clock: WallClock): number | null => {
  const upper = zone.toUpperCase();
  if (upper in FIXED_ZONES) return FIXED_ZONES[upper];
  if (upper in US_ZONES) return US_ZONES[upper] + (usDaylight(clock) ? 60 : 0);
  return null;
};

export interface ReadTime {
  at: Timestamp;
  /** False when the file named no zone this knows, and the time was read as local. */
  zoned: boolean;
}

const isValid = (clock: WallClock): boolean =>
  clock.month >= 1 &&
  clock.month <= 12 &&
  clock.day >= 1 &&
  clock.day <= 31 &&
  clock.hour >= 0 &&
  clock.hour <= 23 &&
  clock.minute >= 0 &&
  clock.minute <= 59 &&
  clock.second >= 0 &&
  clock.second <= 59;

/**
 * An instant from a wall clock and the zone written after it.
 *
 * Returns null for a clock that is not a real moment, so a line that only
 * looked like a date never becomes one.
 */
export const fromWallClock = (clock: WallClock, zone: string | null): ReadTime | null => {
  if (!isValid(clock)) return null;
  const { year, month, day, hour, minute, second } = clock;
  const offset = zone === null ? null : zoneOffset(zone, clock);
  if (offset === null) {
    return { at: new Date(year, month - 1, day, hour, minute, second).getTime(), zoned: false };
  }
  return {
    at: Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000,
    zoned: true,
  };
};

/**
 * `2026/09/23 14:02:11 CET`, the shape every site in the PokerStars family uses:
 * year first, slashes or dashes, a 24-hour clock, and an optional zone.
 */
const YMD_TIME =
  /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\s+([A-Z]{2,5})\b)?/g;

/**
 * Every year-first time on a header line, with the zone it names.
 *
 * PokerStars writes two: the player's chosen zone and then Eastern in brackets.
 * The first one whose zone is known wins; the bracketed one is there for
 * exactly the case where the player's zone is one this does not know.
 */
export const readHeaderTime = (line: string): ReadTime | null => {
  let fallback: ReadTime | null = null;
  for (const match of line.matchAll(YMD_TIME)) {
    const clock: WallClock = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6]),
    };
    const read = fromWallClock(clock, match[7] ?? null);
    if (read === null) continue;
    if (read.zoned) return read;
    fallback ??= read;
  }
  return fallback;
};
