/**
 * One session in a list.
 *
 * Result on the right in green or red, because that is the column a player's eye
 * runs down. Everything else is context in one line: when, where, how long.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { formatEntry, formatMoney, formatStakes } from '../../domain/money';
import { formatFinish } from '../../domain/tournaments';
import { durationMs, formatDuration, netResult } from '../../domain/stats';
import type { SessionWithChildren } from '../../domain/types';
import { Card } from '../../components/Card';
import { colors, resultColor, spacing } from '../../theme';
import { formatRelativeDay } from './format';

interface SessionRowProps {
  session: SessionWithChildren;
  onPress: () => void;
}

export const SessionRow = ({ session, onPress }: SessionRowProps) => {
  const net = netResult(session, session.rebuys);
  const live = session.endedAt === null;
  const { currency } = session;
  // A tournament describes itself by what it cost and where it finished; a cash
  // game by its stakes. Neither reads as the other, so they do not share a line.
  const descriptor =
    session.format === 'tournament'
      ? [formatEntry(session.buyIn, session.fee, currency), formatFinish(session.finishPosition, session.entrants)]
          .filter((part): part is string => part !== null)
          .join(' · ')
      : session.stakes === null
        ? session.gameType
        : `${formatStakes(session.stakes, currency)} · ${session.gameType}`;

  /**
   * Everything the row draws, in the order it draws it.
   *
   * `Card` renders a `Pressable`, and a `Pressable` groups its children into
   * one element, so a label on it is not a hint alongside the content -- it is
   * the whole of what is announced. This said "Session at Aria" over a row
   * whose point is the figure on the right, so the date, the stakes, the
   * length and the result were drawn and never spoken, and ten nights at one
   * room read as ten identical rows.
   *
   * The same strings the row shows, because a name that paraphrases what is on
   * screen is a second copy of it to keep true.
   */
  const spoken = [
    `Session at ${session.venue?.name ?? 'unknown venue'}`,
    formatRelativeDay(session.startedAt),
    descriptor,
    formatDuration(durationMs(session)),
    live ? 'Live' : formatMoney(net ?? 0, { currency, signed: true }),
  ].join(', ');

  // Named so a test can count how many of these a long history actually
  // mounts, which is the difference between a virtualized list and a loop.
  const content = (
    <View style={styles.row} testID="session-row">
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {session.venue?.name ?? 'Unknown venue'}
        </Text>
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
          {formatRelativeDay(session.startedAt)} · {descriptor} ·{' '}
          {formatDuration(durationMs(session))}
        </Text>
      </View>

      {live ? (
        <View style={styles.liveBadge}>
          <Text variant="caption" color={colors.accentText}>
            Live
          </Text>
        </View>
      ) : (
        <Text variant="bodyStrong" color={resultColor(net)}>
          {formatMoney(net ?? 0, { currency, signed: true })}
        </Text>
      )}
    </View>
  );

  return (
    <Card onPress={onPress} style={styles.inline} accessibilityLabel={spoken}>
      {content}
    </Card>
  );
};

const styles = StyleSheet.create({
  inline: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  liveBadge: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
