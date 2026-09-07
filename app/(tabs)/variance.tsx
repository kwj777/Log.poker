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
import { GUIDES } from '../../src/config';
import {
  assessRecentStretch,
  confidenceBand,
  estimatePlayer,
  probabilityOfLoss,
  toObservations,
} from '../../src/domain/variance';
import { formatMoney } from '../../src/domain/money';
import {
  assessRoi,
  assessTournaments,
  bootstrapRoi,
  formatRoi,
  roiConcentration,
  toEntryResults,
  tournamentTotals,
  type RoiAssessment,
  type RoiInterval,
  type TournamentAssessment,
  type TournamentTotals,
} from '../../src/domain/tournaments';
import { FamilyCrossPromo } from '../../src/features/family/FamilyCrossPromo';
import { MoodCost } from '../../src/features/sessions/MoodCost';
import { startMoodComparison } from '../../src/domain/mood';
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
/**
 * The same restraint as the cash verdicts: only a range that has actually
 * cleared break even gets a color. An undetermined one is the ordinary case
 * after any realistic number of entries, and painting it would suggest the
 * player had failed a test rather than not yet taken one.
 */
const ROI_COLORS: Record<RoiAssessment['verdict'], string> = {
  insufficient_data: colors.text,
  undetermined: colors.text,
  winning: colors.profit,
  losing: colors.loss,
};

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
  const moodEntries = useLogStore((state) => state.moodEntries);

  const observations = useMemo(() => toObservations(sessions), [sessions]);
  const moodComparison = useMemo(
    () => startMoodComparison(sessions, moodEntries),
    [sessions, moodEntries],
  );
  const tournaments = useMemo(() => tournamentTotals(sessions), [sessions]);
  const tournamentAssessment = useMemo(() => assessTournaments(tournaments), [tournaments]);

  /**
   * The bootstrap resamples every entry a couple of thousand times, so it is
   * memoized on the sessions rather than run per render. It is deterministic,
   * so the interval a player reads is the same one they read a minute ago.
   */
  const roiInterval = useMemo(() => {
    const results = toEntryResults(sessions);
    return {
      interval: bootstrapRoi(results),
      concentration: roiConcentration(results),
      entries: results.length,
    };
  }, [sessions]);
  const roiAssessment = useMemo(
    () => assessRoi(roiInterval.interval, roiInterval.concentration, roiInterval.entries),
    [roiInterval],
  );
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

  /**
   * The long version of what this screen is doing, on the marketing site.
   *
   * It appears in both branches below: with no sample yet, because that is
   * when somebody most wants to know what the page will eventually tell them,
   * and with one, because the loss chance printed above it is a number people
   * want to see the working for.
   */
  const guide = (
    <Button
      label="Running bad, or playing bad?"
      variant="secondary"
      size="small"
      href={GUIDES.runningBad}
      onPress={() => openHandOff(GUIDES.runningBad)}
      style={styles.guide}
    />
  );

  if (!estimate.reliable) {
    return (
      <Screen>
        <PageMeta title="Variance · Log" />
        <View style={styles.header}>
          <Text variant="title">Variance</Text>
        </View>
        <EmptyState title={assessment.headline} body={assessment.body} />
        {tournaments.entries > 0 ? (
          <TournamentCard
            totals={tournaments}
            assessment={tournamentAssessment}
            interval={roiInterval.interval}
            roi={roiAssessment}
          />
        ) : null}
        <Card style={styles.explainer}>
          <Text variant="bodyStrong">Why this needs a sample</Text>
          <Text color={colors.textSecondary} style={styles.explainerBody}>
            Every player has a different win rate and a different amount of swing.
            Comparing your week to someone else’s numbers (or to a textbook average)
            would tell you nothing about your game. So this page waits until it can use
            yours.
          </Text>
          {guide}
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
          Your last {assessment.sessionCount} cash sessions, against what your own numbers
          predict.
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

      {tournaments.entries > 0 ? (
        <TournamentCard
            totals={tournaments}
            assessment={tournamentAssessment}
            interval={roiInterval.interval}
            roi={roiAssessment}
          />
      ) : null}

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
          {guide}
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

      <MoodCost comparison={moodComparison} />

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

/**
 * Tournaments on the variance page, and deliberately not a confidence band.
 *
 * The band above is a Gaussian random walk in big blinds per hour. Tournament
 * results are neither of those things -- no big blind, and a distribution that
 * is mostly zero with a long tail -- so drawing one here would be a picture that
 * looks like the cash one and means nothing. What is left is what can be said
 * honestly: the rate, the run, and how ordinary the run is at that rate.
 */
const TournamentCard = ({
  totals,
  assessment,
  interval,
  roi,
}: {
  totals: TournamentTotals;
  assessment: TournamentAssessment;
  interval: RoiInterval | null;
  roi: RoiAssessment;
}) => (
  <>
    <SectionHeader title="Tournaments" />
    <Card>
      <Text variant="heading">{assessment.headline}</Text>
      <Text color={colors.textSecondary} style={styles.verdictBody}>
        {assessment.body}
      </Text>
      <View style={styles.tournamentTiles}>
        <StatTile
          label="ROI"
          value={totals.roi === null ? '--' : `${totals.roi >= 0 ? '+' : ''}${Math.round(totals.roi * 100)}%`}
          valueColor={resultColor(totals.net)}
          hint={
            interval === null
              ? 'too few entries to mean much'
              : `${formatRoi(interval.lower)} to ${formatRoi(interval.upper)}`
          }
        />
        <StatTile
          label="Cashed"
          value={totals.itmRate === null ? '--' : `${Math.round(totals.itmRate * 100)}%`}
          hint={`${totals.cashes} of ${totals.entries}`}
        />
      </View>
      <View style={styles.tournamentTiles}>
        <StatTile
          label="Best finish"
          value={totals.bestFinish === null ? '--' : `${totals.bestFinish}`}
          hint={
            totals.averageFinishPercentile === null
              ? 'no finishes recorded'
              : `top ${Math.max(1, Math.round(totals.averageFinishPercentile * 100))}% on average`
          }
        />
        <StatTile
          label="Fees paid"
          value={formatMoney(totals.fees)}
          hint="never coming back"
        />
      </View>
    </Card>

    <SectionHeader title="What that ROI is worth" />
    <Card>
      <Text variant="heading" color={ROI_COLORS[roi.verdict]}>
        {roi.headline}
      </Text>
      <Text color={colors.textSecondary} style={styles.verdictBody}>
        {roi.body}
      </Text>
      {roi.concentrationNote === null ? null : (
        <Text variant="caption" color={colors.textTertiary} style={styles.concentration}>
          {roi.concentrationNote}
        </Text>
      )}
    </Card>
  </>
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
  concentration: {
    marginTop: spacing.lg,
    lineHeight: 18,
  },
  tournamentTiles: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  guide: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
});
