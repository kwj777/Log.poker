/**
 * Selectable chips — the app's main input control.
 *
 * Nearly every choice in Log (game type, stakes, position, tag, mood) is a small
 * set of known options, and tapping one chip is faster and far more thumb-friendly
 * than a picker or a dropdown. Chips are sized to the 48pt target so they can be
 * hit without looking.
 */

import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { tapFeedback } from './haptics';
import { Text } from './Text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  /** Overrides the accent for chips that carry their own meaning (mood, tags). */
  tint?: string;
  style?: ViewStyle;
}

export const Chip = ({ label, selected = false, onPress, tint, style }: ChipProps) => {
  const accent = tint ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: accent, borderColor: accent } : null,
        pressed && !selected ? styles.pressed : null,
        style,
      ]}
    >
      <Text
        style={[
          typography.label,
          { color: selected ? colors.accentText : colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export interface Option<T> {
  value: T;
  label: string;
  tint?: string;
}

interface ChipGroupProps<T> {
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Lays the chips out in one horizontally scrolling row instead of wrapping. */
  scroll?: boolean;
  style?: ViewStyle;
}

export const ChipGroup = <T,>({ options, value, onChange, scroll, style }: ChipGroupProps<T>) => {
  const chips = options.map((option) => (
    <Chip
      key={String(option.value)}
      label={option.label}
      tint={option.tint}
      selected={option.value === value}
      onPress={() => onChange(option.value)}
    />
  ));

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, style]}
      >
        {chips}
      </ScrollView>
    );
  }
  return <View style={[styles.wrap, style]}>{chips}</View>;
};

/** Multi-select variant — used for hand tags, where more than one can apply. */
interface ChipMultiGroupProps<T> {
  options: readonly Option<T>[];
  values: readonly T[];
  onToggle: (value: T) => void;
  style?: ViewStyle;
}

export const ChipMultiGroup = <T,>({
  options,
  values,
  onToggle,
  style,
}: ChipMultiGroupProps<T>) => (
  <View style={[styles.wrap, style]}>
    {options.map((option) => (
      <Chip
        key={String(option.value)}
        label={option.label}
        tint={option.tint}
        selected={values.includes(option.value)}
        onPress={() => onToggle(option.value)}
      />
    ))}
  </View>
);

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: {
    backgroundColor: colors.surfaceActive,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
});
