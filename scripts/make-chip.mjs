/**
 * Rasterize the chip faces for the vendor's proof.
 *
 *   npm run chip              # both border options for the 47mm chip
 *   node scripts/make-chip.mjs 47 43   # any other art diameters, in mm
 *
 * A by-hand tool whose output is committed, like the icons, and a page rather
 * than a drawing for the same reason the guides are pages: these set type, so
 * they want the layout engine and the font stacks.
 *
 * Every face's artboard is 2000x2000 whatever the diameter, standing for the
 * art circle plus 3mm of bleed on each side. At 47mm that is 53mm across, or
 * 37.7px/mm, about 960dpi at the trim: far past what a chip printer asks for,
 * and cheap because flat color on felt compresses to well under a megabyte.
 * Both faces clear the vendor form's 10MB ceiling by an order of magnitude.
 *
 * The QR is regenerated first, so the code on the face cannot fall behind the
 * URL it is supposed to carry.
 *
 * Two files per size go to the vendor, side 1 and side 2. The proof sheet is
 * for looking at: guides in uploaded art get printed.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openRasterizer } from './lib/rasterize.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHIP = join(ROOT, 'design', 'chip');

/**
 * Custom Made Casino's chip is 47mm and its border is optional. Without one the
 * art runs the whole 47mm; with one it fills the 43mm window inside it. Both
 * are rendered because it is a choice somebody has to look at to make, and the
 * recommendation, no border, is in README.md.
 *
 * Sizes here are always the art circle, never the chip.
 */
const CHIP_MM = 47;
const DEFAULT_SIZES = [47, 43];

const sizes = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : DEFAULT_SIZES;

if (sizes.some((mm) => !Number.isFinite(mm) || mm <= 0)) {
  console.error('make-chip.mjs: sizes are diameters in mm, e.g. "47"');
  process.exit(1);
}

/** Per art diameter: the two files that get sent, and the proof that does not. */
const perSize = (mm) => {
  const edge = mm >= CHIP_MM ? 'no-border' : 'bordered';
  return [
    { source: 'side-1.html', out: `log-chip-${mm}mm-side-1.png`, width: 2000, height: 2000,
      query: `?mm=${mm}` },
    { source: 'side-2.html', out: `log-chip-${mm}mm-side-2.png`, width: 2000, height: 2000,
      query: `?mm=${mm}` },
    { source: 'proof.html', out: `log-chip-${mm}mm-${edge}-proof.png`, width: 2400, height: 1400,
      query: `?mm=${mm}&chip=${CHIP_MM}` },
  ];
};

// The code first, so a changed campaign URL cannot leave a stale matrix on a
// face that is about to be rendered and sent.
execFileSync('node', [join(ROOT, 'scripts', 'make-qr.mjs')], { stdio: 'inherit' });

const render = openRasterizer('make-chip.mjs');
try {
  for (const mm of sizes) {
    for (const target of perSize(mm)) {
      const png = render.shot({
        file: join(CHIP, target.source) + target.query,
        width: target.width,
        height: target.height,
      });
      writeFileSync(join(CHIP, target.out), png);
      console.log(
        `${target.out.padEnd(34)} ${target.width}x${target.height}  ` +
          `${Math.round(png.length / 102.4) / 10}KB  <- ${target.source}${target.query}`,
      );
    }
  }
} finally {
  render.close();
}
