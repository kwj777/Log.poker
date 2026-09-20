/**
 * Dashboard -- the app's home.
 *
 * Ordered by what a player wants first: is there a session running, what is my
 * bankroll doing, what are the headline numbers, where is the money actually
 * coming from. The primary action is always "start a session" (or "resume"),
 * because logging is the behavior the app needs to make effortless.
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
import { StatTile, type StatTileProps } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { BarBreakdown } from '../../src/components/chart/BarBreakdown';
import { LineChart } from '../../src/components/chart/LineChart';
import { GUIDES } from '../../src/config';
import { formatMoney, formatMoneyCompact } from '../../src/domain/money';
import {
  bankrollCurve,
  byBuyIn,
  byFormat,
  byGameType,
  byStakes,
  byVenue,
  cashWinRate,
  formatDuration,
  totals,
} from '../../src/domain/stats';
import {
  bootstrapRoi,
  formatRoi,
  toEntryResults,
  tournamentTotals,
} from '../../src/domain/tournaments';
import { openHandOff } from '../../src/features/family/hooks';
import { ReviewFlagged } from '../../src/features/family/ReviewFlagged';
import { reviewPrompt } from '../../src/features/family/reviewPrompt';
import { SessionRow } from '../../src/features/sessions/SessionRow';
import { useElapsed } from '../../src/features/sessions/LiveTimer';
import { useHandsForSession, useLogStore } from '../../src/store/useLogStore';
import { colors, resultColor, spacing } from '../../src/theme';
import { APP_DESCRIPTION, PageMeta } from '../../src/components/PageMeta';

type Breakdown = 'stakes' | 'buyIn' | 'format' | 'venue' | 'game';

export default function DashboardScreen() {
  const sessions = useLogStore((state) => state.sessions);
  const venues = useLogStore((state) => state.venues);
  const activeSession = useLogStore((state) => state.activeSession);
  const [breakdown, setBreakdown] = useState<Breakdown>('stakes');

  const summary = useMemo(() => totals(sessions), [sessions]);
  const winRate = useMemo(() => cashWinRate(sessions), [sessions]);
  const tourneys = useMemo(() => tournamentTotals(sessions), [sessions]);
  const roiInterval = useMemo(() => bootstrapRoi(toEntryResults(sessions)), [sessions]);
  const curve = useMemo(() => bankrollCurve(sessions), [sessions]);

  /**
   * A player who has never entered a tournament is not offered a buy-in
   * breakdown that would draw nothing, and one who only plays tournaments is not
   * offered a stakes breakdown for the same reason.
   */
  const hasTournaments = useMemo(
    () => sessions.some((session) => session.format === 'tournament'),
    [sessions],
  );
  const hasCash = useMemo(
    () => sessions.some((session) => session.format === 'cash'),
    [sessions],
  );
  const breakdownOptions = useMemo(
    () => [
      ...(hasCash ? [{ value: 'stakes' as const, label: 'Stakes' }] : []),
      ...(hasTournaments ? [{ value: 'buyIn' as const, label: 'Buy-in' }] : []),
      ...(hasCash && hasTournaments ? [{ value: 'format' as const, label: 'Format' }] : []),
      { value: 'venue' as const, label: 'Venue' },
      { value: 'game' as const, label: 'Game' },
    ],
    [hasCash, hasTournaments],
  );

  // The default is the first option that exists, so a tournament-only player
  // does not open the app on an empty chart.
  const active: Breakdown = breakdownOptions.some((option) => option.value === breakdown)
    ? breakdown
    : (breakdownOptions[0]?.value ?? 'venue');

  const groups = useMemo(() => {
    if (active === 'venue') return byVenue(sessions, venues);
    if (active === 'game') return byGameType(sessions);
    if (active === 'buyIn') return byBuyIn(sessions);
    if (active === 'format') return byFormat(sessions);
    return byStakes(sessions);
  }, [active, sessions, venues]);

  /**
   * The headline figures, built as a list and then laid out two to a row.
   *
   * A fixed grid was fine while every player had the same four, but "win rate"
   * and "cashed" are the same question asked of two different games and only
   * one of them applies to any given session. Which tiles exist now depends on
   * what the player actually plays, so the rows are derived rather than written
   * out: cash only gets the four it always had, tournaments add two of their
   * own, and a player who has only ever entered tournaments is never shown a
   * win rate computed over no cash games at all.
   */
  const tileRows = useMemo(() => {
    const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
    const tiles: StatTileProps[] = [
      {
        label: 'Hourly',
        value: summary.hourly === null ? '--' : formatMoney(summary.hourly, { signed: true }),
        valueColor: resultColor(summary.hourly),
        hint: 'all sessions',
      },
    ];

    if (winRate.rate !== null) {
      tiles.push({
        label: 'Win rate',
        value: percent(winRate.rate),
        hint: `${winRate.winning}W / ${winRate.losing}L`,
      });
    }

    if (tourneys.entries > 0) {
      tiles.push({
        label: 'Cashed',
        value: tourneys.itmRate === null ? '--' : percent(tourneys.itmRate),
        hint: `${tourneys.cashes} of ${tourneys.entries} tournaments`,
      });
      tiles.push({
        label: 'ROI',
        value: tourneys.roi === null ? '--' : formatRoi(tourneys.roi),
        valueColor: resultColor(tourneys.net),
        // The range rather than the entry count: a bare ROI reads like a
        // measurement, and the hint is the only place to say how wide the
        // honest version of it is. The variance page has the long form.
        hint:
          roiInterval === null
            ? 'too few entries for a range'
            : `${formatRoi(roiInterval.lower)} to ${formatRoi(roiInterval.upper)}`,
      });
    }

    tiles.push(
      {
        label: 'Best session',
        value: summary.biggestWin === null ? '--' : formatMoney(summary.biggestWin, { signed: true }),
        valueColor: resultColor(summary.biggestWin),
      },
      {
        label: 'Worst session',
        value:
          summary.biggestLoss === null ? '--' : formatMoney(summary.biggestLoss, { signed: true }),
        valueColor: resultColor(summary.biggestLoss),
      },
    );

    return Array.from({ length: Math.ceil(tiles.length / 2) }, (_, index) =>
      tiles.slice(index * 2, index * 2 + 2),
    );
  }, [summary, winRate, tourneys, roiInterval]);

  const recent = useMemo(
    () => sessions.filter((session) => session.endedAt !== null).slice(0, 5),
    [sessions],
  );

  /**
   * The last session actually finished, which is not always the last started.
   *
   * `sessions` is ordered by start, and a night begun at 9pm and left running
   * until the next afternoon finishes after one begun at noon the day after.
   * Rare, and cheap to be right about.
   *
   * Null while a session is live, which is what keeps the review card off the
   * screen at a table: `HandRow` hides its drill link mid-session for the same
   * reason, and the rule belongs in one place rather than in the card.
   */
  const lastFinished = useMemo(() => {
    if (activeSession !== null) return null;
    return sessions.reduce<(typeof sessions)[number] | null>(
      (latest, session) =>
        session.endedAt !== null && (latest === null || session.endedAt > (latest.endedAt ?? 0))
          ? session
          : latest,
      null,
    );
  }, [sessions, activeSession]);

  /**
   * Read once on mount rather than during render, the way History reads its
   * period window: a clock that moves every frame would re-derive the prompt
   * constantly, and the one boundary it could cross is a week away.
   */
  const [openedAt] = useState(() => Date.now());
  const lastFinishedHands = useHandsForSession(lastFinished?.id ?? null);
  const prompt = useMemo(
    () => reviewPrompt({ session: lastFinished, hands: lastFinishedHands, now: openedAt }),
    [lastFinished, lastFinishedHands, openedAt],
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
        <PageMeta title="Log: the session log that keeps you off tilt" description={APP_DESCRIPTION} />
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
      <PageMeta title="Log: the session log that keeps you off tilt" description={APP_DESCRIPTION} />
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

      {/*
        Above the graph because it is the one thing on this screen with
        something to do in it, and below the bankroll because that is what the
        player opened the app for. Renders nothing at all in the ordinary case;
        see `reviewPrompt` for what has to be true for it to appear.
      */}
      <ReviewFlagged prompt={prompt} />

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

      {tileRows.map((row) => (
        <View key={row.map((tile) => tile.label).join('-')} style={styles.tiles}>
          {row.map((tile) => (
            <StatTile key={tile.label} {...tile} />
          ))}
        </View>
      ))}

      {/*
        The tiles above are the swings, stated. This is the question they
        raise and this app deliberately does not answer: how much has to sit
        behind them. That answer is arithmetic rather than a rule of thumb,
        and it lives on the site rather than here because it needs a page.
      */}
      <Card style={styles.guideCard}>
        <Text color={colors.textSecondary} style={styles.guideBody}>
          A worst session is only alarming next to a bankroll. How big that has
          to be is arithmetic, and it turns on your win rate far more than on
          the number of buy-ins anybody quotes.
        </Text>
        <Button
          label="How big a bankroll?"
          variant="secondary"
          size="small"
          href={GUIDES.bankroll}
          onPress={() => openHandOff(GUIDES.bankroll)}
          style={styles.guideLink}
        />
      </Card>

      <SectionHeader
        title="Where the money comes from"
        action={
          <ChipGroup options={breakdownOptions} value={active} onChange={setBreakdown} />
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
  guideCard: {
    marginTop: spacing.lg,
  },
  guideBody: {
    lineHeight: 23,
  },
  guideLink: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
});
