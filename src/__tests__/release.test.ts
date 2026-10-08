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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
    android: {
      package: string;
      versionCode: number;
      blockedPermissions?: string[];
      edgeToEdgeEnabled?: unknown;
    };
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

describe('the Android build, which Google Play reads before anyone does', () => {
  it('declines the permissions the Expo template asks for and Log never uses', () => {
    // A bare `expo prebuild` writes storage read and write and "draw over other
    // apps" into the manifest. Log reads a CSV through the system picker and
    // writes one through the share sheet, neither of which needs storage, and
    // it draws nothing outside itself. Each permission left in is a line the
    // Play listing shows and a question the Data safety form makes somebody
    // answer, for a capability the app does not have.
    expect(app.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ]),
    );
  });

  it('draws the navigation bar dark, under light buttons, with no scrim', () => {
    // Found on the first Android phone: three-button navigation sat on a pale
    // gray band under a dark app. React Native's edge-to-edge setup gives the
    // bar a scrim and picks its shade from whether the window starts in night
    // mode, which on that phone it did not, so the bottom of every screen got
    // a white wash. With the scrim off, the tab bar's surface shows through
    // behind the buttons, and `style: light` keeps them readable on it from
    // Android 10 up. Android 8 and 9 need the same thing said at runtime,
    // which the root layout does; see `app/_layout.tsx`.
    const plugin = app.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-navigation-bar',
    ) as [string, Record<string, unknown>] | undefined;
    expect(plugin?.[1]).toEqual({ style: 'light', enforceContrast: false });
    expect(pkg.dependencies['expo-navigation-bar']).toBeDefined();
    expect(read('app', '_layout.tsx')).toContain('<NavigationBar style="light" />');
  });

  it('and carries no edge to edge switch, which Android 16 took away', () => {
    // SDK 57's prebuild warns that the key is no longer read: edge to edge is
    // mandatory now. Left in, it reads as a choice somebody could turn off.
    expect(app.android.edgeToEdgeEnabled).toBeUndefined();
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

describe('the images checked in beside the app', () => {
  it('are each named by something that is not the script that draws them', () => {
    // `android-icon-background.png` was 17.5 KB of nothing: no
    // `adaptiveIcon.backgroundImage` key in app.json, no line in
    // `generate-icons.mjs`, no mention anywhere in the tree. Expo never read
    // it, so it shipped nowhere and broke nothing -- it just sat in the
    // repository at 512x512 RGBA beside two 432x432 layers it was supposed to
    // go behind, drifting from the palette `palette.test.ts` pins.
    //
    // The script is excluded from counting as a reader on purpose. A file it
    // draws and nothing consumes is the same dead weight one step later,
    // which is what `favicon.png` became the day `app.json` stopped naming
    // it.
    // Tests are not readers. This one names both of the files it was written
    // for, a few lines up, and would otherwise vouch for them itself.
    const script = read('scripts', 'generate-icons.mjs');
    const readers = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(
        (path) =>
          path !== '' &&
          !path.startsWith('assets/') &&
          !path.includes('__tests__') &&
          path !== 'scripts/generate-icons.mjs',
      );

    const orphans = readdirSync(join(ROOT, 'assets')).filter((name) => {
      const named = readers.some((path) => read(...path.split('/')).includes(name));
      return !named;
    });

    expect(orphans).toEqual([]);
    // And everything left really is drawn rather than hand-placed, so the
    // palette test's reach over the script is the reach over these files.
    for (const name of readdirSync(join(ROOT, 'assets'))) expect(script).toContain(name);
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
    build: Record<
      string,
      {
        distribution?: string;
        autoIncrement?: boolean;
        extends?: string;
        developmentClient?: boolean;
        ios?: { simulator?: boolean; image?: string };
        android?: { buildType?: string };
        env?: Record<string, string>;
      }
    >;
    submit: Record<
      string,
      { ios?: { ascAppId?: string }; android?: { track?: string; releaseStatus?: string } }
    >;
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
    // This asserted only that the profile existed, which is true of a profile
    // that has lost both of the things its name is about. `ios.simulator` is
    // what makes it buildable with no Apple Developer account, and `internal`
    // is what stops it going near a store; a profile stripped to `extends` and
    // `developmentClient` passed the old assertion unchanged.
    expect(eas.build.simulator?.ios?.simulator).toBe(true);
    expect(eas.build.simulator?.distribution).toBe('internal');
  });

  it('names the app to submit to, and still no account of its own', () => {
    // This profile was empty, on the reasoning that `eas submit` prompts for
    // everything it needs. It does not prompt for this one. Before uploading
    // anything it looks the app up on App Store Connect, and that lookup is a
    // different Apple endpoint from the one that uploads: on 2026-09-22 it
    // answered 403, "the API key in use does not allow this request", and the
    // submission stopped before the binary was sent. `ascAppId` is the
    // documented way past it, because a profile that names the app skips the
    // lookup entirely.
    //
    // It belongs here in a way the other two do not. An App Store ID is a
    // project fact: it identifies this app, it is public in every App Store
    // URL, and log.poker will carry it in a smart app banner the day this is
    // approved. An Apple ID and a team ID are facts about whoever is doing the
    // submitting, so those stay out and `eas submit` goes on asking for them.
    expect(eas.submit.production?.ios?.ascAppId).toBe('6814843842');
    expect(read('eas.json')).not.toMatch(/appleTeamId|appleId/);
  });

  it('builds an Android App Bundle for the store and an APK to install by hand', () => {
    // Play takes only a bundle for a new app. A bundle cannot be installed on a
    // phone directly, so the preview profile builds an APK instead: that is the
    // build to sideload and open before anything goes to Play.
    expect(eas.build.production?.android?.buildType).toBe('app-bundle');
    expect(eas.build.preview?.android?.buildType).toBe('apk');
  });

  it('submits to Play as a draft on the internal track, and holds no key for it', () => {
    // An app Play has never reviewed refuses any release that is not a draft,
    // and internal testing is the track a build can reach without review. The
    // service account key is a credential, so it lives in EAS rather than here.
    expect(eas.submit.production?.android).toEqual({ track: 'internal', releaseStatus: 'draft' });
    expect(read('eas.json')).not.toMatch(/serviceAccountKey/);
  });

  it('has a profile for screenshots, which neither of the other two could take', () => {
    // A development run has the seeder and draws Expo Go's floating dev button
    // over every shot. A Release build is clean and has `__DEV__` false, so the
    // Load demo data card is never drawn and there is no bankroll to put behind
    // the screens that exist to show one. This is the third combination.
    const profile = eas.build.screenshots;

    expect(profile?.developmentClient).toBe(false);
    expect(profile?.ios?.simulator).toBe(true);
    expect(profile?.env?.EXPO_PUBLIC_DEMO_SEED).toBe('true');
  });

  it('and no profile that builds for a store carries that variable', () => {
    // The whole safety of the flag is here rather than in `config.ts`.
    // `ALLOW_DEMO_SEED` reads `EXPO_PUBLIC_DEMO_SEED`, Metro inlines it while
    // the bundle is built, and a profile that declares no `env` leaves it
    // undefined -- which is what keeps the demo out of a submitted binary.
    // Asserted over every store profile rather than over `production` by name,
    // so a second one cannot be added without this looking at it too.
    const store = Object.entries(eas.build).filter(
      ([, profile]) => profile.distribution === 'store',
    );

    expect(store.length).toBeGreaterThan(0);
    for (const [name, profile] of store) {
      expect([name, profile.env]).toEqual([name, undefined]);
    }
  });

  it('pins the Xcode, because the newest one builds a binary that cannot launch', () => {
    // Xcode 27's SDK makes the UIScene life cycle mandatory, and Expo SDK 57
    // still generates an AppDelegate with no `UIApplicationSceneManifest`, so
    // an app built with it fails at launch rather than at compile: "UIScene
    // life cycle is required for apps built with this SDK". The backport is
    // expo/expo#50026 and is an unmerged draft, so there is no version of this
    // to install. EAS's default image is Xcode 26.6, which is the only reason
    // a production build works at all today.
    //
    // An exact name rather than an alias is the whole point. `auto`, `latest`
    // and `sdk-57` all move on Expo's schedule, and the day one of them lands
    // on Xcode 27 the binary Apple receives is one that does not open, with
    // nothing in this repository having changed.
    const image = eas.build.production?.ios?.image;

    expect(image).toMatch(/^macos-[a-z]+-[\d.]+-xcode-\d+\.\d+$/);
    // The device build is what proves the production one launches, so it has
    // to be built the same way for that proof to mean anything.
    expect(eas.build.preview?.ios?.image).toBe(image);
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

  it('and the Play feature graphic is the size and format Play Console takes', () => {
    // 1024 by 500 exactly, and a 24-bit PNG: Play refuses one with an alpha
    // channel, and resvg, which draws it, writes one unless told otherwise.
    expect(ihdr('design/play-feature-graphic.png')).toEqual({
      width: 1024,
      height: 500,
      colorType: 2,
    });
    expect(read('PLAY.md')).toContain('design/play-feature-graphic.png');
  });
});

/**
 * The seeder flag, which is the one build constant a profile can turn on.
 *
 * Read back through a fresh module registry rather than asserted as source
 * text, because the question is what the constant evaluates to for a given
 * environment, and a regular expression over `config.ts` would answer a
 * different one. `src/config.ts` imports nothing, so it loads in plain Node.
 */
describe('the demo seeder flag', () => {
  const evaluate = async (value: string | undefined): Promise<boolean> => {
    const before = process.env.EXPO_PUBLIC_DEMO_SEED;
    if (value === undefined) delete process.env.EXPO_PUBLIC_DEMO_SEED;
    else process.env.EXPO_PUBLIC_DEMO_SEED = value;

    let allowed = false;
    await jest.isolateModulesAsync(async () => {
      ({ ALLOW_DEMO_SEED: allowed } = await import('../config'));
    });

    if (before === undefined) delete process.env.EXPO_PUBLIC_DEMO_SEED;
    else process.env.EXPO_PUBLIC_DEMO_SEED = before;
    return allowed;
  };

  it('is off when nothing asks for it, which is every store build', async () => {
    await expect(evaluate(undefined)).resolves.toBe(false);
  });

  it('is on for the build that asks for it by name', async () => {
    await expect(evaluate('true')).resolves.toBe(true);
  });

  it('and takes only that one word, so a stray value cannot arm it', async () => {
    // `1`, `yes` and `false` all read as not asking. A truthiness check would
    // have armed the demo on two of those, and on any value a profile carried
    // for some other reason.
    await expect(evaluate('1')).resolves.toBe(false);
    await expect(evaluate('yes')).resolves.toBe(false);
    await expect(evaluate('false')).resolves.toBe(false);
  });
});
