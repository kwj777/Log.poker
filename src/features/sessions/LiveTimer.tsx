/**
 * The running-session clock.
 *
 * Ticks once a minute, not once a second: the display has minute resolution, and
 * a per-second interval would wake the JS thread 60x more often for no visible
 * change -- which matters on a phone sitting in a pocket for six hours.
 */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Milliseconds since `startedAt`, or 0 when there is no session. Accepts null so
 * a caller can invoke the hook unconditionally -- as the rules of hooks require --
 * without inventing a start time by reading the clock during render.
 *
 * ## Why the clock is also read on the way back
 *
 * A once-a-minute interval is the right tick rate and the wrong wake-up.
 * iOS suspends JS timers the moment the app leaves the front, so a phone that
 * has been in a pocket for four hours comes back holding a `now` from four
 * hours ago, and the interval does not fire again for up to a full minute.
 * For that minute the live session screen shows an elapsed time that is hours
 * short, which is the one number somebody reopens this app to read.
 *
 * `AppState` closes that window: coming back to the front reads the clock
 * immediately, so the first frame after a resume is already right. react-native-web
 * implements `AppState` over `visibilitychange`, so a browser tab being
 * reselected is the same event and gets the same correction.
 *
 * Both subscriptions live in one effect because they do one job between them,
 * and neither depends on anything that changes.
 */
export const useElapsed = (startedAt: number | null): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      // Optional, because react-native-web hands back nothing at all when
      // there is no DOM to listen to, which is what a prerender is. The root
      // layout guards its own `AppState` subscription the same way.
      subscription?.remove();
    };
  }, []);

  if (startedAt === null) return 0;
  return Math.max(0, now - startedAt);
};
