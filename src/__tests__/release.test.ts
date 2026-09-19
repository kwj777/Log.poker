/**
 * The build configuration, checked the way the site's config is.
 *
 * Nothing in here is exercised by running the app. `app.json` and `eas.json`
 * are read by a build that happens somewhere else, weeks apart from the change
 * that broke them, and the way they fail is a rejected binary rather than a red
 * test. That is the same shape as `netlify.toml`, which this repository already
 * decided to assert rather than trust, and for the same reason.
 *
 * What is asserted is only the part an app store refuses a build over. Taste
 * lives in the files; this is the floor under them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');
const json = <T>(...parts: string[]): T => JSON.parse(read(...parts)) as T;

interface AppConfig {
  expo: {
    name: string;
    version: string;
    scheme: string;
    icon: string;
    ios: {
      bundleIdentifier: string;
      buildNumber: string;
      supportsTablet: boolean;
      config?: { usesNonExemptEncryption?: boolean };
    };
    android: { package: string; versionCode: number };
    plugins: (string | [string, Record<string, unknown>])[];
    experiments: Record<string, unknown>;
    splash?: unknown;
  };
}

const app = json<AppConfig>('app.json').expo;
const pkg = json<{ dependencies: Record<string, string> }>('package.json');

describe('what the stores identify this build by', () => {
  it('has a version that is a release rather than a placeholder', () => {
    // 0.1.0 shipped for the length of the project and is the default Expo
    // writes. A first submission is 1.0.0, and App Store Connect will not take
    // a second build at a version it has already seen.
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.version).not.toBe('0.1.0');
  });

  it('carries a build number on each platform, which the version cannot stand in for', () => {
    // Two uploads at the same version and the same build number are the same
    // build as far as either store is concerned, and the second is refused.
    expect(app.ios.buildNumber).toMatch(/^\d+$/);
    expect(Number.isInteger(app.android.versionCode)).toBe(true);
    expect(app.android.versionCode).toBeGreaterThan(0);
  });

  it('and package.json agrees, so there is one version to read rather than two', () => {
    // Cosmetic, since the package is private and nothing installs it, and
    // asserted anyway: two version numbers in one repository is a question
    // somebody has to stop and answer every time they read either one.
    expect(json<{ version: string }>('package.json').version).toBe(app.version);
  });

  it('names the same bundle on both, which is the one thing that cannot change later', () => {
    expect(app.ios.bundleIdentifier).toBe('poker.log.app');
    expect(app.android.package).toBe('poker.log.app');
  });

  it('answers the export compliance question in the config rather than at every upload', () => {
    // Log reaches the network over HTTPS and uses HMAC-SHA256 to verify a
    // sign-in token. Both are the exempt kind, so the answer is settled here
    // instead of being a question asked again on every TestFlight build.
    expect(app.ios.config?.usesNonExemptEncryption).toBe(false);
  });
});

describe('the splash screen, which moved out from under the app', () => {
  it('is configured through the plugin, because the old key is no longer read', () => {
    // SDK 57 removed the handling for a top-level `splash`. The key stayed in
    // app.json and did nothing, which is the failure mode worth a test: it
    // does not error, it just launches onto a blank screen.
    const plugin = app.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
    );
    expect(plugin).toBeDefined();
    expect((plugin as [string, Record<string, unknown>])[1]).toMatchObject({
      image: './assets/splash-icon.png',
      backgroundColor: '#1c211f',
    });
  });

  it('and the dead key is gone rather than left to look meaningful', () => {
    expect(app.splash).toBeUndefined();
  });

  it('with the package it needs as a dependency, not just a plugin name', () => {
    expect(pkg.dependencies['expo-splash-screen']).toBeDefined();
  });
});

describe('the dependencies a native build needs and a web build does not', () => {
  it('declares expo-font directly, rather than inheriting it', () => {
    // `@expo/vector-icons` needs it and is on screen from the first frame, in
    // the tab bar. A native module reached only through another package's
    // dependency tree is the crash that passes every web build and every run
    // in Expo Go, which is every check this repository had.
    expect(pkg.dependencies['expo-font']).toBeDefined();
    expect(pkg.dependencies['@expo/vector-icons']).toBeDefined();
  });

  it('and expo-linking, which expo-router requires of its host', () => {
    // Listed here so that reading it as unused does not get it removed. It is
    // a peer dependency of expo-router rather than something this code imports.
    expect(pkg.dependencies['expo-linking']).toBeDefined();
    const router = json<{ peerDependencies: Record<string, string> }>(
      'node_modules',
      'expo-router',
      'package.json',
    );
    expect(router.peerDependencies['expo-linking']).toBeDefined();
  });
});

describe('the build profiles', () => {
  interface Eas {
    cli: { appVersionSource: string };
    build: Record<string, { distribution?: string; autoIncrement?: boolean; extends?: string }>;
    submit: Record<string, unknown>;
  }
  const eas = json<Eas>('eas.json');

  it('keeps the version in the repository rather than on a server', () => {
    // So `app.json` above stays the thing you can read to know what is
    // shipping, and `autoIncrement` writes its answer back into this tree.
    expect(eas.cli.appVersionSource).toBe('local');
  });

  it('has one profile that builds for a store and increments on its own', () => {
    expect(eas.build.production?.distribution).toBe('store');
    expect(eas.build.production?.autoIncrement).toBe(true);
  });

  it('and one that needs no Apple account, which is the only build available first', () => {
    expect(eas.build.simulator).toBeDefined();
  });

  it('has a submit profile, even though its credentials are not in the repository', () => {
    // Apple IDs and team IDs are account facts rather than project facts, and
    // `eas submit` prompts for them. The empty profile is what makes
    // `--profile production` a valid thing to type.
    expect(eas.submit.production).toBeDefined();
    expect(read('eas.json')).not.toMatch(/appleTeamId|ascAppId/);
  });

  it('pins the Node the rest of the project pins', () => {
    const base = json<{ build: { base: { node: string } } }>('eas.json').build.base.node;
    expect(base.split('.')[0]).toBe('22');
    expect(read('netlify.toml')).toContain('NODE_VERSION = "22"');
  });
});

describe('the app icon', () => {
  /** Width, height and PNG color type, read out of the IHDR chunk. */
  const ihdr = (path: string): { width: number; height: number; colorType: number } => {
    const png = readFileSync(join(ROOT, path));
    return {
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      colorType: png[25] as number,
    };
  };

  it('is 1024 square, which is the only size the App Store takes', () => {
    const { width, height } = ihdr('assets/icon.png');
    expect([width, height]).toEqual([1024, 1024]);
  });

  it('and has no alpha channel, which is the one App Store Connect rejects over', () => {
    // Color type 2 is RGB; 6 is RGBA. The icon had a channel with nothing
    // translucent in it, which is the version of this that is easy to miss.
    expect(ihdr('assets/icon.png').colorType).toBe(2);
    expect(ihdr('public/icons/apple-touch-icon.png').colorType).toBe(2);
  });

  it('while the icons that need transparency keep it', () => {
    // The same encoder writes all of them, and it decides by reading the
    // pixels. A flag would be the thing that flattens an adaptive icon.
    for (const path of [
      'assets/android-icon-foreground.png',
      'assets/android-icon-monochrome.png',
      'assets/splash-icon.png',
      'assets/mark.png',
    ]) {
      expect(ihdr(path).colorType).toBe(6);
    }
  });
});
