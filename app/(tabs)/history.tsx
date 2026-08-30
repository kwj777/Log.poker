/**
 * Session history.
 *
 * Filters recompute a totals strip above the list, so "how do I actually run at
 * the Tuesday home game" is answered by two taps rather than by exporting a CSV
 * and opening a spreadsheet.
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
import { formatMoney } from '../../src/domain/money';
import { totals } from '../../src/domain/stats';
import { GAME_TYPES, type GameType } from '../../src/domain/types';
import { SessionRow } from '../../src/features/sessions/SessionRow';
import { filterSessions, useLogStore } from '../../src/store/useLogStore';
import { resultColor, spacing } from '../../src/theme';

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

  const venueOptions = useMemo(
    () => [
      { value: null, label: 'All venues' },
      ...venues.map((venue) => ({ value: venue.id, label: venue.name })),
    ],
    [venues],
  );

  const filtered = useMemo(() => {
    const from = period === 'all' ? undefined : Date.now() - Number(period) * DAY;
    return filterSessions(sessions, {
      ...(from === undefined ? {} : { from }),
      ...(gameType === null ? {} : { gameType }),
      ...(venueId === null ? {} : { venueId }),
    });
  }, [sessions, period, gameType, venueId]);

  const summary = useMemo(() => totals(filtered), [filtered]);
  const filtersActive = period !== 'all' || gameType !== null || venueId !== null;

  return (
    <Screen>
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
          value={summary.hourly === null ? '—' : formatMoney(summary.hourly, { signed: true })}
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

      {filtered.length === 0 ? (
        <EmptyState
          title={sessions.length === 0 ? 'Nothing logged yet' : 'No sessions match'}
          body={
            sessions.length === 0
              ? 'Your sessions will appear here once you log one.'
              : 'Try widening the filters — or go play some poker.'
          }
          action={
            sessions.length === 0 ? (
              <Button label="Start a session" onPress={() => router.push('/session/new')} />
            ) : undefined
          }
        />
      ) : (
        <Card style={styles.listCard}>
          {filtered.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onPress={() => router.push(`/session/${session.id}`)}
            />
          ))}
        </Card>
      )}
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
  listCard: {
    paddingVertical: 0,
  },
});
