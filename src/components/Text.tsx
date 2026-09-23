/**
 * Typography primitives. Screens compose these rather than reaching for raw
 * `<Text>` with ad-hoc styles, which is what keeps a 12-screen app looking like
 * one app.
 *
 * ## Dynamic Type, bounded
 *
 * Every string in Log comes through here, which makes this the one place a cap
 * can be set at all. Without one the largest accessibility sizes scale a 40pt
 * bankroll figure past three times its size, and the rows and tiles it sits in
 * have fixed heights -- so the number somebody turned the text size up to read
 * is the first thing to get clipped.
 *
 * Scaling is left **on**, which is the point: the caps below are per variant
 * because the variants do not need the same headroom. Body text at 16pt has a
 * long way to grow before anything breaks and gets the most; `display` is
 * already 40pt and gets the least, since a third again is 53pt and wider than
 * a phone on its own. A player who has asked for larger text still gets larger
 * text everywhere, and the layout still holds at the top of the range.
 *
 * `StatTile` additionally shrinks its value to fit (`numberOfLines` plus
 * `adjustsFontSizeToFit`), which is the belt to this suspenders and the reason
 * the tiles were the one thing already safe.
 */

import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography } from '../theme';

type Variant = keyof typeof typography;

/**
 * How far past its own size each variant may grow, largest type capped hardest.
 *
 * Numbers rather than one constant because 40pt and 11pt are not the same
 * problem: the overline is small enough that doubling it still fits a chip,
 * and the display figure is not.
 *
 * Exported because a `TextInput` is not a `Text` and does not come through
 * this file, so the caps have to be reachable from the one place that draws
 * type large enough to matter. `AmountInput` reads `display` and sizes its box
 * from it.
 */
export const MAX_SCALE: Record<Variant, number> = {
  display: 1.3,
  title: 1.4,
  heading: 1.5,
  body: 1.8,
  bodyStrong: 1.8,
  label: 1.8,
  caption: 1.9,
  overline: 2,
};

export interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  center?: boolean;
}

export const Text = ({
  variant = 'body',
  color,
  center,
  style,
  ...rest
}: TextProps) => (
  <RNText
    maxFontSizeMultiplier={MAX_SCALE[variant]}
    style={[
      styles.base,
      typography[variant] as object,
      color ? { color } : null,
      center ? styles.center : null,
      style,
    ]}
    // After the cap rather than before it, so a caller that has measured its
    // own case can still say so.
    {...rest}
  />
);

/** All-caps section label -- used above every group of controls. */
export const Overline = ({ style, ...rest }: TextProps) => (
  <Text
    variant="overline"
    color={colors.textTertiary}
    style={[styles.overline, style]}
    {...rest}
  />
);

const styles = StyleSheet.create({
  base: {
    color: colors.text,
  },
  center: {
    textAlign: 'center',
  },
  overline: {
    textTransform: 'uppercase',
  },
});
