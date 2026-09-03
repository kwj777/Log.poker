import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { Text } from './Text';

export interface StatTileProps {
  label: string;
  value: string;
  /** Colors the value -- used for money, which is green or red or neither. */
  valueColor?: string;
  hint?: string;
  style?: ViewStyle;
}

export const StatTile = ({ label, value, valueColor, hint, style }: StatTileProps) => (
  <View style={[styles.tile, style]}>
    <Text variant="overline" color={colors.textTertiary} style={styles.label} numberOfLines={1}>
      {label}
    </Text>
    <Text variant="heading" color={valueColor ?? colors.text} numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Text>
    {hint ? (
      <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
        {hint}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 96,
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  label: {
    textTransform: 'uppercase',
  },
});
