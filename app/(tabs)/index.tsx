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
import { currencyLabel, formatMoney, formatMoneyCompact } from '../../src/domain/money';
import {
  bankrollCurve,
  byBuyIn,
  byFormat,
  byGameType,
  byStakes,
  byVenue,
  cashWinRate,
  currenciesUsed,
  formatDuration,
  inCurrency,
  totals,
} from '../../src/domain/stats';
import { formatRoi, tournamentTotals } from '../../src/domain/tournaments';
import { openLink } from '../../src/features/family/hooks';
import { ReviewFlagged } from '../../src/features/family/ReviewFlagged';
import { reviewPrompt } from '../../src/features/family/reviewPrompt';
import { SessionRow } from '../../src/features/sessions/SessionRow';
import { useEntryResults, useRoiInterval } from '../../src/features/sessions/useRoiInterval';
import { useElapsed } from '../../src/features/sessions/LiveTimer';
import { useHandsForSession, useLogStore } from '../../src/store/useLogStore';
import { colors, resultColor, spacing } from '../../src/theme';
import { APP_DESCRIPTION, PageMeta } from '../../src/components/PageMeta';

type Breakdown = 'stakes' | 'buyIn' | 'format' | 'venue' | 'game';

export default function DashboardScreen() {
  const all = useLogStore((state) => state.sessions);
  const venues = useLogStore((state) => state.venues);
  const activeSession = useLogStore((state) => state.activeSession);
  const startingBalance = useLogStore((state) => state.startingBalance);
  const [breakdown, setBreakdown] = useState<Breakdown>('stakes');
  const [picked, setPicked] = useState<string | null>(null);

  /**
   * Everything on this screen is in one currency, and says which.
   *
   * A bankroll is a sum, and a sum of euros and dollars is neither. The log
   * stores a currency per session and nothing above it was reading the field,
   * so a player who flew to a EPT stop came home to a dashboard that had added
   * their euro results to their dollar ones and drawn a dollar sign in front
   * of the answer.
   *
   * Scoped rather than converted, deliberately: converting needs a rate, a
   * rate needs a date and a source, and a bankroll that quietly moves because
   * the pound did is not what anybody is asking this screen for. So the
   * numbers stay in the money they were won in, and a player with two
   * currencies gets a chip to say which one they are looking at.
   */
  const currencies = useMemo(() => currenciesUsed(all), [all]);
  const currency = picked !== null && currencies.includes(picked) ? picked : currencies[0] ?? 'USD';
  const sessions = useMemo(
    () => (currencies.length > 1 ? inCurrency(all, currency) : all),
    [all, currencies.length, currency],
  );

  const summary = useMemo(() => totals(sessions), [sessions]);
  const winRate = useMemo(() => cashWinRate(sessions), [sessions]);
  const tourneys = useMemo(() => tournamentTotals(sessions), [sessions]);
  /**
   * Keyed on the entries rather than on `sessions`, which the store replaces
   * on every write and every sync. See `useRoiInterval`: this used to resample
   * the whole entry list after a rebuy.
   */
  const entries = useEntryResults(sessions);
  const roiInterval = useRoiInterval(entries);

  /**
   * The starting balance, but only when it is in the money being shown.
   *
   * The headline is scoped to one currency, so a balance in dollars has
   * nothing to say about a euro column -- adding it would be the currency bug
   * this screen has already had once. A player looking at their second
   * currency sees profit, correctly labeled, which is what this screen showed
   * everybody before.
   *
   * Null rather than zero for "does not apply", because the rest of this
   * screen turns on the difference: zero is a real balance somebody entered,
   * and it is still a bankroll.
   */
  const balance = useMemo(
    () =>
      startingBalance !== null && startingBalance.currency === currency
        ? startingBalance.cents
        : null,
    [startingBalance, currency],
  );

  const curve = useMemo(() => bankrollCurve(sessions, balance ?? 0), [sessions, balance]);

  /**
   * The word and the figure under it, which have to agree.
   *
   * A balance is shown unsigned, because a bankroll is an amount rather than a
   * movement; profit keeps its sign, because a movement is the whole point of
   * it.
   */
  const headline = useMemo(
    () => ({
      label: balance === null ? 'Profit' : 'Bankroll',
      value: formatMoney(balance === null ? summary.net : balance + summary.net, {
        currency,
        signed: balance === null,
      }),
    }),
    [balance, summary.net, currency],
  );

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
        value: summary.hourly === null ? '--' : formatMoney(summary.hourly, { currency, signed: true }),
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
        value: summary.biggestWin === null ? '--' : formatMoney(summary.biggestWin, { currency, signed: true }),
        valueColor: resultColor(summary.biggestWin),
      },
      {
        label: 'Worst session',
        value:
          summary.biggestLoss === null ? '--' : formatMoney(summary.biggestLoss, { currency, signed: true }),
        valueColor: resultColor(summary.biggestLoss),
      },
    );

    return Array.from({ length: Math.ceil(tiles.length / 2) }, (_, index) =>
      tiles.slice(index * 2, index * 2 + 2),
    );
  }, [summary, winRate, tourneys, roiInterval, currency]);

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

  if (all.length === 0) {
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
          /*
            Three ways in, because there are three kinds of person on this
            screen and only one of them is about to sit down. The other two --
            somebody who has been keeping a spreadsheet, and somebody entering
            last night before they forget -- had to find Settings and the
            Sessions tab respectively to discover that this app does what they
            came for. The primary one is still the player at the table.
          */
          action={
            <View style={styles.emptyActions}>
              <Button label="Start a session" onPress={() => router.push('/session/new')} />
              <Button
                label="Add a session you already played"
                variant="ghost"
                size="medium"
                onPress={() => router.push('/session/past')}
              />
              <Button
                label="Import from a spreadsheet"
                variant="ghost"
                size="medium"
                onPress={() => router.push('/import')}
              />
            </View>
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
      {/*
        Only when there is a choice to make. One currency is every player this
        app has had until now, and a row of chips offering it to them would be
        a control with one button on it.
      */}
      {currencies.length > 1 ? (
        <View style={styles.currencyRow}>
          <ChipGroup
            options={currencies.map((code) => ({ value: code, label: currencyLabel(code) }))}
            value={currency}
            onChange={setPicked}
            scroll
          />
        </View>
      ) : null}

      {/*
        The headline, and the word over it has to be true.

        It said "Bankroll" over cumulative profit from zero for as long as this
        screen has existed. A bankroll is a balance: for a winning player the
        two differ by whatever they sat down with, and for a losing one the
        figure was negative, which no bankroll has ever been. The app even
        ships a guide about how big a bankroll should be, for a number it did
        not have.

        With a starting balance it is a balance and says so, with the profit
        underneath because that is the number the player is actually tracking.
        Without one it says Profit, which is what it has been showing all
        along.
      */}
      <View style={styles.brandHeader}>
        <Text variant="overline" color={colors.textTertiary}>
          {headline.label}
        </Text>
        <Text
          variant="display"
          color={balance === null ? resultColor(summary.net) : colors.text}
          // Labeled, so the word and the figure are read as one thing rather
          // than as an unexplained number after a heading.
          accessibilityLabel={`${headline.label}: ${headline.value}`}
        >
          {headline.value}
        </Text>
        {balance === null ? null : (
          <Text variant="bodyStrong" color={resultColor(summary.net)}>
            {formatMoney(summary.net, { currency, signed: true })} logged
          </Text>
        )}
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
        <LineChart
          series={chartSeries}
          height={170}
          // The curve is a balance once there is a starting one, so the axis
          // is anchored where the money starts rather than at zero. Anchored
          // at zero, a $20,000 roll swinging a few hundred drew as a flat line
          // over a solid block of fill: the whole plot spent on the space
          // underneath. Zero when there is no balance, which is every reading
          // this chart gave before.
          baseline={balance ?? 0}
          showZeroLine={balance === null}
          // Read instead of the drawing. The figure is the one above it; what
          // this adds is the shape, which is the only thing a curve says that
          // the headline does not.
          //
          // The curve's own last point, not `summary.net`: with a starting
          // balance set they are different numbers, and this one is the only
          // thing a screen reader is given in place of the line. It said
          // "ending at +$300" under a headline reading "Bankroll $5,300", and
          // the line really does end at 5,300.
          label={`Bankroll over ${summary.sessionCount} session${
            summary.sessionCount === 1 ? '' : 's'
          }, ending at ${formatMoney(curve[curve.length - 1]?.cumulative ?? summary.net, {
            currency,
            signed: balance === null,
          })}.`}
        />
        <View style={styles.chartAxis}>
          <Text variant="caption" color={colors.textTertiary}>
            {/* Where the line starts, read off the line. It was
                `balance ?? 0`, described as "where the line starts, which is
                the starting balance" -- and it is not: `bankrollCurve` emits
                one point per completed session and `cumulative` is the balance
                *after* that session, so the left end sits at the starting
                balance plus the oldest session's result. `LineChart`'s
                `baseline` widens the y range and adds no point.

                So the pair still disagreed with the drawing, by the first
                session's result rather than by the whole balance, and worst
                for the player with no balance set: `$0` under a line whose
                left end is their first night's profit. The right caption has
                read the curve all along. */}
            {/* And `> 1` rather than `> 0`, which is the chart's own rule:
                `LineChart` draws when a series has more than one point,
                because one point is not a line, and `bankrollCurve` emits one
                per completed session. With exactly one, the body read "Not
                enough data yet" and this strip still printed two money figures
                for a line nobody had drawn. */}
            {curve.length > 1 ? formatMoneyCompact(curve[0].cumulative, currency) : ''}
          </Text>
          <Text variant="caption" color={colors.textTertiary}>
            {curve.length > 1
              ? formatMoneyCompact(curve[curve.length - 1].cumulative, currency)
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
          onPress={() => openLink(GUIDES.bankroll)}
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
        <BarBreakdown groups={groups} currency={currency} />
      </Card>

      <SectionHeader title="Recent sessions" />
      <Card style={styles.listCard}>
        {/*
          `recent` is the sessions that have *ended*, while the empty state
          above this whole branch is gated on there being any session at all.
          So a log holding nothing but a session still running takes the full
          dashboard with `recent` empty, and the page ended on an overline with
          nothing under it -- `listCard` is `paddingVertical: 0`, so the card
          collapses to about a hairline and the heading is left labelling the
          bottom of the screen.

          It speaks rather than hides, which is what every section beside it
          does: `BarBreakdown` answers the same state with "Nothing to break
          down yet." And this is a first run, where the reason is worth a line
          -- the night they are in the middle of is not missing, it is not
          finished.
        */}
        {recent.length === 0 ? (
          <Text variant="caption" color={colors.textTertiary} style={styles.emptyList}>
            Nothing finished yet. A session lands here once you close it out.
          </Text>
        ) : (
          recent.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onPress={() => router.push(`/session/${session.id}`)}
            />
          ))
        )}
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
  emptyActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  currencyRow: {
    paddingTop: spacing.xl,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
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
  /** `listCard` drops the card's own vertical padding for the rows; a sentence needs it back. */
  emptyList: {
    paddingVertical: spacing.md,
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
