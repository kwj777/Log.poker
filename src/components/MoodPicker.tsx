/**
 * The tilt meter.
 *
 * One tap, five states, always skippable. Mood data is only useful if logging it
 * costs nothing -- the moment it feels like homework, players stop, and the
 * correlation between mood and results (the reason it exists) never materialises.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { MOOD_SCALE, type MoodScore } from '../domain/types';
import { colors, moodColor, radius, spacing, typography } from '../theme';
import { tapFeedback } from './haptics';
import { Text } from './Text';

export const MOOD_LABELS: Record<MoodScore, string> = {
  1: 'Calm',
  2: 'Fine',
  3: 'Edgy',
  4: 'Rattled',
  5: 'Tilted',
};

interface MoodPickerProps {
  value: MoodScore | null;
  onChange: (score: MoodScore) => void;
  /** Compact form for the mid-session prompt. */
  compact?: boolean;
}

export const MoodPicker = ({ value, onChange, compact = false }: MoodPickerProps) => (
  <View style={styles.row}>
    {MOOD_SCALE.map((score) => {
      const selected = value === score;
      const tint = moodColor(score);
      return (
        <Pressable
          key={score}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={`${MOOD_LABELS[score]}, ${score} of 5`}
          onPress={() => {
            tapFeedback();
            onChange(score);
          }}
          style={({ pressed }) => [
            styles.option,
            compact ? styles.optionCompact : null,
            selected ? { backgroundColor: tint, borderColor: tint } : null,
            pressed && !selected ? styles.pressed : null,
          ]}
        >
          <Text
            style={[compact ? typography.bodyStrong : typography.heading]}
            color={selected ? colors.accentText : tint}
          >
            {score}
          </Text>
          {compact ? null : (
            <Text
              variant="caption"
              color={selected ? colors.accentText : colors.textTertiary}
              style={styles.label}
              numberOfLines={1}
            >
              {MOOD_LABELS[score]}
            </Text>
          )}
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  optionCompact: {
    minHeight: 52,
  },
  pressed: {
    backgroundColor: colors.surfaceActive,
  },
  label: {
    paddingHorizontal: 2,
  },
});
