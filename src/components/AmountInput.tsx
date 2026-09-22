/**
 * Money entry.
 *
 * Opens the numeric keypad, shows the currency symbol as a fixed prefix rather
 * than making the player type it, and offers one-tap presets for the amounts
 * they actually buy in for. The presets are the point: they turn a five-keystroke
 * entry into a single tap.
 */

import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { currencySymbol, formatMoney, parseAmount } from '../domain/money';
import { colors, layout, radius, spacing, typography } from '../theme';
import { tapFeedback } from './haptics';
import { Text } from './Text';

/** What a preset draws at. Deliberately under a chip: it is the secondary control here. */
const PRESET_HEIGHT = 40;

/**
 * The eight points it draws short of `layout.tapTarget`, made up in touch area.
 *
 * The same trade `Button.slopFor` makes and for the same reason: a preset is
 * meant to look smaller than the field above it, and is not meant to be harder
 * to hit than one. "The presets are the point", per the header, and they had
 * the largest shortfall of any control in the app and no slop at all.
 *
 * **Vertical only.** Presets sit in a wrapping row a `spacing.sm` gap apart, so
 * four points of slop each way would have neighbors overlapping in the middle
 * and a tap aimed at $300 could land on $400 -- which, unlike a miss, writes a
 * number the player did not choose.
 */
const PRESET_SLOP = {
  top: Math.ceil((layout.tapTarget - PRESET_HEIGHT) / 2),
  bottom: Math.ceil((layout.tapTarget - PRESET_HEIGHT) / 2),
};

interface AmountInputProps {
  value: string;
  onChangeText: (value: string) => void;
  currency?: string;
  placeholder?: string;
  /** Preset amounts in cents, rendered as one-tap buttons beneath the field. */
  presets?: readonly number[];
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  accessibilityLabel?: string;
}

export const AmountInput = ({
  value,
  onChangeText,
  currency = 'USD',
  placeholder = '0',
  presets,
  autoFocus,
  onSubmitEditing,
  accessibilityLabel,
}: AmountInputProps) => (
  <View>
    <View style={styles.field}>
      <Text variant="title" color={colors.textTertiary} style={styles.symbol}>
        {currencySymbol(currency)}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        // `decimal-pad` gives the big numeric keypad without a return key that
        // would submit a half-typed amount.
        keyboardType={Platform.OS === 'web' ? 'numeric' : 'decimal-pad'}
        inputMode="decimal"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        selectTextOnFocus
        accessibilityLabel={accessibilityLabel}
        style={styles.input}
      />
    </View>

    {presets && presets.length > 0 ? (
      <View style={styles.presets}>
        {presets.map((preset) => {
          const selected = parseAmount(value) === preset;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={PRESET_SLOP}
              onPress={() => {
                tapFeedback();
                onChangeText(String(preset / 100));
              }}
              style={({ pressed }) => [
                styles.preset,
                selected ? styles.presetSelected : null,
                pressed ? styles.presetPressed : null,
              ]}
            >
              <Text
                style={typography.label}
                color={selected ? colors.accentText : colors.textSecondary}
              >
                {formatMoney(preset, { currency })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
  },
  symbol: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    paddingVertical: spacing.md,
    // Removes the focus ring web adds to inputs, which does not match the theme.
    ...Platform.select({ web: { outlineStyle: 'none' as 'solid' }, default: {} }),
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  preset: {
    minHeight: PRESET_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  presetSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  presetPressed: {
    backgroundColor: colors.surfaceActive,
  },
});
