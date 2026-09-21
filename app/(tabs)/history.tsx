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
import { SearchField } from '../../src/components/SearchField';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { currencyLabel, formatMoney } from '../../src/domain/money';
import { matchesTerms, searchTerms } from '../../src/domain/search';
import { currenciesUsed, inCurrency, totals } from '../../src/domain/stats';
import {
  GAME_TYPES,
  GAME_TYPE_LABELS,
  SESSION_FORMATS,
  SESSION_FORMAT_LABELS,
  type GameType,
  type SessionFormat,
} from '../../src/domain/types';
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
  ...GAME_TYPES.map((value) => ({ value, label: GAME_TYPE_LABELS[value] })),
];

/**
 * Cash or tournament, which the rest of the app treats as two different games
 * and this screen could not tell apart.
 *
 * It matters more than the game-type filter beside it: the totals strip above
 * the list pools a tournament's result with a cash game's, and "how do I
 * actually run in the Tuesday tournament" was the one question two taps could
 * not answer. `SESSION_FORMAT_LABELS` rather than the bare values, because
 * "cash" as a chip beside "NLHE" reads like a stake.
 */
const FORMAT_OPTIONS = [
  { value: null, label: 'All formats' },
  ...SESSION_FORMATS.map((value) => ({ value, label: SESSION_FORMAT_LABELS[value] })),
];

const DAY = 86_400_000;

export default function HistoryScreen() {
  const all = useLogStore((state) => state.sessions);
  const venues = useLogStore((state) => state.venues);

  const [period, setPeriod] = useState<Period>('all');
  const [gameType, setGameType] = useState<GameType | null>(null);
  const [format, setFormat] = useState<SessionFormat | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  /**
   * The totals strip is a sum, so it has to be a sum of one currency.
   *
   * Same reasoning as the dashboard's: a log with a trip abroad in it was
   * adding euros to dollars and printing the answer with a dollar sign. The
   * list itself shows every session in the money it was played for, because a
   * row is one session and a session knows its own currency; it is only the
   * three tiles above it that had to pick.
   */
  const currencies = useMemo(() => currenciesUsed(all), [all]);
  const currency = picked !== null && currencies.includes(picked) ? picked : currencies[0] ?? 'USD';
  const sessions = useMemo(
    () => (currencies.length > 1 ? inCurrency(all, currency) : all),
    [all, currencies.length, currency],
  );

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
    const narrowed = filterSessions(sessions, {
      ...(from === undefined ? {} : { from }),
      ...(gameType === null ? {} : { gameType }),
      ...(format === null ? {} : { format }),
      ...(venueId === null ? {} : { venueId }),
    });
    /*
      The room and the note, which are the two things anybody remembers a
      session by. Not the numbers: somebody searching "300" means a buy-in,
      a cash-out or a result and the app cannot tell which, and a search that
      answers the wrong one of the three is worse than no search.
    */
    const terms = searchTerms(query);
    if (terms.length === 0) return narrowed;
    return narrowed.filter((session) =>
      matchesTerms(terms, session.venue?.name, session.notes),
    );
  }, [sessions, period, gameType, format, venueId, openedAt, query]);

  const summary = useMemo(() => totals(filtered), [filtered]);
  const filtersActive =
    period !== 'all' ||
    gameType !== null ||
    format !== null ||
    venueId !== null ||
    query.trim() !== '';

  /**
   * The format row is offered only to somebody who plays both, for the reason
   * the dashboard offers its own format breakdown conditionally: a chip that
   * can only ever filter to everything or to nothing is a chip in the way.
   */
  const mixedFormats = useMemo(() => {
    let cash = false;
    let tournament = false;
    for (const session of sessions) {
      if (session.format === 'cash') cash = true;
      else tournament = true;
      if (cash && tournament) return true;
    }
    return false;
  }, [sessions]);

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
        {/*
          The two other things somebody browsing their log wants: the night
          that is missing, which is why the way to add one belongs here rather
          than only behind "Start a session", and the hands, which until now
          could only be reached one session at a time.
        */}
        <View style={styles.headerActions}>
          <Button
            label="Hands"
            variant="ghost"
            size="small"
            onPress={() => router.push('/hands')}
          />
          <Button
            label="Add a past session"
            variant="ghost"
            size="small"
            onPress={() => router.push('/session/past')}
          />
        </View>
      </View>

      <View style={styles.search}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search rooms and notes"
          accessibilityLabel="Search sessions"
        />
      </View>

      <View style={styles.filters}>
        <ChipGroup options={PERIOD_OPTIONS} value={period} onChange={setPeriod} scroll />
        <ChipGroup options={GAME_OPTIONS} value={gameType} onChange={setGameType} scroll />
        {mixedFormats ? (
          <ChipGroup options={FORMAT_OPTIONS} value={format} onChange={setFormat} scroll />
        ) : null}
        {venues.length > 1 ? (
          <ChipGroup options={venueOptions} value={venueId} onChange={setVenueId} scroll />
        ) : null}
        {currencies.length > 1 ? (
          <ChipGroup
            options={currencies.map((code) => ({ value: code, label: currencyLabel(code) }))}
            value={currency}
            onChange={setPicked}
            scroll
          />
        ) : null}
      </View>

      <View style={styles.tiles}>
        <StatTile
          label="Profit"
          value={formatMoney(summary.net, { currency, signed: true })}
          valueColor={resultColor(summary.net)}
        />
        <StatTile
          label="Hourly"
          value={
            summary.hourly === null
              ? '--'
              : formatMoney(summary.hourly, { currency, signed: true })
          }
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
                setFormat(null);
                setVenueId(null);
                setQuery('');
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
            title={all.length === 0 ? 'Nothing logged yet' : 'No sessions match'}
            body={
              all.length === 0
                ? 'Your sessions will appear here once you log one.'
                : 'Try widening the filters, or go play some poker.'
            }
            action={
              all.length === 0 ? (
                // The same three as the dashboard's empty state: the header's
                // "Add a past session" is above the fold on a full list and
                // easy to miss on an empty one, and the importer is otherwise
                // only in Settings.
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
  emptyActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xl,
    marginBottom: spacing.lg,
    // The ghost button carries its own padding, so it is pulled back out to
    // the edge the title sits on.
    marginRight: -spacing.md,
  },
  search: {
    marginBottom: spacing.md,
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
