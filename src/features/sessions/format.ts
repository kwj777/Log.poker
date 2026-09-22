/** Date and time strings, kept in one place so every screen phrases them alike. */

const DAY = 86_400_000;

/** `Sat 12 Apr` -- no year unless the session is from another one. */
export const formatSessionDate = (timestamp: number, now: number = Date.now()): string => {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

export const formatTimeOfDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * `Sat 12 Apr - 11:40 PM`, or `Sat 12 Apr - 2:15 AM Sun 13 Apr` when it ran
 * past midnight.
 *
 * The end used to be a bare time of day, which on a night that crossed
 * midnight read "10:00 PM - 4:00 PM": a range that appears to run backwards,
 * on a screen whose whole subject is one night. Overnight is not a corner here
 * -- `active.tsx` treats twelve hours as the point at which a session is
 * probably a forgotten timer, which is to say eleven is a session somebody
 * really played, and the edit screen's own copy is about a phone that went in
 * a pocket until the next afternoon.
 *
 * The duration tile below it was right the whole time, so nobody was misled
 * about how long they sat. They were misled about what the header said.
 */
export const formatSessionSpan = (
  startedAt: number,
  endedAt: number | null,
  now: number = Date.now(),
): string => {
  const started = `${formatSessionDate(startedAt, now)} · ${formatTimeOfDay(startedAt)}`;
  if (endedAt === null) return started;
  const sameDay = new Date(endedAt).toDateString() === new Date(startedAt).toDateString();
  const ended = formatTimeOfDay(endedAt);
  return sameDay ? `${started} - ${ended}` : `${started} - ${formatSessionDate(endedAt, now)} · ${ended}`;
};

/** `Today`, `Yesterday`, or the date -- how a player refers to their own sessions. */
export const formatRelativeDay = (timestamp: number, now: number = Date.now()): string => {
  const startOfDay = (value: number): number => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY);
  // Ahead of today falls through to the date, before the branch below it.
  // Every future timestamp makes `days` negative and every negative number is
  // less than seven, so a row dated 2062 read "-13146 days ago" -- in the row
  // caption and, twice as badly, in the screen-reader label beside it.
  //
  // There is no wording that would be right here instead. A moment that has
  // not happened is a typed year, which is what `isAhead` and
  // `FUTURE_TOLERANCE_MS` exist for, and the date is the one thing that shows
  // the player what they actually entered.
  if (days < 0) return formatSessionDate(timestamp, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatSessionDate(timestamp, now);
};
