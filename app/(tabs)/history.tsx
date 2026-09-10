/**
 * Session history.
 *
 * Filters recompute a totals strip above the list, so "how do I actually run at
 * the Tuesday home game" is answered by two taps rather than by exporting a CSV
 * and opening a spreadsheet.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../src/components/Button';
import { ChipGroup } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { formatMoney } from '../../src/domain/money';
import { totals } from '../../src/domain/stats';
import { GAME_TYPES, type GameType } from '../../src/domain/types';
import { SessionRow } from '../../src/features/sessions/SessionRow';
import { filterSessions, useLogStore } from '../../src/store/useLogStore';
import { colors, radius, resultColor, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

type Period = 'all' | '30' | '90' | '365';

const PERIOD_OPTIONS = [
  { value: 'all' as const, label: 'All time' },
  { value: '30' as const, label: '30 days' },
  { value: '90' as const, label: '90 days' },
  { value: '365' as const, label: 'This year' },
];

const GAME_OPTIONS = [
  { value: null, label: 'All games' },
  ...GAME_TYPES.map((value) => ({ value, label: value === 'OTHER' ? 'Other' : value })),
];

const DAY = 86_400_000;

export default function HistoryScreen() {
  const sessions = useLogStore((state) => state.sessions);
  const venues = useLogStore((state) => state.venues);

  const [period, setPeriod] = useState<Period>('all');
  const [gameType, setGameType] = useState<GameType | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);

  /**
   * The clock is read once, on mount, rather than during render: a "last 30
   * days" window that slides by milliseconds on every re-render would make the
   * memo below recompute constantly and the totals flicker at a boundary.
   */
  const [openedAt] = useState(() => Date.now());

  const venueOptions = useMemo(
    () => [
      { value: null, label: 'All venues' },
      ...venues.map((venue) => ({ value: venue.id, label: venue.name })),
    ],
    [venues],
  );

  const filtered = useMemo(() => {
    const from = period === 'all' ? undefined : openedAt - Number(period) * DAY;
    return filterSessions(sessions, {
      ...(from === undefined ? {} : { from }),
      ...(gameType === null ? {} : { gameType }),
      ...(venueId === null ? {} : { venueId }),
    });
  }, [sessions, period, gameType, venueId, openedAt]);

  const summary = useMemo(() => totals(filtered), [filtered]);
  const filtersActive = period !== 'all' || gameType !== null || venueId !== null;

  const last = filtered.length - 1;

  /**
   * Everything above the list, handed to the list rather than placed above it.
   *
   * `ListHeaderComponent` keeps it scrolling with the sessions, which is what
   * it did when the whole screen was one `ScrollView`. Putting it above the
   * list instead would pin the filters in place -- arguably nicer, and not this
   * change's to decide.
   */
  const header = (
    <>
      <View style={styles.header}>
        <Text variant="title">Sessions</Text>
      </View>

      <View style={styles.filters}>
        <ChipGroup options={PERIOD_OPTIONS} value={period} onChange={setPeriod} scroll />
        <ChipGroup options={GAME_OPTIONS} value={gameType} onChange={setGameType} scroll />
        {venues.length > 1 ? (
          <ChipGroup options={venueOptions} value={venueId} onChange={setVenueId} scroll />
        ) : null}
      </View>

      <View style={styles.tiles}>
        <StatTile
          label="Profit"
          value={formatMoney(summary.net, { signed: true })}
          valueColor={resultColor(summary.net)}
        />
        <StatTile
          label="Hourly"
          value={summary.hourly === null ? '--' : formatMoney(summary.hourly, { signed: true })}
          valueColor={resultColor(summary.hourly)}
        />
        <StatTile label="Hours" value={String(Math.round(summary.hours))} />
      </View>

      <SectionHeader
        title={`${filtered.length} session${filtered.length === 1 ? '' : 's'}`}
        action={
          filtersActive ? (
            <Button
              label="Clear filters"
              variant="ghost"
              size="small"
              onPress={() => {
                setPeriod('all');
                setGameType(null);
                setVenueId(null);
              }}
            />
          ) : undefined
        }
      />

    </>
  );

  return (
    /**
     * The list scrolls itself now, so the screen must not.
     *
     * It used to be `filtered.map` inside the screen's `ScrollView`, which
     * mounted a component per session with nothing to stop it -- on a screen
     * that is one of four tabs and stays mounted, holding a log the data layer
     * is explicitly built to grow for years. Five years of a heavy live player
     * is 600 of them.
     */
    <Screen scroll={false} contentStyle={styles.fill}>
      <PageMeta title="Sessions · Log" />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            title={sessions.length === 0 ? 'Nothing logged yet' : 'No sessions match'}
            body={
              sessions.length === 0
                ? 'Your sessions will appear here once you log one.'
                : 'Try widening the filters, or go play some poker.'
            }
            action={
              sessions.length === 0 ? (
                <Button label="Start a session" onPress={() => router.push('/session/new')} />
              ) : undefined
            }
          />
        }
        renderItem={({ item, index }) => (
          // The card that used to wrap the whole list, drawn per row instead:
          // a `FlatList` has no single element around its items to put it on.
          // Surface and side borders on every row, and the corners on the two
          // that have them.
          <View
            style={[
              styles.listRow,
              index === 0 ? styles.listTop : null,
              index === last ? styles.listBottom : null,
            ]}
          >
            <SessionRow session={item} onPress={() => router.push(`/session/${item.id}`)} />
          </View>
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  filters: {
    gap: spacing.sm,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  fill: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  listRow: {
    backgroundColor: colors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  listTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  listBottom: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: 'hidden',
  },
});
