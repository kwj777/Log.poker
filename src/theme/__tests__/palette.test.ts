/**
 * The palette is pinned to BRAND.md rather than to a copy of it.
 *
 * This test parses the family's own table and fails if `src/theme` drifts, so
 * the shared identity survives somebody editing one file and not the other.
 * That mattered enough to write down: the app shipped a felt-green accent and
 * its own charcoal for a while, so a player scanning a card protector met a
 * gold page and then a green app one tap later.
 *
 * The semantic colours are deliberately not pinned. Profit, loss and the tilt
 * meter mean something rather than brand something, and BRAND.md does not
 * define them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { colors } from '../index';

const ROOT = join(__dirname, '..', '..', '..');
const brand = readFileSync(join(ROOT, 'BRAND.md'), 'utf8');
const iconScript = readFileSync(join(ROOT, 'scripts', 'generate-icons.mjs'), 'utf8');

/** Every `| Name | \`#hex\` | ... |` row of the palette table, lowercased. */
const declared = new Map<string, string[]>(
  [...brand.matchAll(/^\|\s*([A-Za-z]+)\s*\|\s*(`#[0-9a-fA-F]{6}`(?:\s*\/\s*`#[0-9a-fA-F]{6}`)?)\s*\|/gm)].map(
    (row) => [row[1].toLowerCase(), [...row[2].matchAll(/#[0-9a-fA-F]{6}/g)].map((h) => h[0].toLowerCase())],
  ),
);

const brandColor = (token: string, index = 0): string => {
  const hexes = declared.get(token);
  if (!hexes?.[index]) throw new Error(`BRAND.md declares no ${token}[${index}]`);
  return hexes[index];
};

describe('the palette table parses', () => {
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
  /** MARK_COLORS, outermost first, as `#rrggbb`. */
  const markColours = [
    ...iconScript.slice(iconScript.indexOf('const MARK_COLORS')).matchAll(/\[(0x[0-9a-f]{2}(?:, 0x[0-9a-f]{2}){2})\]/g),
  ]
    .slice(0, 3)
    .map((m) => `#${m[1].split(', ').map((b) => b.slice(2)).join('')}`);

  it('takes its outer two strokes straight from the table', () => {
    expect(markColours[0]).toBe(brandColor('gold'));
    expect(markColours[1]).toBe(brandColor('sage'));
  });

  it('lifts the inner stroke off forest, which is a border colour', () => {
    expect(markColours[2]).not.toBe(brandColor('forest'));
    expect(markColours[2]).toBe('#55665e');
  });

  it('draws one baseline rather than three', () => {
    // Three coincident bases stripe the line into three colours. Only the
    // outermost triangle is closed; see BRAND.md.
    expect(iconScript).toContain('if (i === 0) segments.push([...left, ...right]);');
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

describe('colour still means one thing', () => {
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

  it('keeps the accent well clear of the money colours', () => {
    // It used to be two degrees from profit, so a control and an up session
    // were the same colour at a glance. This is the assertion that regression
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
