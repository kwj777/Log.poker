/**
 * Money entry.
 *
 * Opens the numeric keypad, shows the currency symbol as a fixed prefix rather
 * than making the player type it, and offers one-tap presets for the amounts
 * they actually buy in for. The presets are the point: they turn a five-keystroke
 * entry into a single tap.
 */

import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { currencySymbol, formatMoney, parseAmount } from '../domain/money';
import { colors, radius, spacing, typography } from '../theme';
import { TapArea, slopFor } from './TapArea';
import { tapFeedback } from './haptics';
import { Text } from './Text';

/** What a preset draws at. Deliberately under a chip: it is the secondary control here. */
const PRESET_HEIGHT = 40;

/**
 * The eight points it draws short of `layout.tapTarget`, made up in touch area.
 *
 * The same trade `Button`'s `slop` makes and for the same reason: a preset is
 * meant to look smaller than the field above it, and is not meant to be harder
 * to hit than one. "The presets are the point", per the header, and they had
 * the largest shortfall of any control in the app and no slop at all.
 *
 * **Vertical only.** Presets sit in a wrapping row a `spacing.sm` gap apart, so
 * four points of slop each way would have neighbors overlapping in the middle
 * and a tap aimed at $300 could land on $400 -- which, unlike a miss, writes a
 * number the player did not choose.
 *
 * Handed to `hitSlop` for native and to `TapArea` for the web, which drops
 * `hitSlop` on the floor. See `TapArea`.
 */
const PRESET_SLOP = slopFor(PRESET_HEIGHT);

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
        // `decimal` gives the big numeric keypad without a return key that
        // would submit a half-typed amount, and a decimal separator that suits
        // the device's locale.
        //
        // `inputMode` alone, because it is what both runtimes read: react
        // native maps it through `inputModeToKeyboardTypeMap` and ignores
        // `keyboardType` whenever it is set, and react-native-web tests it
        // first and falls through to `keyboardType` only in its absence. The
        // `keyboardType` beside this was dead on both, and on the web arm it
        // asked for the worse of the two keyboards.
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
              <TapArea slop={PRESET_SLOP} />
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
    // **Its height comes from the field, not from the platform's measurement.**
    // Left to size itself, iOS gave this box less room than its own 30pt line
    // needs and clipped the top off the glyph: a placeholder zero drew as a U,
    // in every money field in the app. `flex: 1` only governs the row's main
    // axis, which is the width, so the height was whatever the platform
    // measured and nothing here checked it.
    //
    // Stretching to the field makes the box arithmetic rather than a guess:
    // `minHeight` below, less the padding on this style, is what the text has,
    // and `amountField.test.tsx` holds that difference above the font size.
    alignSelf: 'stretch',
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    paddingVertical: spacing.md,
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
