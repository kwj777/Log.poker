/**
 * The running-session clock.
 *
 * Ticks once a minute, not once a second: the display has minute resolution, and
 * a per-second interval would wake the JS thread 60× more often for no visible
 * change — which matters on a phone sitting in a pocket for six hours.
 */

import { useEffect, useState } from 'react';

import { formatDuration } from '../../domain/stats';

export const useElapsed = (startedAt: number): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  return Math.max(0, now - startedAt);
};

export const useElapsedLabel = (startedAt: number): string => formatDuration(useElapsed(startedAt));
