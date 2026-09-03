/**
 * Stakes selection: six one-tap presets covering most live cash games, plus a
 * custom entry for everything else (home games in particular run odd structures).
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '../../components/Chip';
import { Text } from '../../components/Text';
import { formatStakes, parseAmount } from '../../domain/money';
import type { Stakes } from '../../domain/types';
import { colors, radius, spacing } from '../../theme';
import { STAKES_PRESETS, stakesEqual } from './defaults';

interface StakesPickerProps {
  value: Stakes;
  onChange: (stakes: Stakes) => void;
}

export const StakesPicker = ({ value, onChange }: StakesPickerProps) => {
  const matchesPreset = STAKES_PRESETS.some((preset) => stakesEqual(preset, value));
  const [custom, setCustom] = useState(!matchesPreset);
  const [small, setSmall] = useState(String(value.smallBlind / 100));
  const [big, setBig] = useState(String(value.bigBlind / 100));

  const commit = (nextSmall: string, nextBig: string) => {
    const smallBlind = parseAmount(nextSmall);
    const bigBlind = parseAmount(nextBig);
    // Only propagate a complete, sane pair -- a half-typed "1/" should leave the
    // stored stakes untouched rather than briefly writing $1/$0.
    if (smallBlind === null || bigBlind === null || smallBlind <= 0 || bigBlind <= 0) return;
    onChange({ ...value, smallBlind, bigBlind });
  };

  return (
    <View>
      <View style={styles.chips}>
        {STAKES_PRESETS.map((preset) => (
          <Chip
            key={formatStakes(preset)}
            label={formatStakes(preset)}
            selected={!custom && stakesEqual(preset, value)}
            onPress={() => {
              setCustom(false);
              onChange({ ...preset });
            }}
          />
        ))}
        <Chip label="Custom" selected={custom} onPress={() => setCustom(true)} />
      </View>

      {custom ? (
        <View style={styles.customRow}>
          <TextInput
            value={small}
            onChangeText={(text) => {
              setSmall(text);
              commit(text, big);
            }}
            placeholder="SB"
            placeholderTextColor={colors.textTertiary}
            keyboardType={Platform.OS === 'web' ? 'numeric' : 'decimal-pad'}
            inputMode="decimal"
            style={styles.input}
            accessibilityLabel="Small blind"
          />
          <Text variant="heading" color={colors.textTertiary}>
            /
          </Text>
          <TextInput
            value={big}
            onChangeText={(text) => {
              setBig(text);
              commit(small, text);
            }}
            placeholder="BB"
            placeholderTextColor={colors.textTertiary}
            keyboardType={Platform.OS === 'web' ? 'numeric' : 'decimal-pad'}
            inputMode="decimal"
            style={styles.input}
            accessibilityLabel="Big blind"
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
    ...Platform.select({ web: { outlineStyle: 'none' as 'solid' }, default: {} }),
  },
});
