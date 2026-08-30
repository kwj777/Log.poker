import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, layout, radius, spacing, typography } from '../theme';
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
  /** Rendered before the label — an icon or a small badge. */
  leading?: ReactNode;
  style?: ViewStyle;
  /** Announced to screen readers when the label alone is not enough. */
  accessibilityHint?: string;
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
  accessibilityHint,
}: ButtonProps) => {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={() => {
        tapFeedback();
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
