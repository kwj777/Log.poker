/**
 * The Log design system.
 *
 * These are the family's tokens, not Log's own. `BRAND.md` is the source of
 * truth and `src/theme/__tests__/palette.test.ts` parses it and fails if this
 * file drifts from it, because a player who scans a card protector lands on
 * log.poker/chip and reaches this app one tap later, and those two surfaces
 * being different products is the whole thing the shared palette prevents.
 *
 * The constraint that shapes the rest: this is read at a poker table, often in
 * dim light, one-handed, by someone who does not want to look like they are
 * studying a spreadsheet. So high contrast, big targets, almost no chrome, and
 * colour reserved for money and mood.
 *
 * Which is why the accent is gold rather than the felt green it was. Green is
 * what a win is. The old accent sat two degrees of hue from `profit`, so a
 * control and an up session were the same colour to anybody glancing at the
 * screen; gold is 119 degrees away and leaves green meaning money and nothing
 * else. It reads better too, at 7.2:1 on the background against the 6.3:1 it
 * replaced.
 */

export const colors = {
  /** Page background. The family ground: charcoal with a green cast. */
  background: '#1c211f',
  /** Cards and sheets. */
  surface: '#232a27',
  /** Raised elements on a surface: inputs, chips. */
  surfaceRaised: '#2b332f',
  /** Pressed / selected state. The brand's ring. */
  surfaceActive: '#333f39',
  /** The brand's rim. */
  border: '#2e3a35',
  /** The brand's forest, which is also the mark's outer stroke. */
  borderStrong: '#3d4a44',

  /** Gold — the family accent, and never a semantic. */
  accent: '#c9a86a',
  accentMuted: '#c9a86a80',
  accentDim: '#3a3323',
  accentText: '#1c211f',

  text: '#e8e4da',
  textSecondary: '#b7c0ba',
  textTertiary: '#828e89',

  /**
   * Money. Green for up, a warm red for down — never for anything else, which
   * is a promise the accent used to break and now keeps.
   */
  profit: '#37D399',
  loss: '#F0616B',
  neutral: '#b7c0ba',

  /** Tilt meter, 1 (calm) → 5 (tilted). Semantic, so it stays as it was. */
  mood: ['#37D399', '#8FD16A', '#E8C55C', '#F0964E', '#F0616B'] as const,

  danger: '#F0616B',
  overlay: 'rgba(12, 15, 14, 0.84)',
} as const;

/** 4pt grid. Names describe intent so screens stay consistent. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 19, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400' },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
  caption: { fontSize: 12, fontWeight: '500' },
  /** All-caps section labels. */
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
} as const;

/**
 * The web layout is a phone-width column centred on desktop. Anything wider
 * turns a session log into a dashboard, which is the exact aesthetic this app
 * exists to avoid.
 */
export const layout = {
  maxContentWidth: 480,
  /** Minimum touch target — deliberately generous for one-handed table use. */
  tapTarget: 48,
} as const;

/** iOS-style shadow that degrades to elevation on Android and a box-shadow on web. */
export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 6,
} as const;

export const moodColor = (score: number): string =>
  colors.mood[Math.min(4, Math.max(0, Math.round(score) - 1))];

/** Green for a win, red for a loss, grey for exactly nothing. */
export const resultColor = (cents: number | null): string => {
  if (cents === null || cents === 0) return colors.neutral;
  return cents > 0 ? colors.profit : colors.loss;
};
