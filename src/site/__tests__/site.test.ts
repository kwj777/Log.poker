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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FAMILY_LINKS, FAMILY_HOME, GUIDES } from '../../config';

const ROOT = join(__dirname, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const netlify = read('netlify.toml');
const home = read('public', 'home.html');
const worker = read('public', 'sw.js');
const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
const buildScript = read('scripts', 'build-web.mjs');

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

  it('was bumped, so an existing install discards the caches it filled at /', () => {
    expect(worker).not.toContain("CACHE_VERSION = 'v1'");
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
  const button = read('src', 'components', 'Button.tsx');

  it('at the address the site actually serves', () => {
    // A typo here is a 404 for everybody who taps it, and nothing in the app
    // would notice: the link opens a browser and the app carries on.
    expect(GUIDES.runningBad).toBe('https://log.poker/running-bad');
    expect(existsSync(join(ROOT, 'public', 'running-bad.html'))).toBe(true);
    expect(netlify).toContain('from = "/running-bad"');
  });

  it('from the variance screen, which is the screen the guide is about', () => {
    expect(variance).toContain('GUIDES.runningBad');
    // Both branches: the empty state, where somebody most wants to know what
    // this page will eventually tell them, and the one with a real estimate.
    expect([...variance.matchAll(/\{guide\}/g)]).toHaveLength(2);
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

describe('the family links', () => {
  it('point the app link at the app rather than the marketing site', () => {
    expect(FAMILY_LINKS.log).toBe('https://log.poker/app');
    expect(FAMILY_HOME).toBe('https://log.poker');
  });

  it('use the host TiltProof actually serves', () => {
    expect(FAMILY_LINKS.tiltproof).toBe('https://tiltproof.poker');
  });
});
