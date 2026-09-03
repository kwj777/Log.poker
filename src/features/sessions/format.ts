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

/** `Today`, `Yesterday`, or the date -- how a player refers to their own sessions. */
export const formatRelativeDay = (timestamp: number, now: number = Date.now()): string => {
  const startOfDay = (value: number): number => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatSessionDate(timestamp, now);
};
