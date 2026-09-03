/**
 * The running-session clock.
 *
 * Ticks once a minute, not once a second: the display has minute resolution, and
 * a per-second interval would wake the JS thread 60× more often for no visible
 * change -- which matters on a phone sitting in a pocket for six hours.
 */

import { useEffect, useState } from 'react';

import { formatDuration } from '../../domain/stats';

/**
 * Milliseconds since `startedAt`, or 0 when there is no session. Accepts null so
 * a caller can invoke the hook unconditionally -- as the rules of hooks require --
 * without inventing a start time by reading the clock during render.
 */
export const useElapsed = (startedAt: number | null): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (startedAt === null) return 0;
  return Math.max(0, now - startedAt);
};

export const useElapsedLabel = (startedAt: number | null): string =>
  formatDuration(useElapsed(startedAt));
