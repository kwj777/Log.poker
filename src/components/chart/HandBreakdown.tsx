/**
 * Logged hands by tag or by seat, as a diverging bar list.
 *
 * ## Why not `BarBreakdown`
 *
 * It draws the same shape and says a different thing. `BarBreakdown` is about
 * sessions: every row reads out a session count, hours and an hourly rate,
 * because those are what a session group has and what makes its bar mean
 * something. A group of hands has none of them, and borrowing that component
 * would have meant three props doing nothing and a row that says "0 hours".
 *
 * ## The count leads, and it is not decoration
 *
 * These are the hands somebody chose to log, not the hands they played -- see
 * the header of `domain/hands.ts`, which is where the reasoning lives. The
 * consequence here is that every row says how many hands it is drawn from
 * before it says any money, and a row where only some hands carry a pot swing
 * says that too. A bar on its own would read as a positional win rate, which
 * is a number this app does not have and must not appear to.
 *
 * The bar is scaled to the largest absolute pot swing on screen, like its
 * sibling, and is hidden from a screen reader for the same reason: it draws
 * the figure the row has already said.
 */

import { StyleSheet, View } from 'react-native';

import { describeGroup, type HandGroup } from '../../domain/hands';
import { formatMoney } from '../../domain/money';
import { colors, radius, resultColor, spacing } from '../../theme';
import { Text } from '../Text';

interface HandBreakdownProps {
  groups: readonly HandGroup[];
  currency?: string;
  /** Said when there is nothing to draw, since the two callers mean different things by it. */
  emptyMessage?: string;
}

export const HandBreakdown = ({
  groups,
  currency = 'USD',
  emptyMessage = 'Nothing to break down yet.',
}: HandBreakdownProps) => {
  if (groups.length === 0) {
    return (
      <Text variant="caption" color={colors.textTertiary}>
        {emptyMessage}
      </Text>
    );
  }

  const scale = Math.max(...groups.map((group) => Math.abs(group.net)), 1);

  return (
    <View style={styles.list}>
      {groups.map((group) => {
        const magnitude = Math.abs(group.net) / scale;
        const positive = group.net >= 0;
        return (
          <View
            key={group.key}
            style={styles.row}
            accessible
            accessibilityLabel={describeGroup(group, (cents) =>
              formatMoney(cents, { currency, signed: true }),
            )}
          >
            <View style={styles.labels}>
              <Text numberOfLines={1} style={styles.label}>
                {group.label}
              </Text>
              <Text variant="caption" color={colors.textTertiary}>
                {group.count} hand{group.count === 1 ? '' : 's'}
              </Text>
              <Text
                variant="bodyStrong"
                color={group.withAmount === 0 ? colors.textTertiary : resultColor(group.net)}
              >
                {group.withAmount === 0
                  ? '--'
                  : formatMoney(group.net, { currency, signed: true })}
              </Text>
            </View>

            {/* Decoration: it draws the figure the row has already said. */}
            <View style={styles.track} importantForAccessibility="no-hide-descendants">
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

            {/*
              Only when it is not the whole group. "3 of 12 with a pot" is the
              caveat that stops the figure above being read as twelve hands'
              worth of money; "12 of 12" is noise.
            */}
            {group.withAmount > 0 && group.withAmount < group.count ? (
              <Text variant="caption" color={colors.textTertiary}>
                {group.withAmount} of {group.count} with a pot recorded
              </Text>
            ) : null}
          </View>
        );
      })}
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
