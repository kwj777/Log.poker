/**
 * Selectable chips -- the app's main input control.
 *
 * Nearly every choice in Log (game type, stakes, position, tag, mood) is a small
 * set of known options, and tapping one chip is faster and far more thumb-friendly
 * than a picker or a dropdown. Chips are sized to the 48pt target so they can be
 * hit without looking.
 */

import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, layout, radius, spacing, typography } from '../theme';
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

/** Multi-select variant -- used for hand tags, where more than one can apply. */
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
    // From `layout.tapTarget` rather than written out, because the header says
    // chips are sized to it and this read 44. Four points is not much on its
    // own; what made it worth taking from the constant is that it is the only
    // short control in the system that made up none of the shortfall in touch
    // area -- `Button.slopFor`, `SearchField` and `Explain` all derive theirs
    // from this same number -- and that `Button`'s own reasoning cites "the
    // chips ... say so in their own comments" as the authority for treating 48
    // as the floor at all. A stale docstring holding up a second file.
    minHeight: layout.tapTarget,
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
