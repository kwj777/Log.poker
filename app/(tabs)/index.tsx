/**
 * Dashboard — the app's home.
 *
 * Ordered by what a player wants first: is there a session running, what is my
 * bankroll doing, what are the headline numbers, where is the money actually
 * coming from. The primary action is always "start a session" (or "resume"),
 * because logging is the behaviour the app needs to make effortless.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ChipGroup } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { BarBreakdown } from '../../src/components/chart/BarBreakdown';
import { LineChart } from '../../src/components/chart/LineChart';
import { formatMoney, formatMoneyCompact } from '../../src/domain/money';
import {
  bankrollCurve,
  byGameType,
  byStakes,
  byVenue,
  formatDuration,
  totals,
} from '../../src/domain/stats';
import { SessionRow } from '../../src/features/sessions/SessionRow';
import { useElapsed } from '../../src/features/sessions/LiveTimer';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, resultColor, spacing } from '../../src/theme';

type Breakdown = 'stakes' | 'venue' | 'game';

const BREAKDOWN_OPTIONS = [
  { value: 'stakes' as const, label: 'Stakes' },
  { value: 'venue' as const, label: 'Venue' },
  { value: 'game' as const, label: 'Game' },
];

export default function DashboardScreen() {
  const sessions = useLogStore((state) => state.sessions);
  const venues = useLogStore((state) => state.venues);
  const activeSession = useLogStore((state) => state.activeSession);
  const [breakdown, setBreakdown] = useState<Breakdown>('stakes');

  const summary = useMemo(() => totals(sessions), [sessions]);
  const curve = useMemo(() => bankrollCurve(sessions), [sessions]);
  const groups = useMemo(() => {
    if (breakdown === 'venue') return byVenue(sessions, venues);
    if (breakdown === 'game') return byGameType(sessions);
    return byStakes(sessions);
  }, [breakdown, sessions, venues]);

  const recent = useMemo(
    () => sessions.filter((session) => session.endedAt !== null).slice(0, 5),
    [sessions],
  );

  const chartSeries = useMemo(
    () => [
      {
        points: curve.map((point, index) => ({ x: index, y: point.cumulative })),
        color: summary.net >= 0 ? colors.profit : colors.loss,
        fill: summary.net >= 0 ? 'rgba(55, 211, 153, 0.12)' : 'rgba(240, 97, 107, 0.12)',
      },
    ],
    [curve, summary.net],
  );

  if (sessions.length === 0) {
    return (
      <Screen>
        <View style={styles.brandHeader}>
          <Text variant="title">Log</Text>
          <Text color={colors.textSecondary}>The session log that keeps you off tilt.</Text>
        </View>
        <EmptyState
          title="No sessions yet"
          body="Log your first session and Log starts building your bankroll graph, your true hourly rate, and the variance picture that tells you whether a bad week is actually a bad week."
          action={
            <Button label="Start a session" onPress={() => router.push('/session/new')} />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        activeSession ? (
          <ResumeButton startedAt={activeSession.startedAt} />
        ) : (
          <Button
            label="Start a session"
            onPress={() => router.push('/session/new')}
            leading={<Ionicons name="play" size={16} color={colors.accentText} />}
          />
        )
      }
    >
      <View style={styles.brandHeader}>
        <Text variant="overline" color={colors.textTertiary}>
          Bankroll
        </Text>
        <Text variant="display" color={resultColor(summary.net)}>
          {formatMoney(summary.net, { signed: true })}
        </Text>
        <Text color={colors.textSecondary}>
          {summary.sessionCount} session{summary.sessionCount === 1 ? '' : 's'} ·{' '}
          {Math.round(summary.hours)} hours played
        </Text>
      </View>

      <Card style={styles.chartCard}>
        <LineChart series={chartSeries} height={170} />
        <View style={styles.chartAxis}>
          <Text variant="caption" color={colors.textTertiary}>
            {curve.length > 0 ? formatMoneyCompact(0) : ''}
          </Text>
          <Text variant="caption" color={colors.textTertiary}>
            {curve.length > 0
              ? formatMoneyCompact(curve[curve.length - 1].cumulative)
              : ''}
          </Text>
        </View>
      </Card>

      <View style={styles.tiles}>
        <StatTile
          label="Hourly"
          value={summary.hourly === null ? '—' : formatMoney(summary.hourly, { signed: true })}
          valueColor={resultColor(summary.hourly)}
          hint="all sessions"
        />
        <StatTile
          label="Win rate"
          value={`${Math.round((summary.winningSessions / Math.max(1, summary.sessionCount)) * 100)}%`}
          hint={`${summary.winningSessions}W / ${summary.losingSessions}L`}
        />
      </View>
      <View style={styles.tiles}>
        <StatTile
          label="Best session"
          value={summary.biggestWin === null ? '—' : formatMoney(summary.biggestWin, { signed: true })}
          valueColor={resultColor(summary.biggestWin)}
        />
        <StatTile
          label="Worst session"
          value={summary.biggestLoss === null ? '—' : formatMoney(summary.biggestLoss, { signed: true })}
          valueColor={resultColor(summary.biggestLoss)}
        />
      </View>

      <SectionHeader
        title="Where the money comes from"
        action={
          <ChipGroup
            options={BREAKDOWN_OPTIONS}
            value={breakdown}
            onChange={setBreakdown}
          />
        }
      />
      <Card>
        <BarBreakdown groups={groups} />
      </Card>

      <SectionHeader title="Recent sessions" />
      <Card style={styles.listCard}>
        {recent.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            onPress={() => router.push(`/session/${session.id}`)}
          />
        ))}
      </Card>
    </Screen>
  );
}

/** Live elapsed time on the resume button, so the tab bar is not the only cue. */
const ResumeButton = ({ startedAt }: { startedAt: number }) => {
  const elapsed = useElapsed(startedAt);
  return (
    <Button
      label={`Resume session · ${formatDuration(elapsed)}`}
      onPress={() => router.push('/session/active')}
      leading={<Ionicons name="radio-button-on" size={16} color={colors.accentText} />}
    />
  );
};

const styles = StyleSheet.create({
  brandHeader: {
    paddingTop: spacing.xl,
    gap: spacing.xs,
  },
  chartCard: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  chartAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  listCard: {
    paddingVertical: 0,
  },
});
