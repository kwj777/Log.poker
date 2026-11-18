/**
 * Take the portrait lock off Android's manifest, and only Android's.
 *
 * `"orientation": "portrait"` in app.json writes
 * `android:screenOrientation="portrait"` on MainActivity. Play Console's
 * Android vitals flags that ("Remove resizability and orientation
 * restrictions"), and Android 16 ignores it on tablets, foldables and
 * Chromebooks anyway (smallest width 600dp and up), so on those screens the
 * lock was only ever a warning.
 *
 * Phones still stay in portrait, from the first frame: MainActivity asks for
 * portrait before `super.onCreate` when the screen's smallest width is under
 * 600dp, which is what the manifest used to do for every screen. Asked in
 * code, it is not a manifest restriction, so Play has nothing to flag. Left
 * to JavaScript alone, a phone held sideways at launch would draw the splash
 * and the first screen in landscape and then turn. `src/orientation.android.ts`
 * keeps the lock right afterwards, as a foldable opens and closes.
 *
 * iOS keeps the app.json value untouched, because `orientation` is one key
 * for both platforms and the iPhone build ships with no tablet support.
 */
const { withAndroidManifest, withMainActivity, AndroidConfig } = require('expo/config-plugins');

const MARKER = '// log.poker: phones start upright';
const LOCK = `    ${MARKER} (plugins/withAndroidAnyOrientation.js)
    if (resources.configuration.smallestScreenWidthDp < 600) {
      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
`;

/** Puts the phone lock first in `onCreate`. Exported for the test. */
function addPhoneLock(source) {
  if (source.includes(MARKER)) return source;
  const onCreate = /(override fun onCreate\(savedInstanceState: Bundle\?\) \{\n)/;
  if (!onCreate.test(source)) {
    throw new Error('withAndroidAnyOrientation: no Kotlin onCreate in MainActivity to lock phones in');
  }
  return source.replace(onCreate, `$1${LOCK}`);
}

/** Drops the manifest's orientation lock from the main activity. Exported for the test. */
function removeManifestLock(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  delete activity.$['android:screenOrientation'];
  return manifest;
}

function withAndroidAnyOrientation(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = removeManifestLock(mod.modResults);
    return mod;
  });
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('withAndroidAnyOrientation: MainActivity is not Kotlin');
    }
    mod.modResults.contents = addPhoneLock(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidAnyOrientation;
module.exports.addPhoneLock = addPhoneLock;
module.exports.removeManifestLock = removeManifestLock;
