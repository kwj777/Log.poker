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

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ChipGroup } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { HandBreakdown } from '../../src/components/chart/HandBreakdown';
import { LineChart } from '../../src/components/chart/LineChart';
import { GUIDES } from '../../src/config';
import {
  assessRecentStretch,
  confidenceBand,
  estimatePlayer,
  probabilityOfLoss,
  toObservations,
} from '../../src/domain/variance';
import { currencyLabel, formatMoney } from '../../src/domain/money';
import { byPosition, byTag, handTotals } from '../../src/domain/hands';
import { currenciesUsed, inCurrency } from '../../src/domain/stats';
import {
  assessRoi,
  assessTournaments,
  formatRoi,
  roiConcentration,
  tournamentTotals,
  type RoiAssessment,
  type RoiInterval,
  type TournamentAssessment,
  type TournamentTotals,
} from '../../src/domain/tournaments';
import { FamilyCrossPromo } from '../../src/features/family/FamilyCrossPromo';
import { MoodCost } from '../../src/features/sessions/MoodCost';
import { useEntryResults, useRoiInterval } from '../../src/features/sessions/useRoiInterval';
import { Explain } from '../../src/components/Explain';
import { STAT_HELP } from '../../src/domain/glossary';
import { startMoodComparison } from '../../src/domain/mood';
import { openHandOff } from '../../src/features/family/hooks';
import { untiltHandOff } from '../../src/features/family/links';
import { useAllHands, useLogStore } from '../../src/store/useLogStore';
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
  const all = useLogStore((state) => state.sessions);
  const moodEntries = useLogStore((state) => state.moodEntries);
  const allHands = useAllHands();
  const [picked, setPicked] = useState<string | null>(null);

  /**
   * One currency at a time, exactly as the dashboard and Sessions do it.
   *
   * This screen was the one that did not, which was worse than the uniform
   * dollars it replaced: the other two tabs started telling the truth about a
   * player with two currencies and this one went on adding them, so the app
   * contradicted itself on the screen whose whole job is to be believed.
   *
   * It matters differently in the two halves below. The cash estimate is in
   * big blinds, so the units at least divide out -- but a euro big blind and
   * a dollar big blind are not the same money, and a standard deviation over
   * the mixture is a number about nothing. The tournament totals are raw
   * cents, so mixing them produced a sum that was simply wrong and an ROI
   * that was a ratio of two wrong sums.
   */
  const currencies = useMemo(() => currenciesUsed(all), [all]);
  const currency = picked !== null && currencies.includes(picked) ? picked : currencies[0] ?? 'USD';
  const sessions = useMemo(
    () => (currencies.length > 1 ? inCurrency(all, currency) : all),
    [all, currencies.length, currency],
  );

  /**
   * The hands, scoped to the sessions on screen so the pot swings are in the
   * currency the rest of the page is in.
   *
   * `useAllHands` reads them while this screen is open rather than holding
   * them in the store -- see the hook, and `handCount` above it, for why the
   * store deliberately does not.
   */
  const hands = useMemo(() => {
    if (allHands === null) return [];
    const ids = new Set(sessions.map((session) => session.id));
    return allHands.filter((hand) => ids.has(hand.sessionId));
  }, [allHands, sessions]);
  const handSummary = useMemo(() => handTotals(hands), [hands]);
  const tagGroups = useMemo(() => byTag(hands), [hands]);
  const positionGroups = useMemo(() => byPosition(hands), [hands]);

  const observations = useMemo(() => toObservations(sessions), [sessions]);
  const moodComparison = useMemo(
    () => startMoodComparison(sessions, moodEntries),
    [sessions, moodEntries],
  );
  const tournaments = useMemo(() => tournamentTotals(sessions), [sessions]);
  const tournamentAssessment = useMemo(() => assessTournaments(tournaments), [tournaments]);

  /**
   * The bootstrap resamples every entry a couple of thousand times, so it runs
   * when a tournament result changes rather than when `sessions` does -- the
   * store replaces that array on every write and every sync. See
   * `useRoiInterval`. It is deterministic either way, so the interval a player
   * reads is the same one they read a minute ago.
   */
  const entries = useEntryResults(sessions);
  const roiInterval = useRoiInterval(entries);
  const concentration = useMemo(() => roiConcentration(entries), [entries]);
  const roiAssessment = useMemo(
    () => assessRoi(roiInterval, concentration, entries.length),
    [roiInterval, concentration, entries.length],
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
   * What the band chart says, for somebody who cannot see it.
   *
   * The prose under the chart already explains what the shaded area is, and it
   * is the same prose every time. The part that changes -- where this player's
   * own line finished, and whether that is inside the range -- was only ever
   * in the drawing. `assessment.verdict` is the same call the headline
   * above the chart reaches, so the two cannot disagree.
   */
  const chartLabel = useMemo(() => {
    const last = band.length > 0 ? band[band.length - 1] : null;
    if (last === null || last.actual === null) {
      return 'Cumulative big blinds against your expected range.';
    }
    const inside = last.actual >= last.lower && last.actual <= last.upper;
    return (
      `Cumulative big blinds over ${Math.round(last.hours)} hours. ` +
      `You are at ${Math.round(last.actual)} big blinds against an expected ` +
      `${Math.round(last.expected)}, which is ${inside ? 'inside' : 'outside'} ` +
      'the 95% range.'
    );
  }, [band]);

  /**
   * The long version of what this screen is doing, on the marketing site.
   *
   * It appears in both branches below: with no sample yet, because that is
   * when somebody most wants to know what the page will eventually tell them,
   * and with one, because the loss chance printed above it is a number people
   * want to see the working for.
   */
  /**
   * Offered only when there is a choice, and in both branches below, because
   * the empty one is reachable per currency: a player with a season in
   * dollars and three sessions in euros gets the real screen for one and
   * "not enough yet" for the other, and needs the way back.
   */
  const currencyChips =
    currencies.length > 1 ? (
      <View style={styles.currencyRow}>
        <ChipGroup
          options={currencies.map((code) => ({ value: code, label: currencyLabel(code) }))}
          value={currency}
          onChange={setPicked}
          scroll
        />
      </View>
    ) : null;

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

  // On the assessment rather than on `estimate.reliable`, because there are now
  // two ways to have nothing honest to say and the estimate only knows about
  // one of them. The other is a player whose recent stretch is their whole
  // history: enough sessions to estimate from, nothing to measure against. See
  // `assessRecentStretch`.
  if (assessment.verdict === 'insufficient_data') {
    return (
      <Screen>
        <PageMeta title="Variance · Log" />
        {currencyChips}
        <View style={styles.header}>
          <Text variant="title">Variance</Text>
        </View>
        <EmptyState title={assessment.headline} body={assessment.body} />
        {tournaments.entries > 0 ? (
          <TournamentCard
            totals={tournaments}
            assessment={tournamentAssessment}
            interval={roiInterval}
            roi={roiAssessment}
            currency={currency}
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
      {currencyChips}
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
            interval={roiInterval}
            roi={roiAssessment}
            currency={currency}
          />
      ) : null}

      <SectionHeader title="Your results inside your normal range" />
      <Card style={styles.chartCard}>
        <LineChart
          series={chart.series}
          band={chart.band}
          height={200}
          // The prose under the chart explains what the band is; this says
          // where the player's own line ended up inside it, which is the one
          // thing only the drawing was saying.
          label={chartLabel}
          emptyMessage="Log a few more sessions to draw the band"
        />
        <View style={styles.legend}>
          <LegendItem color={colors.text} label="Your results" />
          <LegendItem color={colors.accent} label="Expected" dashed />
          <LegendItem color="rgba(31, 169, 122, 0.5)" label="95% range" block />
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.chartNote}>
          Cumulative big blinds won over hours played, against your own average. The shaded
          area is how far from that average a run like yours could reasonably have strayed.
          It closes toward the right because the average is made of these very hours: by the
          last one there is no room left to stray. Inside it is unremarkable, and that is the
          whole point.
        </Text>
      </Card>

      <SectionHeader
        title="Your numbers"
        action={<Explain title="What these numbers are" entries={STAT_HELP} />}
      />
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
              label={untiltHandOff().label}
              variant="secondary"
              size="medium"
              onPress={() => openHandOff(untiltHandOff().url)}
            />
          </Card>
        </>
      ) : null}

      {/*
        Only to somebody who has logged some. A player who has never written a
        hand down gets a section explaining an empty chart, which is worse than
        no section: this page is long already and every card on it is supposed
        to be about them.
      */}
      {handSummary.count > 0 ? (
        <>
          <SectionHeader title="The hands you wrote down" />
          <Card>
            {/*
              First, and not in small print at the bottom. Everything under
              this sentence looks like a positional win rate and is not one,
              and somebody who reads the bars before the caveat has already
              drawn the wrong conclusion.
            */}
            <Text color={colors.textSecondary} style={styles.handsCaveat}>
              These are the hands you chose to write down, not the hands you played. A bad beat
              is memorable and a folded blind is not, so read this as a record of what stuck
              rather than as a measure of your game. {handSummary.count} hand
              {handSummary.count === 1 ? '' : 's'} so far.
            </Text>

            {tagGroups.length > 0 ? (
              <>
                <Text variant="bodyStrong" style={styles.handsHeading}>
                  By tag
                </Text>
                <HandBreakdown
                  groups={tagGroups}
                  currency={currency}
                  emptyMessage="None of them carry a tag."
                />
              </>
            ) : null}

            {positionGroups.length > 0 ? (
              <>
                <Text variant="bodyStrong" style={styles.handsHeading}>
                  By seat
                </Text>
                <HandBreakdown
                  groups={positionGroups}
                  currency={currency}
                  emptyMessage="None of them recorded a seat."
                />
              </>
            ) : null}

            <Button
              label="Open your hands"
              variant="secondary"
              size="small"
              onPress={() => router.push('/hands')}
              style={styles.handsAction}
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
  currency,
}: {
  totals: TournamentTotals;
  assessment: TournamentAssessment;
  interval: RoiInterval | null;
  roi: RoiAssessment;
  /** The money these entries were played for, since the totals are raw cents. */
  currency: string;
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
          // Through `formatRoi`, like the dashboard tile and like the interval
          // bounds two lines down. Hand-rolled, a small loss lost its sign
          // twice over: the guard picked no '+', and `Math.round` turned -0.4%
          // into -0, which stringifies as "0". The tile read a bare "0%",
          // colored loss red, over a hint reading "-9% to +2%".
          value={totals.roi === null ? '--' : formatRoi(totals.roi)}
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
          value={formatMoney(totals.fees, { currency })}
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
  handsCaveat: {
    lineHeight: 22,
  },
  handsHeading: {
    // On both, so the two breakdowns are separated from each other and the
    // first is separated from the caveat above it, without a style per slot.
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  handsAction: {
    alignSelf: 'flex-start',
    marginTop: spacing.lg,
  },
  currencyRow: {
    paddingTop: spacing.xl,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
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
