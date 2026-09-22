/**
 * The native modules that are compiled but never imported.
 *
 * `react-native-reanimated` and `react-native-worklets` are in this app for a
 * reason nobody chose: they are optional peer dependencies of `expo-router`
 * and `@expo/ui`, declared as `*`, so npm installs whatever is newest. Nothing
 * in `app/` or `src/` imports either one and there is no Babel plugin for
 * reanimated, but Expo autolinks every native module it finds, so both are
 * compiled into the binary regardless.
 *
 * On 2026-09-22 that took the first EAS build down. npm had resolved
 * reanimated 4.6.0, which requires worklets 0.12.x, while
 * `expo-modules-core@57` compiles a call to `WorkletRuntime::executeSync` and
 * accepts worklets up to 0.10. The member does not exist in 0.12, so
 * `ExpoWorkletsBridgeProvider.mm` failed to compile, twenty minutes into a
 * build on somebody else's machine.
 *
 * None of that is visible from here: `npx expo export` bundles JavaScript and
 * never touches the C++, and `npm ls` reports it as a warning nobody reads.
 * What follows is the check that would have caught it, in the one place that
 * runs on every commit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import semver from 'semver';

const ROOT = join(__dirname, '..', '..');
const json = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8')) as T;

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const installed = (name: string) => json<Manifest>('node_modules', name, 'package.json');
const declared = json<{ dependencies: Record<string, string> }>('package.json').dependencies;

/** What SDK 57 ships with, which is the pairing Expo builds and tests. */
const bundled = json<Record<string, string>>(
  'node_modules',
  'expo',
  'bundledNativeModules.json',
);

describe('the worklets runtime, which is compiled whether or not it is used', () => {
  it('is a version expo-modules-core can call into', () => {
    // The assertion that maps onto the compiler error. `expo-modules-core`
    // names the range it built against; anything outside it is a native build
    // failure rather than a runtime one, so no test that renders can see it.
    const range = installed('expo-modules-core').peerDependencies?.['react-native-worklets'];
    expect(range).toBeDefined();
    expect(semver.satisfies(installed('react-native-worklets').version, range as string)).toBe(
      true,
    );
  });

  it('and one reanimated agrees with, since npm resolves them separately', () => {
    // Both sides have to hold at once. Reanimated pins worklets tightly and is
    // what dragged 0.12 in, so pinning only worklets moves the conflict rather
    // than closing it.
    const range = installed('react-native-reanimated').peerDependencies?.[
      'react-native-worklets'
    ];
    expect(range).toBeDefined();
    expect(semver.satisfies(installed('react-native-worklets').version, range as string)).toBe(
      true,
    );
  });
});

describe('both of them, in package.json', () => {
  it('are pinned exactly, because a caret is what let this happen', () => {
    // They were `^4.5.1` and `^0.10.1` for about a minute. `^4.5.1` admits
    // 4.6.0, which is the version that broke the build, so a later `npm
    // install` on a clean checkout would have reintroduced it with nothing
    // changed in the repository to explain it.
    expect(declared['react-native-reanimated']).toBe('4.5.1');
    expect(declared['react-native-worklets']).toBe('0.10.1');
  });

  it('and are held at what this Expo SDK ships, not at what npm calls latest', () => {
    // Neither is imported anywhere, so there is no feature here worth being
    // ahead of the SDK for. The SDK's own map is the authority.
    expect(declared['react-native-reanimated']).toBe(bundled['react-native-reanimated']);
    expect(declared['react-native-worklets']).toBe(bundled['react-native-worklets']);
  });
});
