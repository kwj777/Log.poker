import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';

interface CardProps {
  children: ReactNode;
  /** Makes the whole card a tap target. */
  onPress?: () => void;
  /**
   * `StyleProp` rather than a bare `ViewStyle`, so a component that takes a
   * `style` of its own can pass an array straight through instead of casting.
   */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const Card = ({ children, onPress, style, accessibilityLabel }: CardProps) => {
  if (!onPress) {
    return <View style={[styles.card, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null, style]}
    >
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  pressed: {
    backgroundColor: colors.surfaceRaised,
  },
});
