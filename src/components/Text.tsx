/**
 * Typography primitives. Screens compose these rather than reaching for raw
 * `<Text>` with ad-hoc styles, which is what keeps a 12-screen app looking like
 * one app.
 */

import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography } from '../theme';

type Variant = keyof typeof typography;

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
    style={[
      styles.base,
      typography[variant] as object,
      color ? { color } : null,
      center ? styles.center : null,
      style,
    ]}
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
