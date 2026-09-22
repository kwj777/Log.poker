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
import { existsSync, readFileSync } from 'node:fs';
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
    userInterfaceStyle: string;
    ios: {
      bundleIdentifier: string;
      buildNumber: string;
      supportsTablet: boolean;
      config?: { usesNonExemptEncryption?: boolean };
    };
    android: { package: string; versionCode: number };
    web: Record<string, unknown>;
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

  it('ships iPhone only, which is what the screenshot set was cut down to match', () => {
    // Decided for 1.0 and asserted because the two halves live apart: this
    // flag decides what Apple reviews, and SUBMISSION.md decides what gets
    // photographed. Turning it back on is one character and would silently
    // leave the submission a whole size of screenshot short, which App Store
    // Connect refuses at upload rather than at the edit that caused it.
    expect(app.ios.supportsTablet).toBe(false);
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

  it('offers no dark variant, which would quietly unlock the app from dark mode', () => {
    // There was one, and its image and background were byte for byte the light
    // ones, so it looked like harmless duplication. It was not. A dark variant
    // makes the plugin write `UIUserInterfaceStyle = Automatic` into
    // Info.plist, which overrides the `userInterfaceStyle: "dark"` three lines
    // up in the same file, and `expo prebuild` says so in a warning that reads
    // like it is about the splash screen.
    //
    // The app would still draw its own dark palette, because that is a fixed
    // theme rather than a response to the system. What follows the system is
    // everything iOS draws: the keyboard, the share sheet, the alerts, the
    // selection handles. A light keyboard under a dark app, on a light mode
    // phone, and nowhere else.
    //
    // Expo Go cannot show this, since it carries its own Info.plist, so the
    // first place it could ever have appeared is the first real build.
    const plugin = app.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
    ) as [string, Record<string, unknown>];

    expect(plugin[1].dark).toBeUndefined();
    expect(app.userInterfaceStyle).toBe('dark');
  });

  it('with the package it needs as a dependency, not just a plugin name', () => {
    expect(pkg.dependencies['expo-splash-screen']).toBeDefined();
  });
});

describe('the web block, which is read by less of the toolchain than it looks', () => {
  it('declares only the keys a Metro static export actually reads', () => {
    // The same failure as `splash` above, in the same file. `app/+html.tsx`
    // replaces Expo's HTML template, so the path that would have written
    // `web.name`, `web.themeColor` and `web.description` into every page is
    // never taken, and a static export emits no manifest of its own -- the one
    // in `dist/` is `public/manifest.webmanifest`, copied. So those keys, plus
    // `shortName` and `backgroundColor`, reached nothing at all.
    //
    // Measured rather than argued: deleting them changed the export by zero
    // bytes across all ninety files.
    //
    // Which is exactly why it is worth a line here. Nothing was wrong on
    // screen, and nothing would have told somebody editing the file
    // `src/version.ts` calls "the source of truth" that their edit had gone
    // nowhere. The copy that is read lives in `public/manifest.webmanifest`
    // and `app/+html.tsx`.
    expect(Object.keys(app.web).sort()).toEqual(['bundler', 'output']);
  });

  it('and declares no favicon, because the shell already declares one', () => {
    // `web.favicon` generated `dist/app/favicon.ico` and a `<link rel="icon">`
    // appended after the shell's head, so every one of the nineteen exported
    // /app documents carried two conflicting icon declarations and left the
    // choice to the browser. In the one file that goes out of its way to
    // avoid a duplicated head tag -- `+html.tsx` says two `<title>` elements
    // would be wrong because "the browser reads the first".
    //
    // The one that stays is the shell's `/icons/icon-192.png`, which the
    // manifest, the apple-touch-icon and all nine marketing pages already
    // agree on. The generated `.ico` topped out at 48px.
    expect(app.web.favicon).toBeUndefined();
    expect(read('app', '+html.tsx')).toContain('<link rel="icon" href="/icons/icon-192.png"');
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

describe('the links the app has told the operating system it answers', () => {
  it('declares a scheme, which is what makes a logpoker:// link reach the app', () => {
    expect(app.scheme).toBe('logpoker');
  });

  it('and has somewhere for a link that names nothing to land', () => {
    // Without this file the framework's own unmatched screen answers -- a
    // debugging aid in its default styling, saying "Unmatched Route" to
    // somebody who tapped a link a friend sent them. The scheme means any
    // `logpoker://` URL at all arrives here, whether or not it is one of ours.
    expect(existsSync(join(ROOT, 'app', '+not-found.tsx'))).toBe(true);
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
