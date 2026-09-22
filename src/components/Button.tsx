import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { colors, layout, radius, spacing, typography } from '../theme';
import { TapArea, slopFor } from './TapArea';
import { tapFeedback } from './haptics';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'large' | 'medium' | 'small';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  /** Rendered before the label -- an icon or a small badge. */
  leading?: ReactNode;
  style?: ViewStyle;
  /**
   * Announced instead of the label, when the label alone does not say enough.
   *
   * The case it exists for is two buttons that read the same and do different
   * things -- an "Add" beside a pot swing and an "Add" beside a board are one
   * word each and indistinguishable to anybody who cannot see which heading
   * they sit under.
   */
  accessibilityLabel?: string;
  /** Announced to screen readers when the label alone is not enough. */
  accessibilityHint?: string;
  /**
   * On web, renders a real anchor rather than a scripted navigation, so the
   * link can be middle-clicked, copied, and followed by a crawler. Ignored on
   * native, where `onPress` is the whole story.
   */
  href?: string;
}

export const Button = ({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled = false,
  loading = false,
  leading,
  style,
  accessibilityLabel,
  accessibilityHint,
  href,
}: ButtonProps) => {
  const inactive = disabled || loading;

  return (
    <Pressable
      {...(href === undefined ? {} : { href })}
      accessibilityRole={href === undefined ? 'button' : 'link'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={slop(size)}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={() => {
        tapFeedback();
        // With an href, react-native-web renders a real <a> and lets the press
        // handlers run as well, so doing both would open the page twice: once
        // in the tab, once in a pop-up. The anchor is the web path and
        // `onPress` is the native one.
        if (href !== undefined && Platform.OS === 'web') return;
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        pressed && !inactive ? pressedStyles[variant] : null,
        inactive ? styles.inactive : null,
        style,
      ]}
    >
      <TapArea slop={slop(size)} />
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <View style={styles.content}>
          {leading ? <View style={styles.leading}>{leading}</View> : null}
          <Text
            style={[
              styles.label,
              size === 'small' ? typography.label : typography.bodyStrong,
              { color: labelColors[variant] },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  leading: {
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
  inactive: {
    opacity: 0.4,
  },
});

const sizeStyles: Record<Size, ViewStyle> = {
  large: { minHeight: 56, paddingHorizontal: spacing.xl },
  medium: { minHeight: layout.tapTarget, paddingHorizontal: spacing.lg },
  small: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm },
};

/**
 * What each size is short of a real target, made up in touch area.
 *
 * `small` draws at 36 and `layout.tapTarget` is 48, which the rest of this
 * design system treats as the floor -- the chips and the card picker both say
 * so in their own comments. Small is meant to look small; it is not meant to be
 * harder to hit, and it is used in dozens of places.
 *
 * **Vertical only.** Slop on the sides would spread each button into its
 * neighbor: two small buttons in a row sit a `spacing.sm` gap apart, and six
 * points of slop each way would have them overlapping in the middle, so a tap
 * aimed at one could land on the other. Height is the dimension that is short
 * anyway; a button is as wide as its label.
 *
 * The same answer goes to `hitSlop`, which is native, and to `TapArea`, which
 * is the web half of it -- react-native-web drops `hitSlop` entirely, so for
 * as long as this said "made up in touch area" it was saying it about native
 * alone. See `TapArea`.
 */
const slop = (size: Size) => {
  const drawn = sizeStyles[size].minHeight;
  return slopFor(typeof drawn === 'number' ? drawn : layout.tapTarget);
};

const variantStyles: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderColor: colors.danger },
};

const pressedStyles: Record<Variant, ViewStyle> = {
  primary: { opacity: 0.85 },
  secondary: { backgroundColor: colors.surfaceActive },
  ghost: { backgroundColor: colors.surfaceRaised },
  danger: { backgroundColor: colors.surfaceRaised },
};

const labelColors: Record<Variant, string> = {
  primary: colors.accentText,
  secondary: colors.text,
  ghost: colors.textSecondary,
  danger: colors.danger,
};
