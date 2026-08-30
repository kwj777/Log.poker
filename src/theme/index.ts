/**
 * The Log design system.
 *
 * Dark, low-chroma charcoal with felt green as the single accent — the palette
 * the whole app family shares. The constraint that shapes it: this is read at a
 * poker table, often in dim light, one-handed, by someone who does not want to
 * look like they are studying a spreadsheet. So: high contrast, big targets,
 * almost no chrome, and colour reserved for money and mood.
 */

export const colors = {
  /** Page background — near-black with a green cast, not pure #000. */
  background: '#0E1311',
  /** Cards and sheets. */
  surface: '#161D1A',
  /** Raised elements on a surface: inputs, chips. */
  surfaceRaised: '#1F2926',
  /** Pressed / selected state. */
  surfaceActive: '#2A3733',
  border: '#2A3733',
  borderStrong: '#3A4A45',

  /** Felt green — the family accent. */
  accent: '#1FA97A',
  accentMuted: '#17755480',
  accentDim: '#0F3D2E',
  accentText: '#062018',

  text: '#F2F5F4',
  textSecondary: '#9DAAA5',
  textTertiary: '#6B7A75',

  /** Money. Green for up, a warm red for down — never for anything else. */
  profit: '#37D399',
  loss: '#F0616B',
  neutral: '#9DAAA5',

  /** Tilt meter, 1 (calm) → 5 (tilted). */
  mood: ['#37D399', '#8FD16A', '#E8C55C', '#F0964E', '#F0616B'] as const,

  danger: '#F0616B',
  overlay: 'rgba(6, 10, 9, 0.82)',
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
