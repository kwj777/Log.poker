/**
 * Generates Log's app and PWA icons.
 *
 * The environment has no image tooling, and a poker tracker shipping the generic
 * Expo template icon is not a finished product — so the mark is drawn here in
 * code and rasterised to PNG directly. Being a script rather than a binary blob
 * also means the icon is diffable, and a palette change is a one-line edit and a
 * re-run rather than a round trip through a design tool.
 *
 * The mark is the family's, per BRAND.md: three nested triangles sharing a
 * common baseline, stroked and never filled, smallest to largest reading
 * Learn, Observe, Ground. It replaced three ascending bars that were this
 * app's alone.
 *
 * Two things about how it is drawn are decisions rather than transcription.
 *
 * The baseline is drawn once. "Sharing a common baseline" means one line, not
 * three coincident ones: stacking three bases on the same pixels stripes it
 * into three colours and reads as a mistake at any size. So the outer triangle
 * is closed and the two inside it are open chevrons standing on it. The line
 * they stand on is gold, which is Ground, which is the point.
 *
 * Gold is the outermost stroke and not the innermost. That reverses what this
 * repo recommended before rasterising anything, and the reason is measured:
 * forest on the family ground is 1.76:1, so the outer stroke, the one that
 * gives the mark its silhouette, was invisible at icon sizes. Gold is 7.22:1.
 * Putting the brightest stroke on the defining edge also restores the original
 * design brief's own order, forest to sage to gold reading inward to outward,
 * which was one of the two contradictory specs BRAND.md had recorded as open.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BACKGROUND = [0x1c, 0x21, 0x1f];
// Outermost to innermost. The inner stroke is forest lifted to #55665e: plain
// forest is a border colour, correct at 1.76:1 for a border and absent at that
// ratio as a stroke, and #55665e is 2.71:1 while staying the dimmest of three.
const MARK_COLORS = [
  [0xc9, 0xa8, 0x6a],
  [0x6b, 0x7a, 0x5e],
  [0x55, 0x66, 0x5e],
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
 * @param inset         the mark's width as a fraction of the canvas. Its
 *                      bounding circle is 1.2x that, which is what the cropped
 *                      icons below are sized against: a maskable icon is cropped
 *                      to 80% of the canvas, so the mark can be up to 0.66 wide,
 *                      and an Android adaptive foreground to 61%, so up to 0.50
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

  // The mark. A triangle of half-base h has height 4h/3, so the whole thing is
  // `markWidth` across and two thirds of that tall, and the widest points are
  // the two base corners. That makes its bounding circle 1.2x the width, which
  // is what the insets below are chosen against for the icons a platform crops.
  const markWidth = size * inset;
  const halfBase = markWidth / 2;
  const centreX = size / 2;
  const baseY = size / 2 + (halfBase * 4) / 3 / 2;
  const halfStroke = (markWidth * 0.058) / 2;

  /** Distance from a point to a segment, which is all a stroke needs. */
  const distanceToSegment = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  // Outermost first. Each is [colour, segments], and only the outer one carries
  // the base, because all three stand on the same line rather than each having
  // one. Round joins fall out of taking the minimum distance across segments.
  const strokes = [1, 2 / 3, 1 / 3].map((scale, i) => {
    const h = halfBase * scale;
    const left = [centreX - h, baseY];
    const right = [centreX + h, baseY];
    const apex = [centreX, baseY - (h * 4) / 3];
    const segments = [
      [...left, ...apex],
      [...apex, ...right],
    ];
    if (i === 0) segments.push([...left, ...right]);
    return { colour: MARK_COLORS[i], segments };
  });

  for (const { colour, segments } of strokes) {
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        let nearest = Infinity;
        for (const [ax, ay, bx, by] of segments) {
          nearest = Math.min(nearest, distanceToSegment(px + 0.5, py + 0.5, ax, ay, bx, by));
          if (nearest <= halfStroke - 0.5) break;
        }
        // Half a pixel of feathering either side of the edge is the whole of
        // the anti-aliasing, and it is exact rather than sampled.
        const coverage = Math.max(0, Math.min(1, halfStroke + 0.5 - nearest));
        if (coverage > 0) blend(rgba, (py * size + px) * 4, colour, coverage);
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
  ['assets/icon.png', { size: 1024, inset: 0.7, cornerRadius: 0 }],
  ['assets/splash-icon.png', { size: 512, transparent: true, inset: 0.58 }],
  ['assets/android-icon-foreground.png', { size: 432, transparent: true, inset: 0.48 }],
  ['assets/android-icon-monochrome.png', { size: 432, transparent: true, inset: 0.48 }],
  ['assets/favicon.png', { size: 64, inset: 0.74, cornerRadius: 0.16 }],

  // The mark alone, on nothing, for empty states inside the app. A PNG rather
  // than a drawn component on purpose: BRAND.md wants empty states derived from
  // this geometry, and rendering it with <Image> needs no SVG dependency, so
  // the mark on a screen is the same bytes as the mark on the icon rather than
  // a second drawing that can drift from it.
  ['assets/mark.png', { size: 512, transparent: true, inset: 0.94 }],

  // PWA icons. `maskable` fills the canvas because the platform crops it.
  ['public/icons/icon-192.png', { size: 192, inset: 0.72, cornerRadius: 0.22 }],
  ['public/icons/icon-512.png', { size: 512, inset: 0.72, cornerRadius: 0.22 }],
  ['public/icons/icon-maskable-512.png', { size: 512, inset: 0.62, cornerRadius: 0 }],
  ['public/icons/apple-touch-icon.png', { size: 180, inset: 0.72, cornerRadius: 0 }],
];

for (const [path, options] of OUTPUTS) {
  write(path, drawIcon(options));
}
