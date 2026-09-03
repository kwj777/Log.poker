/**
 * The chip route is a promise, so it is tested like one.
 *
 * Everything else in this repo can be rewritten. This URL is printed on
 * ceramic and handed to strangers, so the assertions below are about the
 * guarantee rather than about the implementation: it resolves, it resolves
 * without the bundle, it resolves without the network, it reads L then O then
 * G, and it never quotes a price.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHIP_CAMPAIGN, chipUrl } from '../chip';

const ROOT = join(__dirname, '..', '..', '..');
const page = readFileSync(join(ROOT, 'public', 'chip.html'), 'utf8');
const netlify = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');

/** Where a `from = "..."` rule sits in the file, or -1. */
const ruleAt = (from: string): number => netlify.indexOf(`from = "${from}"`);

describe('the printed URL', () => {
  it('is the one the campaign brief specifies', () => {
    expect(chipUrl('qr')).toBe(
      'https://log.poker/chip?utm_source=protector&utm_medium=qr&utm_campaign=giveaway',
    );
  });

  it('varies only by medium, so a tag needs no reprint of anything else', () => {
    expect(chipUrl('nfc')).toBe(chipUrl('qr').replace('utm_medium=qr', 'utm_medium=nfc'));
  });

  it('is what the page claims as canonical', () => {
    expect(page).toContain(`<link rel="canonical" href="${CHIP_CAMPAIGN.url}" />`);
  });
});

describe('the route cannot be swallowed', () => {
  it('serves a real static file', () => {
    expect(existsSync(join(ROOT, 'public', 'chip.html'))).toBe(true);
  });

  it.each([CHIP_CAMPAIGN.path, `${CHIP_CAMPAIGN.path}/`, '/api/chip-scan'])(
    'rewrites %s ahead of every other rule',
    (from) => {
      const rule = ruleAt(from);
      expect(rule).toBeGreaterThan(-1);
      // Netlify takes the first matching rule, so the only durable guarantee is
      // that nothing sits above these. This used to be asserted against the
      // single-page catch-all, until the site grew a marketing front door and
      // that rule stopped existing; the invariant it was standing in for is the
      // one written here, and it does not depend on what else the file holds.
      const others = [...netlify.matchAll(/from = "([^"]+)"/g)]
        .filter((m) => !m[1].startsWith('/chip') && m[1] !== '/api/chip-scan')
        .map((m) => m.index ?? Infinity);
      expect(rule).toBeLessThan(Math.min(...others));
    },
  );

  it('has no Expo route that would overwrite the file on export', () => {
    // `output: "static"` prerenders each route to its own html. A route at
    // /chip would emit dist/chip.html and silently replace the landing page.
    for (const name of ['chip.tsx', 'chip.jsx', 'chip.ts', 'chip.js']) {
      expect(existsSync(join(ROOT, 'app', name))).toBe(false);
    }
    expect(existsSync(join(ROOT, 'app', 'chip'))).toBe(false);
  });
});

describe('the page stands alone', () => {
  it('requests nothing over the network to render', () => {
    expect(page).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(page).not.toMatch(/<link[^>]+stylesheet/i);
    expect(page).not.toMatch(/@import/i);
    expect(page).not.toMatch(/fonts\.(googleapis|gstatic)\.com/i);
  });

  it('says what it is with scripting off', () => {
    const noScript = page.replace(/<script[\s\S]*?<\/script>/gi, '');
    expect(noScript).toContain('Be the <span class="caps">LOG</span>.');
    expect(noScript).toContain('Learn');
    expect(noScript).toContain('Observe');
    expect(noScript).toContain('Ground');
  });

  it('reads L, then O, then G', () => {
    // The same defect the chip back had: the lockup points at these three
    // words, so their order is the mechanism rather than a preference.
    const apps = page.slice(page.indexOf('<div class="apps">'), page.indexOf('<div class="cta">'));
    expect(apps.indexOf('Learn')).toBeLessThan(apps.indexOf('Observe'));
    expect(apps.indexOf('Observe')).toBeLessThan(apps.indexOf('Ground'));
  });

  it('quotes no price', () => {
    // Somebody who has used none of the three has no way to value one.
    expect(page).not.toMatch(/\$\s*\d/);
  });

  it('and scopes its one free claim to the app the button installs', () => {
    // Unlike the front door, this page carries nothing about money at all: the
    // three cards say what the apps are for and stop there. That leaves one
    // free claim, under the button, and unqualified it would be a promise on
    // behalf of two apps that are paid past a point.
    const cards = page.slice(page.indexOf('<div class="apps">'), page.indexOf('<div class="cta">'));
    expect(cards).not.toMatch(/\bfree\b/i);
    expect(page).toContain('Log is free, all of it');
  });

  it('prints the helpline', () => {
    expect(page).toContain('1-800-522-4700');
  });
});

describe('the scan counter is optional', () => {
  const fn = readFileSync(join(ROOT, 'netlify', 'functions', 'chip-scan.mjs'), 'utf8');

  it('is the only thing the page asks the network for, and it is fire and forget', () => {
    expect(page).toContain('navigator.sendBeacon');
    expect(page).toContain('/api/chip-scan');
    expect(page).not.toMatch(/\bfetch\s*\(/);
  });

  it('reports the medium and nothing else', () => {
    const script = page.slice(page.lastIndexOf('<script>'));
    expect(script).toContain("get('utm_medium')");
    expect(script).not.toMatch(/utm_source|utm_campaign|document\.referrer|Date\.now/);
  });

  it('accepts only the two media the page can send', () => {
    expect(fn).toContain("new Set(['qr', 'nfc'])");
  });

  it('answers 204 whatever happens, so a dropped count is never an error', () => {
    expect(fn).toContain('statusCode: 204');
    expect(fn).not.toMatch(/statusCode:\s*(4|5)\d\d/);
  });
});
