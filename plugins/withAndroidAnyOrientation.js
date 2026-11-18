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
 * Phones still stay in portrait: `src/orientation.android.ts` locks them at
 * runtime, and only them. iOS keeps the app.json value untouched, because
 * `orientation` is one key for both platforms and the iPhone build ships with
 * no tablet support.
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withAndroidAnyOrientation(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    delete activity.$['android:screenOrientation'];
    return mod;
  });
};
