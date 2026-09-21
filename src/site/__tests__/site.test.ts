/**
 * log.poker is a marketing site with an app under /app, and that split is held
 * together by four files that have to agree: the build script that moves the
 * export, netlify.toml, the manifest, and the service worker.
 *
 * They fail quietly when they disagree. A manifest still scoped to / installs
 * the marketing page as the app. A worker whose shell URL points at the old
 * root caches nothing and loses offline without erroring. Neither shows up in a
 * type check or a render, so they are asserted here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOTTOM_BAR_ID, FAMILY_LINKS, FAMILY_HOME, GUIDES } from '../../config';

const ROOT = join(__dirname, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const netlify = read('netlify.toml');
const home = read('public', 'home.html');
const worker = read('public', 'sw.js');
/** Every function that claims a path of its own, read as one string. */
const functions = ['signin.mts', 'sync.mts', 'signin-sweep.mts', 'chip-scan.mjs']
  .map((name) => read('netlify', 'functions', name))
  .join('\n');
const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
const buildScript = read('scripts', 'build-web.mjs');

/**
 * Ways of promising that nothing is sent anywhere, which sync made false.
 *
 * Named as a list because the first sweep was written as three literal
 * sentences, and the claim had been made in more than three: a post saying
 * "it never sends your log anywhere" was making it in words no pattern was
 * looking for. What the sweep has to match is the promise, not its wording.
 */
const BROKEN_PROMISES = [
  /never leaves your device/i,
  /no server to send anything to/i,
  /keeps everything on your device/i,
  /never sends? (?:your log |anything |it )?anywhere/i,
  /no account, no server,? and no network call/i,
];

/** Where a `from = "..."` rule sits in netlify.toml, or -1. */
const ruleAt = (from: string): number => netlify.indexOf(`from = "${from}"`);

describe('the front door', () => {
  it('is a static file, not the app', () => {
    expect(existsSync(join(ROOT, 'public', 'home.html'))).toBe(true);
    // The bundler writes an index.html of its own, so the marketing page cannot
    // be called index.html in public/ or one of the two silently wins.
    expect(existsSync(join(ROOT, 'public', 'index.html'))).toBe(false);
    expect(buildScript).toContain("const HOME = 'home.html';");
  });

  it('renders with nothing fetched, not even a font', () => {
    expect(home).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(home).not.toMatch(/<link[^>]+stylesheet/i);
    expect(home).not.toMatch(/@import|fonts\.(googleapis|gstatic)\.com/i);
  });

  it('names the three apps, in L, O, G order', () => {
    const apps = home.slice(home.indexOf('<div class="apps">'), home.indexOf('</section>'));
    expect(apps.indexOf('TiltProof')).toBeLessThan(apps.indexOf('>Log<'));
    expect(apps.indexOf('>Log<')).toBeLessThan(apps.indexOf('Untilt'));
  });

  it('sends people to the app rather than to itself', () => {
    expect(home).toContain('<a class="btn" href="/app">');
  });

  it('quotes no price', () => {
    // Somebody who has used none of the three has no way to value one.
    expect(home).not.toMatch(/\$\s*\d/);
  });

  it('but still says how much of each app is free', () => {
    // The other half of the same rule, and the one that had been lost: two of
    // the three are paid past a point, so a page that says "free" once at the
    // bottom is making a promise on behalf of the two that do not keep it.
    const apps = home.slice(home.indexOf('<div class="apps">'), home.indexOf('</section>'));
    const cards = apps.split('<a class="app').slice(1);
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card).toMatch(/\bfree\b/i);
  });

  it('does not claim there is no server, now that there is one', () => {
    // This replaces a test named "claims no server, which is true until sync
    // ships", whose comment called it the tripwire for exactly this day. It
    // asserted the sentence was PRESENT, so it fired when somebody edited the
    // copy and never when somebody shipped the server. Sync went live and it
    // went on passing, with `Log has no server to send anything to` on the
    // front page of a site whose whole argument is that it does not lie to you.
    //
    // A tripwire has to be anchored to the thing that makes the claim false,
    // not to the claim. See SYNC.md, "What must not break".
    expect(existsSync(join(ROOT, 'netlify', 'functions', 'sync.mts'))).toBe(true);
    expect(home).not.toMatch(/no server to send anything to/i);
    expect(home).not.toMatch(/never leaves your device/i);
    expect(home).toMatch(/[Nn]othing leaves your device unless you sign in/);
  });

  it('and neither does any other page that carries the same line', () => {
    // The claim was on four pages and in the app, because the call to action
    // is copied rather than shared. Every one of them is a page somebody could
    // arrive on, and `chip.html` is the one a physical object points at.
    for (const page of ['home.html', 'chip.html', 'running-bad.html', '404.html']) {
      const path = join(ROOT, 'public', page);
      if (!existsSync(path)) continue;
      for (const promise of BROKEN_PROMISES) expect(readFileSync(path, 'utf8')).not.toMatch(promise);
    }
    // And the two generators that stamp it onto everything else.
    for (const script of ['build-blog.mjs', 'build-content.mjs']) {
      const text = readFileSync(join(ROOT, 'scripts', script), 'utf8');
      expect(text).not.toMatch(/never leaves your device/i);
      expect(text).not.toMatch(/keeps everything on your device/i);
    }
    // And the posts, which the sweep missed twice over. They were not on the
    // list, and they had phrased the promise in words the list did not hold:
    // "it never sends your log anywhere" says the same thing as "no server to
    // send anything to" and matched none of the patterns looking for it. A
    // sweep anchored to three sentences finds three sentences.
    for (const post of readdirSync(join(ROOT, 'content', 'blog')).filter((name) => name.endsWith('.md'))) {
      const text = readFileSync(join(ROOT, 'content', 'blog', post), 'utf8');
      for (const promise of BROKEN_PROMISES) expect(text).not.toMatch(promise);
    }
    // And the README, which had it too and was missed by the first sweep,
    // because the first sweep looked at the places a visitor lands rather than
    // at every place the sentence was written. The list is what makes this a
    // sweep; leaving one out is how the claim survived in five places to begin
    // with.
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(readme).not.toMatch(/never leaves your device/i);
    expect(readme).not.toMatch(/no account, no server, and no network call/i);
  });

  it('and where the line falls, in words rather than in a number', () => {
    expect(home).toContain('Free at the table, paid away from it.');
    // Cross-device history was the one paid thing in this app and is not one
    // any more, which makes "free in its entirety" literally true rather than
    // true with a footnote. Said before the feature exists rather than after
    // somebody has years of log in it, which is the same order the old promise
    // was made in and the reason this assertion is here at all.
    expect(home).toMatch(/history follows you, and that is free/i);
    expect(home).toMatch(/One payment rather than\s+a subscription/);
  });

  it('and never puts a price back on the one thing that used to carry one', () => {
    // The failure this guards is a sentence, not a feature: sync ships, and
    // somebody writing the release copy reaches for the old conversion moment
    // because it is still written down in three other places.
    expect(home).not.toMatch(/own the other two/i);
    const sync = /(sync|history follows you|phone to your laptop)/i;
    for (const paragraph of home.split(/<\/p>/)) {
      if (!sync.test(paragraph)) continue;
      expect(paragraph).not.toMatch(/\$\s*\d/);
      expect(paragraph).not.toMatch(/\b(paid for|costs|price|purchase|upgrade|subscription)\b/i);
    }
  });

  it('has a 404 that is a page rather than a wall', () => {
    expect(existsSync(join(ROOT, 'public', '404.html'))).toBe(true);
  });
});

describe('the app is under /app', () => {
  it('is what Netlify actually builds', () => {
    // The bare export deploys the app at / and no front door, silently.
    expect(netlify).toContain('command = "npm run build:web"');
    expect(JSON.parse(read('package.json')).scripts['build:web']).toBe('node scripts/build-web.mjs');
  });

  it('the export is moved there rather than rewritten there', () => {
    expect(buildScript).toContain("renameSync(join(DIST, entry), join(APP, entry))");
    expect(read('app.json')).toContain('"baseUrl": "/app"');
  });

  it('deep links the export never prerendered fall back to its shell', () => {
    expect(netlify).toContain('from = "/app/*"');
    expect(netlify).toContain('to = "/app/index.html"');
  });

  it('the old family address still resolves', () => {
    expect(ruleAt('/apps')).toBeGreaterThan(-1);
  });

  it('the chip keeps first call on its own route', () => {
    // Chips are permanent objects; nothing added later may shadow /chip.
    expect(ruleAt('/chip')).toBeLessThan(ruleAt('/app/*'));
    expect(ruleAt('/chip')).toBeGreaterThan(-1);
  });

  it('no rule sends the root at the app any more', () => {
    expect(netlify).not.toContain('to = "/index.html"');
  });
});

describe('the two sitemaps, at two addresses', () => {
  it('names the page address, rather than trusting a directory index', () => {
    // The same reasoning the guides get their rules for: Netlify would usually
    // serve dist/sitemap/index.html here, and usually is a setting.
    expect(ruleAt('/sitemap')).toBeGreaterThan(-1);
    expect(netlify).toContain('to = "/sitemap/index.html"');
  });

  it('and the trailing slash somebody will type', () => {
    expect(ruleAt('/sitemap/')).toBeGreaterThan(-1);
  });

  it('leaves the XML alone, which is the one that must not break', () => {
    // A rule capturing /sitemap.xml would take the crawlers' sitemap off the
    // site to fix a page for people. Nothing may send that address anywhere.
    expect(ruleAt('/sitemap.xml')).toBe(-1);
    expect(netlify).not.toContain('to = "/sitemap.xml"');
    expect(netlify).not.toContain('from = "/sitemap*"');
  });

  it('and is not shadowed by the rules that match everything', () => {
    expect(ruleAt('/sitemap')).toBeLessThan(ruleAt('/app/*'));
  });

  it('points at a file the build actually writes', () => {
    // The rule and the generator have to name the same path, and they are in
    // different files with nothing else holding them together.
    expect(read('scripts', 'build-blog.mjs')).toContain("join('sitemap', 'index.html')");
  });
});

describe('the installed app is the app', () => {
  it.each(['id', 'start_url', 'scope'] as const)('manifest %s is /app', (key) => {
    expect(manifest[key]).toBe('/app');
  });

  it('and so is every shortcut', () => {
    for (const shortcut of manifest.shortcuts) expect(shortcut.url).toMatch(/^\/app\//);
  });
});

describe('the worker caches the app and not the marketing site', () => {
  it('claims a scope narrower than where it is served from', () => {
    expect(read('app', '+html.tsx')).toContain("register('/sw.js', { scope: '/app/' })");
    // Which a server only allows when it says so.
    expect(netlify).toContain('Service-Worker-Allowed = "/app/"');
  });

  it('precaches the app shell, at the path the build actually produces', () => {
    expect(worker).toContain("const SHELL_URL = '/app/index.html';");
    expect(worker).toContain("['/app/', SHELL_URL, '/manifest.webmanifest']");
  });

  it('treats the moved bundle as the immutable one', () => {
    expect(worker).toContain("pathname.startsWith('/app/_expo/')");
    expect(worker).toContain("pathname.startsWith('/app/assets/')");
  });

  it('and so does the CDN, at the same paths', () => {
    // The worker was updated when the bundle moved under /app and these were
    // not, so they named /_expo/* and /assets/*, where nothing is published:
    // two rules matching zero requests, and the one set of files on this site
    // that can be cached forever revalidated on every visit instead. Nothing
    // could show it, because a header rule that matches nothing fails silently
    // and the worker covered the case for anybody who had one.
    expect(netlify).toContain('for = "/app/_expo/*"');
    expect(netlify).toContain('for = "/app/assets/*"');
    expect(netlify).not.toContain('for = "/_expo/*"');
    expect(netlify).not.toContain('for = "/assets/*"');
  });

  it('was bumped, so an existing install discards the caches it filled at /', () => {
    expect(worker).not.toContain("CACHE_VERSION = 'v1'");
  });

  it('and answers for none of the backend, which is same-origin too', () => {
    // The worker's header used to say Log had no backend, and on that reading
    // caching every same-origin GET is obviously safe. It is not: a bundle is
    // a conversation, and a previous answer to a sync applied as a fresh one
    // would put somebody's history in at the wrong point and write a cursor
    // saying so. Nothing is cached today only because every one of these is a
    // POST, which is a fact about the callers rather than a rule.
    expect(worker).toContain("url.pathname.startsWith('/api/')");
  });

  it('and does not say in its own header that there is no backend', () => {
    // The same claim in the same house, missed twice over: the sweep two
    // describes up is a list of pages and generators, and this is neither, and
    // it words it as "backend" rather than "server" so widening that list alone
    // would still not have found it. It mattered more here than on a page,
    // because it was not a promise to a visitor -- it was the premise the
    // caching rule below it was reasoned from.
    expect(worker).not.toMatch(/has no (backend|server)/i);
    expect(worker).not.toMatch(/there is no (backend|server)/i);
  });

  it('and every endpoint there is under the prefix it skips', () => {
    // The half that goes stale. A function declares its own path, so one added
    // outside `/api/` would sit on this origin with nothing excluding it, and
    // the exclusion above would still look complete.
    const declared = [
      ...functions.matchAll(/path:\s*(?:'([^']+)'|\[([^\]]+)\])/g),
    ].flatMap((match) =>
      match[1] !== undefined
        ? [match[1]]
        : [...match[2].matchAll(/'([^']+)'/g)].map((one) => one[1]),
    );
    // Plus the one routed by netlify.toml rather than by a config export.
    const routed = [...netlify.matchAll(/from = "(\/api[^"]*)"/g)].map((match) => match[1]);

    const paths = [...declared, ...routed];
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) expect(path.startsWith('/api/')).toBe(true);
  });
});

describe('the site is findable', () => {
  const robots = read('public', 'robots.txt');
  const sitemap = read('public', 'sitemap.xml');
  const shell = read('app', '+html.tsx');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it('has a sitemap, and points at it from robots', () => {
    expect(robots).toContain('Sitemap: https://log.poker/sitemap.xml');
  });

  it('disallows nothing, because a blocked bundle is a blank page in the index', () => {
    // Keeping crawlers out of /app is the instinct and the trap: without
    // /app/_expo/* they cannot render the app, so they index an empty shell.
    expect(robots).not.toMatch(/^Disallow:\s*\/\S/m);
    expect(robots).toContain('Allow: /');
  });

  it('lists the front door, the app and the guides, and nothing else', () => {
    // The guides earn their place by answering four different questions;
    // src/site/__tests__/content.test.ts is where that is held to. What this
    // one guards is the boundary: no near-duplicate slipping in beside them,
    // and no /chip, /apps or per-route /app page.
    expect(locs).toEqual([
      'https://log.poker/',
      'https://log.poker/app',
      'https://log.poker/running-bad',
      'https://log.poker/bankroll',
      'https://log.poker/pot-odds',
      'https://log.poker/tilt',
    ]);
  });

  it('dates every entry, in the past', () => {
    const dates = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    expect(dates).toHaveLength(locs.length);
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(date)).toBeLessThanOrEqual(Date.now());
    }
  });

  it('collapses the app routes onto one URL instead of competing with itself', () => {
    // The prerendered routes are one document with one description repeated.
    expect(shell).toContain('<link rel="canonical" href="https://log.poker/app" />');
    expect(shell).toContain('content="https://log.poker/app"');
    expect(shell).not.toContain('content="https://log.poker"');
  });

  it('keeps the campaign landing out of the index', () => {
    // Reached by scanning a disc, and close to a duplicate of the front page.
    expect(read('public', 'chip.html')).toContain('name="robots" content="noindex, follow"');
  });

  it('and the front door out of nobody\'s way', () => {
    expect(home).not.toMatch(/name="robots"[^>]*noindex/);
  });
});

describe('the app links out to the guides', () => {
  const variance = read('app', '(tabs)', 'variance.tsx');
  const dashboard = read('app', '(tabs)', 'index.tsx');
  const button = read('src', 'components', 'Button.tsx');

  it.each(Object.entries(GUIDES))(
    '%s is at an address the site actually serves',
    (_name, url) => {
      // A typo here is a 404 for everybody who taps it, and nothing in the app
      // would notice: the link opens a browser and the app carries on.
      const slug = url.replace('https://log.poker/', '');
      expect(url).toBe(`https://log.poker/${slug}`);
      expect(existsSync(join(ROOT, 'public', `${slug}.html`))).toBe(true);
      expect(netlify).toContain(`from = "/${slug}"`);
    },
  );

  it('running-bad from the variance screen, which is what it is about', () => {
    expect(variance).toContain('GUIDES.runningBad');
    // Both branches: the empty state, where somebody most wants to know what
    // this page will eventually tell them, and the one with a real estimate.
    expect([...variance.matchAll(/\{guide\}/g)]).toHaveLength(2);
  });

  it('bankroll from the dashboard, under the tiles that show the swings', () => {
    // Both ends are found before either is compared. `indexOf` returns -1 for
    // a marker that is gone, and -1 is less than everything, so an ordering
    // check on its own passes loudest exactly when it has stopped looking at
    // anything. That is not hypothetical: the tiles moved from JSX attributes
    // into a computed array, `label="Worst session"` stopped matching, and
    // this test went green on a string it could no longer find.
    const worst = dashboard.search(/label[=:]\s*['"]Worst session['"]/);
    const guide = dashboard.indexOf('GUIDES.bankroll');
    expect(worst).toBeGreaterThan(-1);
    expect(guide).toBeGreaterThan(-1);

    // Below the worst-session tile rather than above it: the question only
    // lands once the number that raises it is on screen.
    expect(worst).toBeLessThan(guide);
  });

  it('as a real anchor on web rather than a scripted pop-up', () => {
    // react-native-web turns an href into an <a>, which can be middle-clicked,
    // copied and followed by a crawler. It also leaves the press handlers
    // firing, so the button skips onPress on web or the page opens twice.
    expect(button).toContain('href');
    expect(button).toContain("accessibilityRole={href === undefined ? 'button' : 'link'}");
    expect(button).toContain("if (href !== undefined && Platform.OS === 'web') return;");
  });
});

/**
 * The one screen where the app is a web page on a phone.
 *
 * Every other layout question is the same on all three platforms. This one is
 * not, and it is invisible everywhere the app is actually run during
 * development: on a phone Log is a real app, and on a desktop browser the
 * chrome is at the top.
 */
describe('the app shell in a phone browser', () => {
  const shell = read('app', '+html.tsx');
  const style = /const BASE_STYLE = `([\s\S]*?)`;/.exec(shell)?.[1] ?? '';

  it('is as tall as the visible window rather than the layout viewport', () => {
    // iOS Safari's layout viewport runs on behind its own bottom toolbar, so
    // `height: 100%` puts the tab bar underneath it with the labels cut in
    // half. `dvh` is the height of what can actually be seen.
    expect(style).toContain('height: 100dvh');
  });

  it('and clears the toolbar sitting on top of that height, which dvh does not', () => {
    // Safari's compact toolbar overlays the dynamic viewport rather than
    // reducing it, so `dvh` alone still left the bottom of the bar underneath.
    // `100dvh - 100svh` is exactly how much of the window it is sitting on.
    expect(style).toContain(
      'padding-bottom: max(env(safe-area-inset-bottom), calc(100dvh - 100svh)) !important;',
    );
  });

  it('at the bar itself, by an id neither side writes out by hand', () => {
    // Interpolated on both sides, which is the point: a selector and an element
    // that drift apart do not fail. The rule stops matching, and the bar goes
    // quietly back under the toolbar.
    const bar = read('src', 'components', 'TabBar.tsx');
    expect(style).toContain('#${BOTTOM_BAR_ID} {');
    expect(bar).toContain('nativeID={BOTTOM_BAR_ID}');
    expect(bar).not.toContain(BOTTOM_BAR_ID);
    expect(shell.replace(/BOTTOM_BAR_ID/g, '')).not.toContain(BOTTOM_BAR_ID);
  });

  it('and `!important`, because the component writes the same property inline', () => {
    // react-native-web puts a dynamic style on the element, and an inline style
    // beats an id. Nothing is lost by winning: the inset it writes is the left
    // half of the `max` above.
    expect(style).toContain('!important');
  });

  it('with every one of those units inside `@supports`, or older browsers break', () => {
    // Unguarded, a browser that does not know the unit throws the declaration
    // away: the height rule leaves the app with no height at all, and the
    // padding rule leaves the bar with none of the inset it did have.
    const outside = style.replace(/@supports[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
    expect(style).toMatch(/dvh|svh/);
    expect(outside).not.toMatch(/dvh|svh/);
  });

  it('and after the reset it is correcting, or the reset wins', () => {
    expect(shell.indexOf('<ScrollViewStyleReset />')).toBeGreaterThan(-1);
    expect(shell.indexOf('<ScrollViewStyleReset />')).toBeLessThan(shell.indexOf('BASE_STYLE }'));
  });

  it('and that reset still says the thing being corrected', () => {
    // The fix is an override of somebody else's stylesheet. If expo changes
    // what it sets, this file is either redundant or wrong, and either way
    // somebody should find out here rather than on a phone.
    const reset = readFileSync(require.resolve('expo-router/build/static/html.js'), 'utf8');
    expect(reset).toContain('#root,body,html{height:100%}');
  });

  it('and gives the tab labels a line box rather than whatever the font says', () => {
    // The other half of the same screenshot, and a separate bug underneath it.
    // `Text` is `overflow: hidden` on web, so a label with no line height gets
    // one `normal` line and anything the font puts below it is sliced off in a
    // straight line. `normal` is 12px for an 11px font in a desktop browser,
    // whose fonts fit inside that; iOS Safari's system font does not, so every
    // label was cut level with every other, descenders and all.
    //
    // Which is why this is a number rather than a default: `normal` means "ask
    // the font", and the font is the thing that differs.
    const bar = read('src', 'components', 'TabBar.tsx');
    const size = Number(/label: \{\s*fontSize: (\d+)/.exec(bar)?.[1]);
    const line = Number(/lineHeight: (\d+)/.exec(bar)?.[1]);

    expect(size).toBeGreaterThan(0);
    // The system font wants about 1.25em between its ascender and descender.
    expect(line / size).toBeGreaterThanOrEqual(1.3);
  });

  it('with `viewport-fit=cover`, or no inset ever reaches the layout', () => {
    // The other half, and the one that keeps the bar off the home indicator
    // once the app is installed to the home screen and there is no toolbar.
    expect(shell).toContain('viewport-fit=cover');
  });
});

describe('the family links', () => {
  it('point the app link at the app rather than the marketing site', () => {
    expect(FAMILY_LINKS.log).toBe('https://log.poker/app');
    expect(FAMILY_HOME).toBe('https://log.poker');
  });

  it('use the host TiltProof actually serves', () => {
    expect(FAMILY_LINKS.tiltproof).toBe('https://tiltproof.poker');
  });
});

describe('the security headers', () => {
  const csp = /Content-Security-Policy = "([^"]+)"/.exec(netlify)?.[1] ?? '';

  it('sends a Content-Security-Policy at all', () => {
    // There was none, in front of a thirty-day family token kept in
    // `localStorage` and accepted by all three apps in the family.
    expect(csp).not.toBe('');
  });

  it('allows a connection only to this origin and the sign-in hand-off', () => {
    // The load-bearing directive: script-src has to allow inline, so what stops
    // an injected script is that it has nowhere to send the token.
    expect(csp).toContain("connect-src 'self' https://untilt.poker");
  });

  it('closes the directives an injected script would otherwise reach for', () => {
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it('names no origin the app does not actually talk to', () => {
    // Everything is self-hosted: no CDN, no analytics, no web fonts. If that
    // stops being true this assertion is the thing that says so.
    const origins = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(origins).toEqual(['https://untilt.poker']);
  });

  it('keeps the headers that were already there', () => {
    expect(netlify).toContain('X-Content-Type-Options = "nosniff"');
    expect(netlify).toContain('Referrer-Policy = "strict-origin-when-cross-origin"');
  });
});
