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

import { FAMILY_LINKS, FAMILY_HOME } from '../../config';

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

describe('the family links', () => {
  it('point the app link at the app rather than the marketing site', () => {
    expect(FAMILY_LINKS.log).toBe('https://log.poker/app');
    expect(FAMILY_HOME).toBe('https://log.poker');
  });

  it('use the host TiltProof actually serves', () => {
    expect(FAMILY_LINKS.tiltproof).toBe('https://tiltproof.poker');
  });
});
