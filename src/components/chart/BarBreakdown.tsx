/**
 * Profit by category, as a diverging bar list.
 *
 * Bars grow right from a center line for a win and left for a loss, scaled to
 * the largest absolute value on screen -- so the shape of a player's game
 * (crushing $1/$2, bleeding at $2/$5) is readable in one glance without axes.
 */

import { StyleSheet, View } from 'react-native';

import { formatMoney } from '../../domain/money';
import type { GroupTotals } from '../../domain/stats';
import { colors, radius, resultColor, spacing } from '../../theme';
import { Text } from '../Text';

interface BarBreakdownProps {
  groups: readonly GroupTotals[];
  currency?: string;
  /** Caps the list; the rest are summarized in a trailing line. */
  limit?: number;
}

export const BarBreakdown = ({ groups, currency = 'USD', limit = 6 }: BarBreakdownProps) => {
  if (groups.length === 0) {
    return (
      <Text variant="caption" color={colors.textTertiary}>
        Nothing to break down yet.
      </Text>
    );
  }

  const shown = groups.slice(0, limit);
  const scale = Math.max(...groups.map((group) => Math.abs(group.net)), 1);

  return (
    <View style={styles.list}>
      {shown.map((group) => {
        const magnitude = Math.abs(group.net) / scale;
        const positive = group.net >= 0;
        return (
          <View key={group.key} style={styles.row}>
            <View style={styles.labels}>
              <Text numberOfLines={1} style={styles.label}>
                {group.label}
              </Text>
              <Text variant="bodyStrong" color={resultColor(group.net)}>
                {formatMoney(group.net, { currency, signed: true })}
              </Text>
            </View>

            <View style={styles.track}>
              <View style={styles.half}>
                {positive ? null : (
                  <View
                    style={[
                      styles.bar,
                      styles.barLeft,
                      { width: `${magnitude * 100}%`, backgroundColor: colors.loss },
                    ]}
                  />
                )}
              </View>
              <View style={styles.centerLine} />
              <View style={styles.half}>
                {positive ? (
                  <View
                    style={[
                      styles.bar,
                      { width: `${magnitude * 100}%`, backgroundColor: colors.profit },
                    ]}
                  />
                ) : null}
              </View>
            </View>

            <Text variant="caption" color={colors.textTertiary}>
              {group.sessionCount} session{group.sessionCount === 1 ? '' : 's'} ·{' '}
              {Math.round(group.hours)}h ·{' '}
              {group.hourly === null
                ? '--'
                : `${formatMoney(group.hourly, { currency, signed: true })}/hr`}
            </Text>
          </View>
        );
      })}

      {groups.length > shown.length ? (
        <Text variant="caption" color={colors.textTertiary}>
          + {groups.length - shown.length} more
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    gap: spacing.lg,
  },
  row: {
    gap: spacing.xs,
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    flex: 1,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 8,
  },
  half: {
    flex: 1,
    height: 8,
    justifyContent: 'center',
  },
  bar: {
    height: 8,
    borderRadius: radius.pill,
  },
  barLeft: {
    alignSelf: 'flex-end',
  },
  centerLine: {
    width: 1,
    height: 12,
    backgroundColor: colors.borderStrong,
  },
});
