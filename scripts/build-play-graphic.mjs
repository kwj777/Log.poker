/**
 * The Google Play feature graphic: the 1024x500 banner at the top of Log's
 * listing, which Play requires before the app can be published.
 *
 * It says what the listing's subtitle says, and then shows it: the mark, the
 * name, the question, and the chart that answers it. The chart is the one on
 * the Variance tab, drawn with the same envelope `confidenceBand` in
 * `src/domain/variance.ts` draws, which is closed at both ends because the
 * average it is measured against is made of the very hours it spans. The
 * player is invented: a seeded walk with a downswing in the middle that stays
 * inside the range, which is the case the app exists to name as ordinary.
 *
 * Play's rules for it, the first of which `src/__tests__/release.test.ts` pins:
 *
 * - Exactly 1024 by 500, and JPEG or 24-bit PNG with **no alpha channel**.
 *   resvg always writes RGBA, so the pixels are re-encoded as RGB below.
 * - No device frames, and nothing that matters near the edges, because Play
 *   crops the banner and lays its own UI over it on some surfaces.
 * - No price or promotional words. "Free" is the whole pitch everywhere else,
 *   and it is exactly the word Play's listing guidelines keep off its art.
 *
 * **The PNG is the artifact and it is committed**, as the share cards are,
 * because two machines with different fonts draw slightly different text.
 * It is uploaded by hand in Play Console (`PLAY.md`, step 6) and never bundled.
 *
 *     npm run build:play
 *
 * An argument writes it somewhere else instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

import { PALETTE, SANS, SERIF } from './draw-hand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'design', 'play-feature-graphic.png'));

const W = 1024;
const H = 500;

/** The app's own chart colors, from `src/theme/index.ts` and the Variance tab. */
const BAND = 'rgba(31, 169, 122, 0.14)';
const BORDER_STRONG = '#3d4a44';

/**
 * The chart's box. Play crops the banner differently on different surfaces
 * and never says exactly where, so everything that matters stays inside a
 * centered 16:9 box, about 67 pixels in from either side, with room to spare.
 */
const CHART = { left: 520, right: 904, top: 92, bottom: 392 };

const { Resvg } = await import('@resvg/resvg-js').catch(() => {
  throw new Error('the feature graphic needs @resvg/resvg-js: run npm install');
});

const FONT = { loadSystemFonts: true, defaultFontFamily: 'Liberation Serif' };

// ------------------------------------------------------------------ player

/** A small seeded generator, so every run draws the same invented player. */
const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Standard normal draws, by Box-Muller. */
const normal = (random) => () =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

const SESSIONS = 48;
const SESSION_HOURS = 5;
/** Big blinds per hour: a solid live winner, and a realistic spread for one. */
const WIN_RATE = 9;
const STD_DEV = 75;
const Z = 1.96;
/**
 * Picked by looking, from the seeds whose walk stays inside the band: this one
 * climbs, gives most of it back in the middle, and recovers, so the picture is
 * a downswing the band calls ordinary.
 */
const SEED = 397;

const player = () => {
  const draw = normal(mulberry32(SEED));
  const points = [{ hours: 0, actual: 0 }];
  let bb = 0;
  for (let i = 1; i <= SESSIONS; i += 1) {
    bb += WIN_RATE * SESSION_HOURS + STD_DEV * Math.sqrt(SESSION_HOURS) * draw();
    points.push({ hours: i * SESSION_HOURS, actual: bb });
  }
  // The rate is fitted to these same hours, as the app fits it, so the line
  // lands on the dashed one at the end by construction and the envelope is
  // the bridge's: z * sd * sqrt(h * (1 - h / T)), closed at both ends.
  const total = SESSIONS * SESSION_HOURS;
  const rate = bb / total;
  return points.map(({ hours, actual }) => {
    const expected = rate * hours;
    const spread = Z * STD_DEV * Math.sqrt(hours * (1 - hours / total));
    return { hours, actual, expected, upper: expected + spread, lower: expected - spread };
  });
};

// ------------------------------------------------------------------ drawing

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Log's mark on the ground: the middle ring, Observe, lit gold, per BRAND.md. */
const mark = (x, y, size) => `  <g transform="translate(${x} ${y}) scale(${size / 200})"
    fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M100 125 L100 163" stroke="${PALETTE.GOLD}" stroke-width="8" />
    <path d="M34 125 L166 125 L100 37 Z" stroke="#9aae80" stroke-width="6" />
    <path d="M78 125 L100 96 L122 125" stroke="#55665e" stroke-width="6" />
    <path d="M56 125 L100 66 L144 125" stroke="${PALETTE.GOLD}" stroke-width="7.5" />
  </g>`;

const chart = (points) => {
  const values = points.flatMap((p) => [p.upper, p.lower, p.actual]);
  const minY = Math.min(0, ...values);
  const maxY = Math.max(...values);
  const total = points[points.length - 1].hours;
  const x = (hours) => CHART.left + (hours / total) * (CHART.right - CHART.left);
  const y = (bb) => CHART.bottom - ((bb - minY) / (maxY - minY)) * (CHART.bottom - CHART.top);
  const line = (key) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.hours).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const band =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.hours).toFixed(1)} ${y(p.upper).toFixed(1)}`).join(' ') +
    ' ' +
    [...points].reverse().map((p) => `L${x(p.hours).toFixed(1)} ${y(p.lower).toFixed(1)}`).join(' ') +
    ' Z';
  const last = points[points.length - 1];

  return [
    `  <path d="${band}" fill="${BAND}" />`,
    `  <line x1="${CHART.left}" x2="${CHART.right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"
    stroke="${BORDER_STRONG}" stroke-width="1.5" stroke-dasharray="6 6" />`,
    `  <path d="${line('expected')}" fill="none" stroke="${PALETTE.GOLD}" stroke-width="2.5"
    stroke-dasharray="8 8" stroke-linecap="round" />`,
    `  <path d="${line('actual')}" fill="none" stroke="${PALETTE.CREAM}" stroke-width="4"
    stroke-linejoin="round" stroke-linecap="round" />`,
    `  <circle cx="${x(last.hours).toFixed(1)}" cy="${y(last.actual).toFixed(1)}" r="7"
    fill="${PALETTE.CREAM}" stroke="${PALETTE.GROUND}" stroke-width="3" />`,
  ].join('\n');
};

const graphic = () => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PALETTE.GROUND}" />
${mark(89, 85, 136)}
  <text x="108" y="300" font-family="${SERIF}" font-size="112" fill="${PALETTE.CREAM}">Log</text>
  <text x="110" y="356" font-family="${SERIF}" font-size="36" fill="${PALETTE.MUTED}">Running bad,</text>
  <text x="110" y="402" font-family="${SERIF}" font-size="36" fill="${PALETTE.MUTED}">or playing bad?</text>
${chart(player())}
  <text x="${(CHART.left + CHART.right) / 2}" y="436" font-family="${SANS}" font-size="20" letter-spacing="3"
    text-anchor="middle" fill="${PALETTE.DIM}">${escapeXml('INSIDE YOUR NORMAL RANGE')}</text>
</svg>
`;

// ------------------------------------------------------------------ PNG

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/**
 * RGBA in, 24-bit RGB PNG out. Safe to drop the channel without compositing
 * because the first thing drawn is an opaque rectangle over the whole canvas,
 * and this checks rather than assumes it.
 */
const rgbPng = (width, height, rgba) => {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      if (rgba[from + 3] !== 255) throw new Error(`pixel ${x},${y} is not opaque`);
      raw[row + 1 + x * 3] = rgba[from];
      raw[row + 2 + x * 3] = rgba[from + 1];
      raw[row + 3 + x * 3] = rgba[from + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const rendered = new Resvg(graphic(), { font: FONT }).render();
const png = rgbPng(rendered.width, rendered.height, rendered.pixels);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`${OUT.replace(`${ROOT}/`, '')}  ${rendered.width}x${rendered.height}  ${(png.length / 1024).toFixed(1)}KB`);
