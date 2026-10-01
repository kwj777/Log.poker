/**
 * Generates Log's app and PWA icons.
 *
 * The environment has no image tooling, and a poker tracker shipping the generic
 * Expo template icon is not a finished product -- so the mark is drawn here in
 * code and rasterized to PNG directly. Being a script rather than a binary blob
 * also means the icon is diffable, and a palette change is a one-line edit and a
 * re-run rather than a round trip through a design tool.
 *
 * The mark is the family's, per BRAND.md: three nested triangles sharing a
 * common baseline, stroked and never filled, smallest to largest reading
 * Learn, Observe, Ground, standing on a trunk.
 *
 * The triangles themselves have never changed. What changed around them is the
 * color: they used to run gold, sage, forest outward-in, and they now run one
 * green ramp with the gold moved down to the trunk. That freed gold to mean
 * one thing, which is *this app*, so an icon lights exactly one ring and the
 * family mark lights none.
 *
 * Two things about how it is drawn are decisions rather than transcription.
 *
 * The baseline is drawn once. "Sharing a common baseline" means one line, not
 * three coincident ones: stacking three bases on the same pixels stripes it
 * into three colors and reads as a mistake at any size. So the outer triangle
 * is closed and the two inside it are open chevrons standing on it. The line
 * they stand on is gold, which is Ground, which is the point.
 *
 * Gold is the outermost stroke and not the innermost. That reverses what this
 * repo recommended before rasterizing anything, and the reason is measured:
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
// The canopy, outermost to innermost, and the trunk.
//
// The ramp climbs past sage rather than below it, because the palette's own
// three greens run 1.76:1, 2.68:1 and 3.55:1 on the ground, which is one step
// and a rumor: the darkest is already invisible. These are 6.79, 4.26 and
// 2.68, evenly spaced at 1.59x, lightest outermost so the silhouette is the
// strongest line.
const CANOPY = [
  [0x9a, 0xae, 0x80],
  [0x75, 0x88, 0x6a],
  [0x55, 0x66, 0x5e],
];

// Gold, on the trunk rather than in the canopy. It is the family accent, so the
// mark's one warm element is the part the family is named for: the canopy is
// what grows and the trunk is what becomes the log. It also carries the
// contrast, at 7.22:1 against a canopy averaging nearer 4.5, which is why it is
// drawn heavier than the canopy strokes and why brown was refused at 2.66:1.
const GOLD = [0xc9, 0xa8, 0x6a];

/** The mark as it sits on the family ground: the app's own screens. */
const ON_GROUND = { background: BACKGROUND, canopy: CANOPY, gold: GOLD };

/**
 * The mark as it sits on Log's own tile, which is cream.
 *
 * All three apps draw the same mark and light a different ring, and on a home
 * screen that was not enough: at 60 points, which ring is gold is a detail,
 * and the three icons read as one app installed three times. So each app now
 * stands on a tile of its own (BRAND.md, "Each app on its own tile"), and the
 * tile is the first thing a player tells apart. Log's is Cream, the family's
 * body text color, so it is the light one of the three.
 *
 * On a light ground the ramp turns over: darkest outermost, for the same
 * reason the ground ramp is lightest outermost, which is that the silhouette
 * is the strongest line. Forest, which is too quiet to stroke on the ground,
 * is the right outer stroke here at 7.31:1, and the other two follow it at
 * 4.46 and 2.74, which is 1.64x twice. The gold deepens to 3.58:1, because
 * the family gold is 1.58:1 on cream and would vanish; it keeps its hue, and
 * warm against cool is what carries a lit ring, as BRAND.md says of Untilt's.
 */
const ON_TILE = {
  background: [0xe8, 0xe4, 0xda],
  canopy: [
    [0x3d, 0x4a, 0x44],
    [0x5b, 0x6c, 0x52],
    [0x7f, 0x8e, 0x76],
  ],
  gold: [0x94, 0x70, 0x2e],
};

/**
 * Which ring an app lights, or `null` for the family mark, which has no gold in
 * the canopy at all. That is what keeps the family and the apps from ever being
 * mistaken for each other.
 */
export const RINGS = { ground: 0, observe: 1, learn: 2 };

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

/**
 * Encode RGBA pixel data (Uint8Array, 4 bytes per pixel) as a PNG.
 *
 * **An image with nothing transparent in it is written without an alpha
 * channel**, as color type 2 rather than 6. That is not a size optimization,
 * although it is one. `assets/icon.png` is the App Store icon, and App Store
 * Connect rejects an icon that has an alpha channel, whether or not anything
 * in it is actually translucent. This encoder wrote type 6 for every output,
 * so the one icon that may not have a channel had one.
 *
 * Detected rather than declared. `drawIcon` already knows which outputs stand
 * on a background and which do not, and a second flag saying the same thing is
 * a second thing to get wrong: the adaptive icons and the splash mark are
 * genuinely transparent and must keep their channel, and a `noAlpha: true`
 * pasted onto one of those would silently flatten it against black. Scanning
 * the pixels cannot disagree with the pixels.
 */
const encodePng = (width, height, rgba) => {
  const opaque = (() => {
    for (let at = 3; at < rgba.length; at += 4) if (rgba[at] !== 255) return false;
    return true;
  })();

  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    const row = y * (stride + 1) + 1;
    if (opaque) {
      // Copied a pixel at a time rather than a row at a time, because dropping
      // the fourth byte is what this loop is for.
      for (let x = 0; x < width; x += 1) {
        const from = (y * width + x) * 4;
        raw[row + x * 3] = rgba[from];
        raw[row + x * 3 + 1] = rgba[from + 1];
        raw[row + x * 3 + 2] = rgba[from + 2];
      }
    } else {
      Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // color type: RGB, or RGBA where a channel is used
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
 * Returns 0 to 1.
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
 * @param inset         the mark's width as a fraction of the canvas. With a
 *                      trunk under it the mark is now about as tall as it is
 *                      wide, so its bounding circle is 1.38x the width rather
 *                      than 1.2x, and the cropped icons had to come in: a
 *                      maskable icon is cropped to 80% of the canvas, so the
 *                      mark can be up to 0.58 wide, and an Android adaptive
 *                      foreground to 61%, so up to 0.44
 * @param lit           which canopy ring turns gold, or null for the family
 *                      mark, which has no gold in the canopy at all
 * @param palette       ON_TILE for an icon, ON_GROUND for the mark inside the
 *                      app, which sits on the family ground
 * @param cornerRadius  fraction of the size; 0 for a square (maskable icons are
 *                      cropped by the platform and must fill the canvas)
 */
const drawIcon = ({
  size,
  transparent = false,
  inset = 0.62,
  cornerRadius = 0,
  lit = null,
  palette = ON_GROUND,
}) => {
  const rgba = new Uint8Array(size * size * 4);

  // Background.
  if (!transparent) {
    const radius = cornerRadius * size;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const coverage =
          radius > 0 ? roundedRectCoverage(x, y, 0, 0, size, size, radius) : 1;
        if (coverage > 0) blend(rgba, (y * size + x) * 4, palette.background, coverage);
      }
    }
  }

  // The mark. The triangles are untouched: three nested, one shared baseline,
  // a half-base of h giving a height of 4h/3. What is new is the trunk under
  // them, which makes the whole thing taller than the canopy alone, so the
  // canopy is sized against the height budget rather than against the width.
  const centerX = size / 2;
  const trunkLength = (size * inset) / 3.47;
  const markWidth = size * inset;
  const halfBase = markWidth / 2;
  const canopyHeight = (halfBase * 4) / 3;
  const baseY = (size - (canopyHeight + trunkLength)) / 2 + canopyHeight;
  const canopyStroke = markWidth * 0.045;
  const trunkStroke = markWidth * 0.06;
  const litStroke = markWidth * 0.056;

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

  // The trunk first, then the canopy outermost to innermost, and a lit ring
  // last of all so it sits over its neighbors at any size. Only the outer ring
  // carries the baseline, because all three stand on the same line rather than
  // each having one, and that line lights with the outer ring since Ground is
  // what a baseline is.
  const strokes = [
    {
      color: palette.gold,
      width: trunkStroke,
      segments: [[centerX, baseY, centerX, baseY + trunkLength]],
    },
  ];
  [1, 2 / 3, 1 / 3].forEach((scale, i) => {
    const h = halfBase * scale;
    const left = [centerX - h, baseY];
    const right = [centerX + h, baseY];
    const apex = [centerX, baseY - (h * 4) / 3];
    const segments = [
      [...left, ...apex],
      [...apex, ...right],
    ];
    if (i === 0) segments.push([...left, ...right]);
    const isLit = i === lit;
    strokes.push({
      color: isLit ? palette.gold : palette.canopy[i],
      width: isLit ? litStroke : canopyStroke,
      segments,
      lit: isLit,
    });
  });
  strokes.sort((a, b) => (a.lit ? 1 : 0) - (b.lit ? 1 : 0));

  for (const { color, segments, width } of strokes) {
    const halfStroke = width / 2;
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

// Every icon here is Log's own, so every one lights the middle ring. The family
// mark, with nothing lit, belongs on the marketing surfaces and is drawn there
// in SVG rather than rasterized.
const LOG = RINGS.observe;

const OUTPUTS = [
  // Native app icons. The icon and the adaptive foreground stand on Log's own
  // tile, which Android paints from `android.adaptiveIcon.backgroundColor`. The
  // splash mark stands on the app's ground, because the splash is the app.
  ['assets/icon.png', { size: 1024, inset: 0.66, cornerRadius: 0, lit: LOG, palette: ON_TILE }],
  ['assets/splash-icon.png', { size: 512, transparent: true, inset: 0.54, lit: LOG }],
  ['assets/android-icon-foreground.png', { size: 432, transparent: true, inset: 0.43, lit: LOG, palette: ON_TILE }],
  ['assets/android-icon-monochrome.png', { size: 432, transparent: true, inset: 0.43, lit: LOG, palette: ON_TILE }],

  // The mark alone, on nothing, for empty states inside the app. A PNG rather
  // than a drawn component on purpose: BRAND.md wants empty states derived from
  // this geometry, and rendering it with <Image> needs no SVG dependency, so
  // the mark on a screen comes off the same drawing as the icon rather than
  // a second drawing that can drift from it.
  ['assets/mark.png', { size: 512, transparent: true, inset: 0.9, lit: LOG }],

  // PWA icons, which are what a phone puts on its home screen from the web, so
  // they stand on the tile too. `maskable` fills the canvas because the
  // platform crops it.
  ['public/icons/icon-192.png', { size: 192, inset: 0.68, cornerRadius: 0.22, lit: LOG, palette: ON_TILE }],
  ['public/icons/icon-512.png', { size: 512, inset: 0.68, cornerRadius: 0.22, lit: LOG, palette: ON_TILE }],
  ['public/icons/icon-maskable-512.png', { size: 512, inset: 0.56, cornerRadius: 0, lit: LOG, palette: ON_TILE }],
  ['public/icons/apple-touch-icon.png', { size: 180, inset: 0.68, cornerRadius: 0, lit: LOG, palette: ON_TILE }],

  // The Play Store listing icon. Play wants exactly 512 square and rounds the
  // corners itself, so this is the app icon at listing size. Uploaded by hand
  // in Play Console, never bundled; see PLAY.md.
  ['design/play-icon-512.png', { size: 512, inset: 0.66, cornerRadius: 0, lit: LOG, palette: ON_TILE }],
];

for (const [path, options] of OUTPUTS) {
  write(path, drawIcon(options));
}
