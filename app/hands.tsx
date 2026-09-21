/**
 * Every hand, which had nowhere to be read.
 *
 * ## Why this screen exists
 *
 * Logging a hand is the most expensive thing Log asks for: two cards, the
 * board, the seat, tags, the pot swing and a note, typed at a table with a
 * game going on. All of it was stored correctly and read back by exactly one
 * kind of screen, the one about a single session. So there was no way to see
 * your hands -- not all of them, not the ones from a given room, not the ones
 * you tagged `bad beat` this month -- and `position` was collected on every
 * hand and read by nothing anywhere in the app.
 *
 * Two of the three things anybody wants from a hand journal are patterns
 * across hands and retrieval, and neither was possible. This is the retrieval
 * half; the patterns half is the breakdown on the Variance tab, which draws
 * the same groups `domain/hands.ts` computes.
 *
 * ## What it is honest about
 *
 * These are the hands somebody chose to log, not the hands they played. That
 * matters more on the breakdown than here -- a list is a list -- but the
 * filters can produce a count, and a count invites being read as a sample. The
 * header says how many hands are in view and nothing about rates.
 *
 * ## Read, not held
 *
 * `useAllHands` goes to the repository while this screen is open rather than
 * putting the hands in the store, which is the decision recorded above
 * `handCount`: keeping them in memory cost the most expensive read in the app
 * on every hand write. A screen that wants all of them pays for them; nothing
 * else pays anything.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '../src/components/Button';
import { ChipGroup } from '../src/components/Chip';
import { EmptyState } from '../src/components/EmptyState';
import { PageMeta } from '../src/components/PageMeta';
import { Screen } from '../src/components/Screen';
import { SectionHeader } from '../src/components/SectionHeader';
import { Text } from '../src/components/Text';
import {
  HAND_TAGS,
  HAND_TAG_LABELS,
  POSITIONS,
  type Hand,
  type HandTag,
  type Position,
} from '../src/domain/types';
import { HandRow } from '../src/features/sessions/HandRow';
import { useAllHands, useLogStore } from '../src/store/useLogStore';
import { colors, radius, spacing } from '../src/theme';

const DAY = 86_400_000;

const PERIOD_OPTIONS = [
  { value: 'all' as const, label: 'All time' },
  { value: '30' as const, label: '30 days' },
  { value: '90' as const, label: '90 days' },
  { value: '365' as const, label: 'This year' },
];

const TAG_OPTIONS = [
  { value: null, label: 'All hands' },
  ...HAND_TAGS.map((value) => ({ value, label: HAND_TAG_LABELS[value] })),
];

const POSITION_OPTIONS = [
  { value: null, label: 'Any seat' },
  ...POSITIONS.map((value) => ({ value, label: value })),
];

export default function HandsScreen() {
  const hands = useAllHands();
  const sessions = useLogStore((state) => state.sessions);
  const venues = useLogStore((state) => state.venues);

  const [period, setPeriod] = useState<'all' | '30' | '90' | '365'>('all');
  const [tag, setTag] = useState<HandTag | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);

  // Fixed at mount, for the reason the dashboard fixes its own: a window that
  // moves every frame re-derives the whole list constantly, and the one
  // boundary it could cross is a day away.
  const [openedAt] = useState(() => Date.now());

  /** The session a hand belongs to, for its room and the money it was played for. */
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );

  const venueOptions = useMemo(
    () => [
      { value: null, label: 'All venues' },
      ...venues.map((venue) => ({ value: venue.id, label: venue.name })),
    ],
    [venues],
  );

  const filtered = useMemo(() => {
    if (hands === null) return [];
    const from = period === 'all' ? null : openedAt - Number(period) * DAY;
    return hands.filter((hand) => {
      if (from !== null && hand.at < from) return false;
      if (tag !== null && !hand.tags.includes(tag)) return false;
      if (position !== null && hand.position !== position) return false;
      if (venueId !== null && sessionById.get(hand.sessionId)?.venueId !== venueId) return false;
      return true;
    });
  }, [hands, period, tag, position, venueId, sessionById, openedAt]);

  const filtersActive =
    period !== 'all' || tag !== null || position !== null || venueId !== null;
  const last = filtered.length - 1;

  const header = (
    <>
      <View style={styles.topBar}>
        <Button
          label="Back"
          variant="ghost"
          size="small"
          leading={<Ionicons name="chevron-back" size={16} color={colors.textSecondary} />}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/history'))}
        />
      </View>

      <View style={styles.header}>
        <Text variant="title">Hands</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          Every hand you have written down, newest first. Tap one to change it.
        </Text>
      </View>

      <View style={styles.filters}>
        <ChipGroup options={PERIOD_OPTIONS} value={period} onChange={setPeriod} scroll />
        <ChipGroup options={TAG_OPTIONS} value={tag} onChange={setTag} scroll />
        <ChipGroup options={POSITION_OPTIONS} value={position} onChange={setPosition} scroll />
        {venues.length > 1 ? (
          <ChipGroup options={venueOptions} value={venueId} onChange={setVenueId} scroll />
        ) : null}
      </View>

      <SectionHeader
        title={`${filtered.length} hand${filtered.length === 1 ? '' : 's'}`}
        action={
          filtersActive ? (
            <Button
              label="Clear filters"
              variant="ghost"
              size="small"
              onPress={() => {
                setPeriod('all');
                setTag(null);
                setPosition(null);
                setVenueId(null);
              }}
            />
          ) : undefined
        }
      />
    </>
  );

  /**
   * Newest first, which is the other end from the session detail screen.
   *
   * There a hand list is the story of one night and reads forwards. Here it is
   * a log, and the hand somebody is looking for is almost always a recent one.
   */
  const ordered = useMemo(() => [...filtered].sort((a, b) => b.at - a.at), [filtered]);

  return (
    <Screen scroll={false} contentStyle={styles.fill}>
      <PageMeta title="Hands · Log" />
      <FlatList
        data={ordered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          // Three states, not two: the read has not landed, there are no hands
          // at all, or the filters emptied it. Drawing "no hands" during the
          // read is an empty state that flashes and then fills.
          hands === null ? null : (
            <EmptyState
              title={hands.length === 0 ? 'No hands logged yet' : 'No hands match'}
              body={
                hands.length === 0
                  ? 'Hands are logged from inside a session, from the button under the clock. Two cards and a line about what happened is enough.'
                  : 'Try widening the filters.'
              }
            />
          )
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.listRow,
              index === 0 ? styles.listTop : null,
              index === last ? styles.listBottom : null,
            ]}
          >
            <HandRow
              hand={item as Hand}
              currency={sessionById.get(item.sessionId)?.currency ?? 'USD'}
              onPress={() => router.push(`/session/hand?id=${item.id}`)}
            />
          </View>
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    marginLeft: -spacing.md,
  },
  header: {
    paddingTop: spacing.md,
    marginBottom: spacing.lg,
  },
  subtitle: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  filters: {
    gap: spacing.sm,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.xxxl,
  },
  listRow: {
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  listTop: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  listBottom: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
});
