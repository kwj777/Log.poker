/**
 * One session in a list.
 *
 * Result on the right in green or red, because that is the column a player's eye
 * runs down. Everything else is context in one line: when, where, how long.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { formatMoney, formatStakes } from '../../domain/money';
import { durationMs, formatDuration, netResult } from '../../domain/stats';
import type { SessionWithChildren } from '../../domain/types';
import { Card } from '../../components/Card';
import { colors, resultColor, spacing } from '../../theme';
import { formatRelativeDay } from './format';

interface SessionRowProps {
  session: SessionWithChildren;
  onPress: () => void;
  /** Renders as a standalone card rather than a row inside one. */
  standalone?: boolean;
}

export const SessionRow = ({ session, onPress, standalone = false }: SessionRowProps) => {
  const net = netResult(session, session.rebuys);
  const live = session.endedAt === null;
  const currency = session.stakes.currency;

  const content = (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {session.venue?.name ?? 'Unknown venue'}
        </Text>
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
          {formatRelativeDay(session.startedAt)} · {formatStakes(session.stakes)} ·{' '}
          {session.gameType} · {formatDuration(durationMs(session))}
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

  if (standalone) {
    return (
      <Card onPress={onPress} accessibilityLabel={`Session at ${session.venue?.name ?? 'unknown venue'}`}>
        {content}
      </Card>
    );
  }

  return (
    <Card
      onPress={onPress}
      style={styles.inline}
      accessibilityLabel={`Session at ${session.venue?.name ?? 'unknown venue'}`}
    >
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
