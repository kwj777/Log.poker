/**
 * Keep Android phones in portrait without locking the manifest.
 *
 * The manifest lock is gone (`plugins/withAndroidAnyOrientation.js`), because
 * Play flags it and Android 16 ignores it on large screens. Phones were never
 * the problem, and the screens are laid out for a phone held upright.
 * MainActivity locks a phone before the first frame; this keeps that lock
 * true afterwards, when a foldable crosses the line one way or the other.
 *
 * "Phone" is a shortest side under 600dp, the line Android itself draws for
 * large screens. A foldable crosses it when it opens and closes, so the lock
 * follows the screen: on when folded, off when open.
 *
 * Android only, by file name. iOS is portrait from app.json and its build
 * does not link the module at all (`expo.autolinking.ios.exclude` in
 * package.json), so importing it there would throw; `orientation.ts` is the
 * do-nothing version iOS and the web get.
 */

import { useEffect } from 'react';
import { Dimensions } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

/** Android's large-screen line, in dp. */
const LARGE_SCREEN_DP = 600;

function isPhoneSized(width: number, height: number): boolean {
  return Math.min(width, height) < LARGE_SCREEN_DP;
}

function apply(): void {
  const { width, height } = Dimensions.get('screen');
  const lock = isPhoneSized(width, height)
    ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
    : ScreenOrientation.unlockAsync();
  // A failed lock leaves the app rotating, which is a nuisance, not a fault.
  lock.catch(() => undefined);
}

export function usePhonePortrait(): void {
  useEffect(() => {
    apply();
    const subscription = Dimensions.addEventListener('change', apply);
    return () => subscription.remove();
  }, []);
}
