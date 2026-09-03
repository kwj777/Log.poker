/**
 * The variance view -- the anti-tilt feature.
 *
 * The premise: a losing stretch feels like evidence that something is wrong with
 * your game, and almost always isn't. This screen answers that with the player's
 * own numbers -- their win rate, their swings -- and shows where their recent run
 * actually sits inside the range those numbers predict.
 *
 * Two rules govern everything here. It never flatters: a genuine outlier is
 * named as one, and a heater is called a heater so nobody banks on it. And it
 * never claims to know whether someone is playing well -- variance math cannot
 * see that, and pretending otherwise would make the reassurance worthless.
 */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { EmptyState } from '../../src/components/EmptyState';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { LineChart } from '../../src/components/chart/LineChart';
import {
  assessRecentStretch,
  confidenceBand,
  estimatePlayer,
  probabilityOfLoss,
  toObservations,
} from '../../src/domain/variance';
import { FamilyCrossPromo } from '../../src/features/family/FamilyCrossPromo';
import { openHandOff, untiltHandOff } from '../../src/features/family/hooks';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, resultColor, spacing } from '../../src/theme';
import type { StretchVerdict } from '../../src/domain/variance';
import { PageMeta } from '../../src/components/PageMeta';

const RECENT_SESSIONS = 10;

/**
 * Only the true outliers get a color. A stretch inside the normal band is
 * shown in plain text on purpose -- painting an ordinary bad week red is exactly
 * the reflex this screen exists to interrupt.
 */
const VERDICT_COLORS: Record<StretchVerdict, string> = {
  insufficient_data: colors.text,
  running_bad: colors.loss,
  below_expectation: colors.text,
  normal: colors.text,
  above_expectation: colors.text,
  running_hot: colors.profit,
};

export default function VarianceScreen() {
  const sessions = useLogStore((state) => state.sessions);

  const observations = useMemo(() => toObservations(sessions), [sessions]);
  const estimate = useMemo(() => estimatePlayer(observations), [observations]);
  const assessment = useMemo(
    () => assessRecentStretch(observations, estimate, RECENT_SESSIONS),
    [observations, estimate],
  );
  const band = useMemo(
    () => confidenceBand(estimate, observations, 95),
    [estimate, observations],
  );

  const chart = useMemo(
    () => ({
      series: [
        {
          points: band
            .filter((point) => point.actual !== null)
            .map((point) => ({ x: point.hours, y: point.actual as number })),
          color: colors.text,
          width: 2.5,
        },
        {
          points: band.map((point) => ({ x: point.hours, y: point.expected })),
          color: colors.accent,
          width: 1.5,
          dashed: true,
        },
      ],
      band: {
        upper: band.map((point) => ({ x: point.hours, y: point.upper })),
        lower: band.map((point) => ({ x: point.hours, y: point.lower })),
        color: 'rgba(31, 169, 122, 0.14)',
      },
    }),
    [band],
  );

  const lossChance = probabilityOfLoss(estimate, assessment.hours);

  if (!estimate.reliable) {
    return (
      <Screen>
        <PageMeta title="Variance · Log" />
        <View style={styles.header}>
          <Text variant="title">Variance</Text>
        </View>
        <EmptyState title={assessment.headline} body={assessment.body} />
        <Card style={styles.explainer}>
          <Text variant="bodyStrong">Why this needs a sample</Text>
          <Text color={colors.textSecondary} style={styles.explainerBody}>
            Every player has a different win rate and a different amount of swing.
            Comparing your week to someone else’s numbers (or to a textbook average)
            would tell you nothing about your game. So this page waits until it can use
            yours.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageMeta title="Variance · Log" />
      <View style={styles.header}>
        <Text variant="title">Variance</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          Your last {assessment.sessionCount} sessions, against what your own numbers predict.
        </Text>
      </View>

      <Card style={styles.verdict}>
        <Text variant="heading" color={VERDICT_COLORS[assessment.verdict]}>
          {assessment.headline}
        </Text>
        <Text color={colors.textSecondary} style={styles.verdictBody}>
          {assessment.body}
        </Text>
      </Card>

      <SectionHeader title="Your results inside your normal range" />
      <Card style={styles.chartCard}>
        <LineChart
          series={chart.series}
          band={chart.band}
          height={200}
          emptyMessage="Log a few more sessions to draw the band"
        />
        <View style={styles.legend}>
          <LegendItem color={colors.text} label="Your results" />
          <LegendItem color={colors.accent} label="Expected" dashed />
          <LegendItem color="rgba(31, 169, 122, 0.5)" label="95% range" block />
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.chartNote}>
          Cumulative big blinds won over hours played. The shaded area is where 95 out of
          100 runs like yours would land. Inside it is unremarkable, and that is the whole point.
        </Text>
      </Card>

      <SectionHeader title="Your numbers" />
      <View style={styles.tiles}>
        <StatTile
          label="Win rate"
          value={`${estimate.winRateBbPerHour >= 0 ? '+' : ''}${estimate.winRateBbPerHour.toFixed(1)} bb/hr`}
          valueColor={resultColor(Math.round(estimate.winRateBbPerHour * 100))}
          hint={`over ${Math.round(estimate.totalHours)} hours`}
        />
        <StatTile
          label="Swing"
          value={`${estimate.stdDevBbPerHour.toFixed(0)} bb/hr`}
          hint="std. deviation"
        />
      </View>

      {lossChance !== null ? (
        <Card style={styles.reassurance}>
          <Text variant="bodyStrong">The part nobody tells you</Text>
          <Text color={colors.textSecondary} style={styles.reassuranceBody}>
            At your win rate and your swings, a stretch of{' '}
            {Math.round(assessment.hours)} hours finishes in the red about{' '}
            <Text variant="bodyStrong" color={colors.text}>
              {Math.round(lossChance * 100)}% of the time
            </Text>
            . Not because of anything you did: that is simply what this much variance
            looks like over this few hours. Losing stretches are part of a winning
            player’s results, not a departure from them.
          </Text>
        </Card>
      ) : null}

      {assessment.suggestsUntilt ? (
        <>
          <SectionHeader title="If it’s getting to you" />
          <Card>
            <Text color={colors.textSecondary} style={styles.untiltBody}>
              Knowing a downswing is normal and feeling like it is are two different
              problems. Untilt.poker is the one we built for the second.
            </Text>
            <Button
              label={untiltHandOff(assessment.verdict).label}
              variant="secondary"
              size="medium"
              onPress={() => openHandOff(untiltHandOff(assessment.verdict).url)}
            />
          </Card>
        </>
      ) : null}

      <FamilyCrossPromo exclude={['log']} style={styles.family} />
    </Screen>
  );
}

const LegendItem = ({
  color,
  label,
  dashed = false,
  block = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  block?: boolean;
}) => (
  <View style={styles.legendItem}>
    <View
      style={[
        block ? styles.legendBlock : styles.legendLine,
        { backgroundColor: color },
        dashed ? styles.legendDashed : null,
      ]}
    />
    <Text variant="caption" color={colors.textTertiary}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
  },
  subtitle: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  verdict: {
    marginTop: spacing.xl,
    borderColor: colors.accentDim,
  },
  verdictBody: {
    marginTop: spacing.sm,
    lineHeight: 23,
  },
  chartCard: {
    paddingHorizontal: spacing.md,
  },
  chartNote: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendDashed: {
    opacity: 0.7,
  },
  legendBlock: {
    width: 16,
    height: 10,
    borderRadius: 2,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reassurance: {
    marginTop: spacing.lg,
  },
  reassuranceBody: {
    marginTop: spacing.sm,
    lineHeight: 23,
  },
  untiltBody: {
    lineHeight: 23,
    marginBottom: spacing.lg,
  },
  family: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },
  explainer: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  explainerBody: {
    marginTop: spacing.sm,
    lineHeight: 23,
  },
});
