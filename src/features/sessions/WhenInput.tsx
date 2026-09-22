/**
 * When a session started, and how long it ran.
 *
 * Two controls, because they are the two things a player actually knows. A
 * start is a date and a wall-clock time. A length is "about four hours" -- and
 * it is the number worth asking for rather than an end time, because the case
 * this exists for is a session somebody forgot to cash out. They do not know
 * when the app thinks it ended; they know how long they played.
 *
 * Typed rather than picked. See `domain/clock.ts` for why there is no date
 * picker here and what the parsing has to be careful about.
 */

import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '../../components/Text';
import { colors, radius, spacing, typography } from '../../theme';

interface FieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  flex?: number;
}

const Field = ({ value, onChangeText, placeholder, accessibilityLabel, flex = 1 }: FieldProps) => (
  <TextInput
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={colors.textTertiary}
    // Not a numeric keypad: a date carries hyphens and a time a colon, and a
    // pad without them is a field nobody can finish typing on a phone.
    autoCapitalize="none"
    autoCorrect={false}
    accessibilityLabel={accessibilityLabel}
    style={[styles.input, { flex }]}
  />
);

interface StartedAtInputProps {
  date: string;
  time: string;
  onChangeDate: (value: string) => void;
  onChangeTime: (value: string) => void;
  /** Said under the fields when what is typed cannot be read as a moment. */
  invalid?: boolean;
  /**
   * What to say instead of the default complaint, when the fields parse but
   * the moment they make is wrong in some other way -- a start in the future
   * being the one this exists for.
   */
  hint?: string;
}

export const StartedAtInput = ({
  date,
  time,
  onChangeDate,
  onChangeTime,
  invalid = false,
  hint,
}: StartedAtInputProps) => (
  <View>
    <View style={styles.row}>
      <Field
        value={date}
        onChangeText={onChangeDate}
        placeholder="2026-09-21"
        accessibilityLabel="Start date"
        flex={2}
      />
      <Field
        value={time}
        onChangeText={onChangeTime}
        placeholder="19:45"
        accessibilityLabel="Start time"
      />
    </View>
    <Text
      variant="caption"
      color={invalid ? colors.loss : colors.textTertiary}
      style={styles.hint}
    >
      {hint ??
        (invalid
          ? 'That is not a date and a time. Use 2026-09-21 and 19:45.'
          : 'Year-month-day, then the clock time you sat down.')}
    </Text>
  </View>
);

interface DurationInputProps {
  hours: string;
  minutes: string;
  onChangeHours: (value: string) => void;
  onChangeMinutes: (value: string) => void;
  /** Said under the fields, usually the end time this works out to. */
  hint: string;
  invalid?: boolean;
}

export const DurationInput = ({
  hours,
  minutes,
  onChangeHours,
  onChangeMinutes,
  hint,
  invalid = false,
}: DurationInputProps) => (
  <View>
    <View style={styles.row}>
      <TextInput
        value={hours}
        onChangeText={onChangeHours}
        placeholder="4"
        placeholderTextColor={colors.textTertiary}
        keyboardType={Platform.OS === 'web' ? 'numeric' : 'decimal-pad'}
        inputMode="decimal"
        accessibilityLabel="Hours played"
        style={[styles.input, styles.number]}
      />
      <Text color={colors.textTertiary}>hours</Text>
      <TextInput
        value={minutes}
        onChangeText={onChangeMinutes}
        placeholder="30"
        placeholderTextColor={colors.textTertiary}
        keyboardType={Platform.OS === 'web' ? 'numeric' : 'number-pad'}
        inputMode="numeric"
        accessibilityLabel="Minutes played"
        style={[styles.input, styles.number]}
      />
      <Text color={colors.textTertiary}>minutes</Text>
    </View>
    <Text
      variant="caption"
      color={invalid ? colors.loss : colors.textTertiary}
      style={styles.hint}
    >
      {hint}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  number: {
    flex: 1,
    textAlign: 'center',
  },
  hint: {
    marginTop: spacing.sm,
    lineHeight: 18,
  },
});
