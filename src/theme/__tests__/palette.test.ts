/**
 * The palette is pinned to BRAND.md rather than to a copy of it.
 *
 * This test parses the family's own table and fails if `src/theme` drifts, so
 * the shared identity survives somebody editing one file and not the other.
 * That mattered enough to write down: the app shipped a felt-green accent and
 * its own charcoal for a while, so a player scanning a card protector met a
 * gold page and then a green app one tap later.
 *
 * The semantic colors are deliberately not pinned. Profit, loss and the tilt
 * meter mean something rather than brand something, and BRAND.md does not
 * define them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { colors } from '../index';

const ROOT = join(__dirname, '..', '..', '..');
const brand = readFileSync(join(ROOT, 'BRAND.md'), 'utf8');
/**
 * Only the palette table. The document has other tables with a name and a hex
 * in them, the canopy ramp's measurements among them, and parsing the whole
 * file swept those up as if they were tokens.
 */
const paletteSection = brand.slice(
  brand.indexOf('## The palette'),
  brand.indexOf('##', brand.indexOf('## The palette') + 3),
);
const iconScript = readFileSync(join(ROOT, 'scripts', 'generate-icons.mjs'), 'utf8');

/** Every `| Name | \`#hex\` | ... |` row of the palette table, lowercased. */
const declared = new Map<string, string[]>(
  [...paletteSection.matchAll(/^\|\s*([A-Za-z]+)\s*\|\s*(`#[0-9a-fA-F]{6}`(?:\s*\/\s*`#[0-9a-fA-F]{6}`)?)\s*\|/gm)].map(
    (row) => [row[1].toLowerCase(), [...row[2].matchAll(/#[0-9a-fA-F]{6}/g)].map((h) => h[0].toLowerCase())],
  ),
);

const brandColor = (token: string, index = 0): string => {
  const hexes = declared.get(token);
  if (!hexes?.[index]) throw new Error(`BRAND.md declares no ${token}[${index}]`);
  return hexes[index];
};

describe('the palette table parses', () => {
  it('lists the canopy ramp, whose names are two words and so are not tokens', () => {
    for (const ring of ['#9aae80', '#75886a', '#55665e']) {
      expect(paletteSection).toContain(ring);
    }
  });

  it('finds every token the app needs', () => {
    expect([...declared.keys()].sort()).toEqual(
      ['cream', 'forest', 'gold', 'ground', 'muted', 'rim', 'ring', 'sage'].sort(),
    );
  });
});

describe('the app implements the family palette', () => {
  it.each([
    ['background', 'ground', 0],
    ['border', 'rim', 0],
    ['surfaceActive', 'ring', 0],
    ['borderStrong', 'forest', 0],
    ['accent', 'gold', 0],
    ['text', 'cream', 0],
    ['textSecondary', 'muted', 0],
    ['textTertiary', 'muted', 1],
  ] as const)('%s is the brand %s', (token, brandToken, index) => {
    expect(colors[token].toLowerCase()).toBe(brandColor(brandToken, index));
  });

  it('tints the accent from the gold rather than from anything else', () => {
    expect(colors.accentMuted.toLowerCase().slice(0, 7)).toBe(brandColor('gold'));
  });

  it('puts the ground on the accent, so a gold button reads as one', () => {
    expect(colors.accentText.toLowerCase()).toBe(brandColor('ground'));
  });
});

describe('the generated icons draw the family mark', () => {
  /** CANOPY, outermost first, as `#rrggbb`. */
  const canopy = [
    ...iconScript.slice(iconScript.indexOf('const CANOPY')).matchAll(/\[(0x[0-9a-f]{2}(?:, 0x[0-9a-f]{2}){2})\]/g),
  ]
    .slice(0, 3)
    .map((m) => `#${m[1].split(', ').map((b) => b.slice(2)).join('')}`);

  const luminance = (hex: string): number => {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onGround = (hex: string): number => {
    const [hi, lo] = [luminance(hex), luminance(brandColor('ground'))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('climbs past sage rather than below it', () => {
    // The palette's own three greens run 1.76, 2.68 and 3.55 on the ground,
    // which is one step and a rumor: the darkest is already invisible.
    expect(onGround(canopy[0])).toBeGreaterThan(onGround(brandColor('sage')));
    expect(canopy).not.toContain(brandColor('forest'));
  });

  it('is evenly spaced, and lightest on the outside', () => {
    const steps = [onGround(canopy[0]) / onGround(canopy[1]), onGround(canopy[1]) / onGround(canopy[2])];
    for (const step of steps) expect(step).toBeGreaterThan(1.3);
    expect(Math.abs(steps[0] - steps[1])).toBeLessThan(0.25);
    // Lightest outermost, so the silhouette is the strongest line.
    expect(onGround(canopy[0])).toBeGreaterThan(onGround(canopy[2]));
  });

  it('keeps the gold out of the canopy and on the trunk', () => {
    expect(canopy).not.toContain(brandColor('gold'));
    expect(iconScript).toContain('const GOLD = [0xc9, 0xa8, 0x6a];');
  });

  it('draws one baseline rather than three', () => {
    // Three coincident bases stripe the line into three colors. Only the
    // outermost triangle is closed; see BRAND.md.
    expect(iconScript).toContain('if (i === 0) segments.push([...left, ...right]);');
  });

  it('lights exactly one ring per app, and none for the family', () => {
    expect(iconScript).toContain("export const RINGS = { ground: 0, observe: 1, learn: 2 };");
    // Log is Observe, so every icon this script writes lights the middle ring.
    // Counted against the output list rather than against a number typed here,
    // which is what a file that drops an icon leaves stale: this said 10 and
    // the list is as long as it is.
    expect(iconScript).toContain('const LOG = RINGS.observe;');
    const drawn = iconScript.match(/^ {2}\['[^']+', \{/gm) ?? [];
    expect(drawn.length).toBeGreaterThan(0);
    expect(iconScript.match(/lit: LOG/g)?.length).toBe(drawn.length);
  });
});

describe('the mark reaches the app itself', () => {
  it('exists as an asset, generated rather than drawn twice', () => {
    expect(existsSync(join(ROOT, 'assets', 'mark.png'))).toBe(true);
    expect(iconScript).toContain("['assets/mark.png'");
    expect(iconScript).toContain('transparent: true');
  });

  it('and the empty states use those bytes rather than a second drawing', () => {
    // BRAND.md asks that icons, favicons and empty states all derive from the
    // same geometry. A component redrawing it is a copy free to drift.
    const empty = readFileSync(join(ROOT, 'src', 'components', 'EmptyState.tsx'), 'utf8');
    expect(empty).toContain("require('../../assets/mark.png')");
    expect(empty).toContain('<Image source={MARK}');
  });
});

describe('color still means one thing', () => {
  /** Relative luminance, per WCAG. */
  const luminance = (hex: string): number => {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** Hue in degrees, which is what tells a control apart from a result. */
  const hue = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const span = max - Math.min(r, g, b);
    if (span === 0) return 0;
    const raw =
      max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
    return (raw * 60 + 360) % 360;
  };
  const apart = (a: string, b: string): number => {
    const d = Math.abs(hue(a) - hue(b));
    return Math.min(d, 360 - d);
  };

  it('keeps the accent well clear of the money colors', () => {
    // It used to be two degrees from profit, so a control and an up session
    // were the same color at a glance. This is the assertion that regression
    // would have to get past.
    expect(apart(colors.accent, colors.profit)).toBeGreaterThan(60);
    expect(apart(colors.accent, colors.loss)).toBeGreaterThan(30);
  });

  it.each([
    ['text', 7],
    ['textSecondary', 4.5],
    ['textTertiary', 4.5],
    ['accent', 4.5],
    ['profit', 4.5],
    ['loss', 4.5],
  ] as const)('reads %s against the background', (token, floor) => {
    expect(contrast(colors[token] as string, colors.background)).toBeGreaterThanOrEqual(floor);
  });

  it('reads the label on a primary button', () => {
    expect(contrast(colors.accentText, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
