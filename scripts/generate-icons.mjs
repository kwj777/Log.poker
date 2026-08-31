/**
 * Generates Log's app and PWA icons.
 *
 * The environment has no image tooling, and a poker tracker shipping the generic
 * Expo template icon is not a finished product — so the mark is drawn here in
 * code and rasterised to PNG directly. Being a script rather than a binary blob
 * also means the icon is diffable, and a palette change is a one-line edit and a
 * re-run rather than a round trip through a design tool.
 *
 * The mark: three ascending bars — the bankroll curve, and the same shape as the
 * Dashboard tab icon — on the family's charcoal.
 *
 * The bars climb forest, sage, gold: the same three colours as the family's
 * nested-triangle mark, in the same order, so the icon rhymes with it. It is
 * not that mark, which BRAND.md makes canonical and which app icons are meant
 * to derive from. Replacing the geometry is a separate decision, because these
 * bars are also the Dashboard tab icon.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BACKGROUND = [0x1c, 0x21, 0x1f];
const BAR_COLORS = [
  [0x3d, 0x4a, 0x44],
  [0x6b, 0x7a, 0x5e],
  [0xc9, 0xa8, 0x6a],
];

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** Encode RGBA pixel data (Uint8Array, 4 bytes per pixel) as a PNG. */
const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// -------------------------------------------------------------- drawing

/**
 * Coverage of a rounded rectangle at a point, sampled 4×4 for anti-aliasing.
 * Returns 0–1.
 */
const roundedRectCoverage = (px, py, x, y, w, h, r) => {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const cx = px + (sx + 0.5) / 4;
      const cy = py + (sy + 0.5) / 4;
      if (cx < x || cx > x + w || cy < y || cy > y + h) continue;

      // Distance test only matters inside the corner boxes.
      const dx = cx < x + r ? x + r - cx : cx > x + w - r ? cx - (x + w - r) : 0;
      const dy = cy < y + r ? y + r - cy : cy > y + h - r ? cy - (y + h - r) : 0;
      if (dx * dx + dy * dy <= r * r) hits += 1;
    }
  }
  return hits / 16;
};

const blend = (rgba, index, color, alpha) => {
  for (let c = 0; c < 3; c += 1) {
    rgba[index + c] = Math.round(rgba[index + c] * (1 - alpha) + color[c] * alpha);
  }
  rgba[index + 3] = Math.round(rgba[index + 3] * (1 - alpha) + 255 * alpha);
};

/**
 * @param size          output edge length in pixels
 * @param transparent   true for a logo on transparent ground (Android adaptive
 *                      foreground); false for a full-bleed square
 * @param inset         fraction of the canvas the mark occupies — 0.62 keeps the
 *                      bars inside the maskable safe zone that Android and iOS
 *                      crop to
 * @param cornerRadius  fraction of the size; 0 for a square (maskable icons are
 *                      cropped by the platform and must fill the canvas)
 */
const drawIcon = ({ size, transparent = false, inset = 0.62, cornerRadius = 0 }) => {
  const rgba = new Uint8Array(size * size * 4);

  // Background.
  if (!transparent) {
    const radius = cornerRadius * size;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const coverage =
          radius > 0 ? roundedRectCoverage(x, y, 0, 0, size, size, radius) : 1;
        if (coverage > 0) blend(rgba, (y * size + x) * 4, BACKGROUND, coverage);
      }
    }
  }

  // Three ascending bars, centred, with the tallest on the right.
  const markSize = size * inset;
  const originX = (size - markSize) / 2;
  const originY = (size - markSize) / 2;
  const gap = markSize * 0.12;
  const barWidth = (markSize - gap * 2) / 3;
  const heights = [0.46, 0.72, 1];
  const barRadius = barWidth * 0.28;

  for (let i = 0; i < 3; i += 1) {
    const barHeight = markSize * heights[i];
    const x = originX + i * (barWidth + gap);
    const y = originY + (markSize - barHeight);
    const color = BAR_COLORS[i];

    for (let py = Math.floor(y); py < Math.ceil(y + barHeight); py += 1) {
      for (let px = Math.floor(x); px < Math.ceil(x + barWidth); px += 1) {
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const coverage = roundedRectCoverage(px, py, x, y, barWidth, barHeight, barRadius);
        if (coverage > 0) blend(rgba, (py * size + px) * 4, color, coverage);
      }
    }
  }

  return encodePng(size, size, rgba);
};

const write = (relativePath, buffer) => {
  const target = resolve(ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`${relativePath} (${size(buffer)})`);
};

const size = (buffer) => `${Math.round(buffer.length / 102.4) / 10}KB`;

const OUTPUTS = [
  // Native app icons.
  ['assets/icon.png', { size: 1024, cornerRadius: 0 }],
  ['assets/splash-icon.png', { size: 512, transparent: true, inset: 0.5 }],
  ['assets/android-icon-foreground.png', { size: 432, transparent: true, inset: 0.42 }],
  ['assets/android-icon-monochrome.png', { size: 432, transparent: true, inset: 0.42 }],
  ['assets/favicon.png', { size: 64, inset: 0.7, cornerRadius: 0.16 }],

  // PWA icons. `maskable` fills the canvas because the platform crops it.
  ['public/icons/icon-192.png', { size: 192, inset: 0.66, cornerRadius: 0.22 }],
  ['public/icons/icon-512.png', { size: 512, inset: 0.66, cornerRadius: 0.22 }],
  ['public/icons/icon-maskable-512.png', { size: 512, inset: 0.52, cornerRadius: 0 }],
  ['public/icons/apple-touch-icon.png', { size: 180, inset: 0.66, cornerRadius: 0 }],
];

for (const [path, options] of OUTPUTS) {
  write(path, drawIcon(options));
}
