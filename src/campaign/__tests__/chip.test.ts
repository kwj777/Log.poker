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
import { inflateSync } from 'node:zlib';

import jsQR from 'jsqr';

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

/* ------------------------------------------------------------------ the art */

/**
 * Enough of a PNG decoder to hand a scanner its pixels: eight bits a channel,
 * not interlaced, which is what the rasterizer emits.
 */
function pixels(path: string): { data: Uint8ClampedArray; width: number; height: number } {
  const png = readFileSync(path);
  const parts: Buffer[] = [];
  let width = 0;
  let height = 0;
  let channels = 0;

  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const chunk = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[chunk[9] as 0 | 2 | 4 | 6] as number;
    }
    if (type === 'IDAT') parts.push(chunk);
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let at = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[at] as number;
    at += 1;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const upLeft = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] as number) : 0;
      const value = raw[at + x] as number;
      let restored: number;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else {
        const estimate = left + up - upLeft;
        const dl = Math.abs(estimate - left);
        const du = Math.abs(estimate - up);
        const dul = Math.abs(estimate - upLeft);
        restored = value + (dl <= du && dl <= dul ? left : du <= dul ? up : upLeft);
      }
      out[y * stride + x] = restored & 0xff;
    }
    at += stride;
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const from = pixel * channels;
    rgba[pixel * 4] = out[from] as number;
    rgba[pixel * 4 + 1] = out[from + 1] as number;
    rgba[pixel * 4 + 2] = out[from + 2] as number;
    rgba[pixel * 4 + 3] = 255;
  }
  return { data: rgba, width, height };
}

describe('the code that gets fired into the glaze', () => {
  const generated = readFileSync(join(ROOT, 'design', 'chip', 'qr.js'), 'utf8');

  it('was encoded from the campaign URL and not retyped', () => {
    // scripts/make-qr.mjs cannot import this module: it is .mjs and this is
    // TypeScript. So the two are held together here instead of by a comment,
    // which is the whole reason this assertion exists.
    expect(generated).toContain(JSON.stringify(chipUrl('qr')));
  });

  it.each(['log-chip-47mm-side-2.png', 'log-chip-43mm-side-2.png'])(
    '%s actually scans, and scans to that URL',
    (file) => {
      // This reads the artwork the way a phone does, and it catches the ways
      // the code can be wrong rather than small: a stale matrix, the wrong
      // URL, a quiet zone eaten by the corner radius, a ground too light to
      // threshold against.
      //
      // It says nothing about millimeters, and it is worth being exact about
      // that, because the obvious reading is that a decode proves the chip
      // scans. These artboards are 2000px, so a tile a third of its real size
      // still lands five pixels per module and decodes happily. The physical
      // size is arithmetic and it is checked below instead.
      const image = pixels(join(ROOT, 'design', 'chip', file));
      const found = jsQR(image.data, image.width, image.height);
      expect(found?.data).toBe(chipUrl('qr'));
    },
  );

  it('leaves each module big enough for a phone to resolve on the real disc', () => {
    // The assertion the decode above cannot make. A face is authored at 39mm
    // on a 2000px board standing for 45mm, so 44.44px/mm, and the art is then
    // rendered at 47mm, which scales every physical size by 47/39. The code
    // spans the matrix plus its quiet zone on both sides.
    const back = readFileSync(join(ROOT, 'design', 'chip', 'side-2.html'), 'utf8');
    const tilePx = Number(/\.qr \{[^}]*?width: (\d+)px/.exec(back)?.[1]);
    const quiet = Number(/QUIET = (\d+);/.exec(back)?.[1]);
    const matrix = Number(/size: (\d+),/.exec(generated)?.[1]);
    // Every one of the three has to be found before any of them is used. A
    // NaN here would sail through the comparison below as `NaN > 0.4` being
    // false, which fails for the right reason by accident, and the next one
    // might not.
    expect([tilePx, quiet, matrix].every(Number.isFinite)).toBe(true);

    const modules = matrix + quiet * 2;
    const moduleMm = ((tilePx / (2000 / 45)) * (47 / 39)) / modules;

    // 0.4mm is where a phone camera starts needing a second try, and a second
    // try at a table is somebody putting the chip back down.
    expect(moduleMm).toBeGreaterThan(0.4);
  });

  it('leaves the code the loudest thing on the face', () => {
    // Cream on the chip's own near-black. A scanner thresholds on luminance,
    // and this pair is 16:1, so there is no version of a matte fire that
    // brings them close enough to confuse.
    const back = readFileSync(join(ROOT, 'design', 'chip', 'side-2.html'), 'utf8');
    expect(back).toContain('background: var(--cream);');
    expect(back).toContain('fill="#0d1110"');
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
