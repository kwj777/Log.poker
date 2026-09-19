/**
 * Which build of Log this is, in one line a person can read out loud.
 *
 * ## Why this is on the screen at all
 *
 * It is the first thing anybody asks about a bug and the last thing anybody
 * can find out. A report that says "the timer was wrong" and one that says
 * "1.0.0 (3), the timer was wrong" are different reports, and the difference
 * costs nothing to supply. App Review asks for the same thing from the other
 * direction: a build it can name is a build it can talk about.
 *
 * ## Why it reads the config rather than a constant
 *
 * `app.json` is the source of truth, and `production` in `eas.json` increments
 * the build number in it on every build. A number typed here as well would be
 * a second copy that goes stale the first time a build is made, which is the
 * failure this repository keeps a generator around to avoid.
 *
 * `Constants.expoConfig` is what carries that file into the bundle. The
 * deprecated `nativeAppVersion` and `nativeBuildVersion` would read the value
 * the binary was actually stamped with, which is the more truthful number
 * where the two can disagree, but they now live in `expo-application` and a
 * native module is not worth one line of caption.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * The platform's own word for the number beside the version.
 *
 * iOS and Android call it different things and keep it in different types, and
 * on web there is no such number at all: a browser loads whatever the deploy
 * is serving, so the version alone is the whole answer.
 */
const buildNumber = (): string | null => {
  const config = Constants.expoConfig;
  if (config == null) return null;
  if (Platform.OS === 'ios') return config.ios?.buildNumber ?? null;
  if (Platform.OS === 'android') {
    const code = config.android?.versionCode;
    return typeof code === 'number' ? String(code) : null;
  }
  return null;
};

/**
 * `Log 1.0.0 (1)` on a phone, `Log 1.0.0` on the web.
 *
 * Falls back to the version alone rather than to an empty string, because a
 * caption that has lost its build number is still worth more than no caption,
 * and `expoConfig` is typed as nullable for reasons that do not apply to a
 * shipped build but do apply to a test.
 */
export const releaseLabel = (): string => {
  const version = Constants.expoConfig?.version ?? null;
  if (version === null) return 'Log';
  const build = buildNumber();
  return build === null ? `Log ${version}` : `Log ${version} (${build})`;
};
