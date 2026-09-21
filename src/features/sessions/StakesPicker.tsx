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
  /**
   * What the preset chips are priced in. Defaulted, because the blinds are the
   * point of this control and most callers are in one currency -- but passed by
   * the screens that let a player pick one, since a row of chips reading $1/$2
   * on a session somebody has just marked as pounds is the picker contradicting
   * the screen it sits on.
   */
  currency?: string;
}

/** A blind as the field holding it would read. */
const asField = (cents: number): string => String(cents / 100);

export const StakesPicker = ({ value, onChange, currency }: StakesPickerProps) => {
  const matchesPreset = STAKES_PRESETS.some((preset) => stakesEqual(preset, value));
  const [custom, setCustom] = useState(!matchesPreset);
  /**
   * The two fields, seeded once and then kept in step with the chips.
   *
   * They have to be their own state, because half-typed input is the point: a
   * field reading "1." is not stakes and `commit` refuses to store it, which
   * is what stops a keystroke briefly writing $1/$0. What they must not do is
   * drift from what is stored, and they did: neither chip touched them, so
   * tapping a preset left them holding the blinds they had before it, and
   * tapping Custom put those stale numbers back on screen over stakes that
   * were something else entirely.
   *
   * Then it got worse on the next keystroke, because each field commits itself
   * alongside the other one's current text. Correcting only the big blind
   * wrote the stale small blind back into the session with it, so a player
   * going from the $1/$2 chip to a custom $1/$10 saved $3/$10, with both
   * numbers on screen looking right.
   */
  const [small, setSmall] = useState(asField(value.smallBlind));
  const [big, setBig] = useState(asField(value.bigBlind));

  /** Put the fields where the stakes are, whenever a chip moves the stakes. */
  const fill = (stakes: { smallBlind: number; bigBlind: number }) => {
    setSmall(asField(stakes.smallBlind));
    setBig(asField(stakes.bigBlind));
  };

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
            label={formatStakes(preset, currency)}
            selected={!custom && stakesEqual(preset, value)}
            onPress={() => {
              setCustom(false);
              fill(preset);
              onChange({ ...preset });
            }}
          />
        ))}
        <Chip
          label="Custom"
          selected={custom}
          onPress={() => {
            fill(value);
            setCustom(true);
          }}
        />
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
