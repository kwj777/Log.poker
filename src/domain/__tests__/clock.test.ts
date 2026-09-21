/**
 * The fields a player types a session's start and length into.
 *
 * Typed rather than picked, because a native date picker is a native module on
 * an app that has never been built for a device. That makes parsing this
 * file's job, and the case worth being careful about is the one JavaScript
 * gets wrong on its own: `new Date(2026, 1, 31)` is the 3rd of March, not an
 * error, so a typo would silently move a session to a day it was not played.
 */

import {
  formatDateInput,
  formatTimeInput,
  fromHoursAndMinutes,
  isAhead,
  parseDateTime,
  toHoursAndMinutes,
} from '../clock';

describe('a session’s date and time, as fields', () => {
  it('round-trips a timestamp through both fields', () => {
    const at = new Date(2026, 8, 21, 19, 45).getTime();
    expect(formatDateInput(at)).toBe('2026-09-21');
    expect(formatTimeInput(at)).toBe('19:45');
    expect(parseDateTime('2026-09-21', '19:45')).toBe(at);
  });

  it('pads a single-digit month, day, hour and minute', () => {
    const at = new Date(2026, 0, 5, 9, 7).getTime();
    expect(formatDateInput(at)).toBe('2026-01-05');
    expect(formatTimeInput(at)).toBe('09:07');
  });

  it('reads midnight and one minute to it', () => {
    expect(parseDateTime('2026-09-21', '0:00')).toBe(new Date(2026, 8, 21, 0, 0).getTime());
    expect(parseDateTime('2026-09-21', '23:59')).toBe(new Date(2026, 8, 21, 23, 59).getTime());
  });

  it('refuses a day that does not exist rather than rolling into the next month', () => {
    // The one JavaScript does quietly. Without the check this is the 3rd of
    // March, and the session moves.
    expect(parseDateTime('2026-02-31', '19:00')).toBeNull();
    expect(parseDateTime('2026-04-31', '19:00')).toBeNull();
    // And a real leap day still works.
    expect(parseDateTime('2028-02-29', '19:00')).not.toBeNull();
  });

  it('refuses a time that is not one', () => {
    expect(parseDateTime('2026-09-21', '24:00')).toBeNull();
    expect(parseDateTime('2026-09-21', '19:60')).toBeNull();
    expect(parseDateTime('2026-09-21', '7pm')).toBeNull();
  });

  it('refuses a date that is not one', () => {
    expect(parseDateTime('21/09/2026', '19:00')).toBeNull();
    expect(parseDateTime('', '19:00')).toBeNull();
    expect(parseDateTime('2026-9-21', '19:00')).toBeNull();
  });

  it('ignores space around what was typed', () => {
    expect(parseDateTime(' 2026-09-21 ', ' 19:45 ')).toBe(
      new Date(2026, 8, 21, 19, 45).getTime(),
    );
  });
});

describe('a session’s length, as fields', () => {
  it('splits milliseconds into the two numbers a player thinks in', () => {
    expect(toHoursAndMinutes(4 * 3_600_000 + 30 * 60_000)).toEqual({
      hours: '4',
      minutes: '30',
    });
    expect(toHoursAndMinutes(45 * 60_000)).toEqual({ hours: '0', minutes: '45' });
  });

  it('puts them back together', () => {
    expect(fromHoursAndMinutes('4', '30')).toBe(4 * 3_600_000 + 30 * 60_000);
  });

  it('treats an empty half as zero, so "3 hours" is a 3 and nothing else', () => {
    expect(fromHoursAndMinutes('3', '')).toBe(3 * 3_600_000);
    expect(fromHoursAndMinutes('', '20')).toBe(20 * 60_000);
  });

  it('but both empty is no answer rather than a session of no length', () => {
    expect(fromHoursAndMinutes('', '')).toBeNull();
  });

  it('refuses what it cannot read, and refuses negative time', () => {
    expect(fromHoursAndMinutes('four', '')).toBeNull();
    expect(fromHoursAndMinutes('-2', '')).toBeNull();
    expect(fromHoursAndMinutes('3', '-10')).toBeNull();
  });

  it('accepts a decimal hour, because somebody will type 3.5', () => {
    expect(fromHoursAndMinutes('3.5', '')).toBe(3 * 3_600_000 + 30 * 60_000);
  });
});

/**
 * The guard on a moment that has not happened yet.
 *
 * `2062-09-19` for `2026-09-19` parses and is a real date, so nothing but a
 * range check catches it -- and one costs more than the typo deserves: every
 * later session defaults from the newest start, the recent-stretch verdict is
 * computed over a set that permanently contains it, and the bankroll curve
 * gets a point decades out.
 */
describe('a moment that has not happened yet', () => {
  const NOW = Date.UTC(2026, 8, 21, 12, 0);

  it('is ahead when it is a year out, which is the typo this is for', () => {
    expect(isAhead(Date.UTC(2062, 8, 21, 12, 0), NOW)).toBe(true);
  });

  it('is not ahead when it is in the past, which is every real session', () => {
    expect(isAhead(Date.UTC(2026, 8, 20, 12, 0), NOW)).toBe(false);
  });

  it('and not when it is now, because a session logged as it starts is ordinary', () => {
    expect(isAhead(NOW, NOW)).toBe(false);
  });

  it('tolerates a device clock that is a minute fast', () => {
    expect(isAhead(NOW + 60_000, NOW)).toBe(false);
  });

  it('but not one that is an hour out, which is no longer a clock drifting', () => {
    expect(isAhead(NOW + 3_600_000, NOW)).toBe(true);
  });
});
