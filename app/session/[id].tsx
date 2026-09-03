/**
 * Session detail: the record of one night.
 *
 * Result first and large, because that is what the player came to see, then the
 * numbers behind it, then how it felt, then the hands. Notes are editable here
 * rather than during play -- writing prose at a table is not a thing anyone does.
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { formatMoney, formatStakes } from '../../src/domain/money';
import {
  durationMs,
  formatDuration,
  hourlyRate,
  netResult,
  totalInvested,
} from '../../src/domain/stats';
import { HandRow } from '../../src/features/sessions/HandRow';
import { MoodTimeline } from '../../src/features/sessions/MoodTimeline';
import { formatSessionDate, formatTimeOfDay } from '../../src/features/sessions/format';
import {
  useHandsForSession,
  useLogStore,
  useMoodForSession,
  useSessionById,
} from '../../src/store/useLogStore';
import { colors, radius, resultColor, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSessionById(id ?? null);
  const hands = useHandsForSession(id ?? null);
  const moods = useMoodForSession(id ?? null);
  const updateNotes = useLogStore((state) => state.updateSessionNotes);
  const deleteSession = useLogStore((state) => state.deleteSession);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /**
   * The notes field is a draft seeded from the stored value. It is re-seeded
   * when the screen moves to a different session -- adjusted during render, per
   * React's guidance, rather than synced in an effect, which would cost an
   * extra render pass and could clobber what the player is typing after an
   * unrelated store refresh.
   */
  const [draft, setDraft] = useState({ id: session?.id ?? null, notes: session?.notes ?? '' });
  if (session && draft.id !== session.id) {
    setDraft({ id: session.id, notes: session.notes ?? '' });
  }
  const notes = draft.notes;
  const setNotes = (value: string) => setDraft((current) => ({ ...current, notes: value }));

  if (!session) {
    return (
      <Screen>
        <PageMeta title="Session · Log" />
        <View style={styles.missing}>
          <Text variant="heading" center>
            Session not found
          </Text>
          <Button label="Back" style={styles.missingAction} onPress={() => router.replace('/history')} />
        </View>
      </Screen>
    );
  }

  const currency = session.stakes.currency;
  const invested = totalInvested(session, session.rebuys);
  const net = netResult(session, session.rebuys);
  const hourly = hourlyRate(session, session.rebuys);
  const elapsed = durationMs(session);
  const live = session.endedAt === null;

  const saveNotes = () => {
    const trimmed = notes.trim();
    if (trimmed === (session.notes ?? '')) return;
    void updateNotes(session.id, trimmed === '' ? null : trimmed);
  };

  return (
    <Screen>
      <PageMeta title="Session · Log" />
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
        <Text variant="overline" color={colors.textTertiary}>
          {formatSessionDate(session.startedAt)} · {formatTimeOfDay(session.startedAt)}
          {session.endedAt ? ` - ${formatTimeOfDay(session.endedAt)}` : ''}
        </Text>
        <Text variant="display" color={resultColor(net)}>
          {live ? 'In progress' : formatMoney(net ?? 0, { currency, signed: true })}
        </Text>
        <Text color={colors.textSecondary}>
          {session.venue?.name ?? 'Unknown venue'} · {formatStakes(session.stakes)} ·{' '}
          {session.gameType}
        </Text>
      </View>

      <View style={styles.tiles}>
        <StatTile label="Duration" value={formatDuration(elapsed)} />
        <StatTile
          label="Hourly"
          value={hourly === null ? '--' : formatMoney(hourly, { currency, signed: true })}
          valueColor={resultColor(hourly)}
        />
      </View>
      <View style={styles.tiles}>
        <StatTile
          label="Bought in"
          value={formatMoney(invested, { currency })}
          hint={session.rebuys.length > 0 ? `incl. ${session.rebuys.length} rebuy` : 'no rebuys'}
        />
        <StatTile
          label="Cashed out"
          value={session.cashOut === null ? '--' : formatMoney(session.cashOut, { currency })}
        />
      </View>

      {live ? (
        <Button
          label="Back to live session"
          style={styles.resume}
          onPress={() => router.replace('/session/active')}
        />
      ) : null}

      {moods.length > 0 ? (
        <>
          <SectionHeader title="Tilt meter" />
          <Card>
            <MoodTimeline entries={moods} />
          </Card>
        </>
      ) : null}

      <SectionHeader title={`Hands (${hands.length})`} />
      {hands.length === 0 ? (
        <Card>
          <Text color={colors.textSecondary}>No hands logged for this session.</Text>
        </Card>
      ) : (
        <Card style={styles.handsCard}>
          {hands.map((hand) => (
            <HandRow key={hand.id} hand={hand} currency={currency} showDrillLink />
          ))}
        </Card>
      )}

      <SectionHeader title="Notes" />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        onBlur={saveNotes}
        placeholder="Anything worth remembering about this session"
        placeholderTextColor={colors.textTertiary}
        multiline
        style={styles.notes}
        accessibilityLabel="Session notes"
      />

      <View style={styles.dangerZone}>
        {confirmingDelete ? (
          <View style={styles.confirmRow}>
            <Text color={colors.textSecondary} style={styles.confirmText}>
              Delete this session and its hands? This can’t be undone.
            </Text>
            <View style={styles.confirmActions}>
              <Button
                label="Cancel"
                variant="secondary"
                size="small"
                onPress={() => setConfirmingDelete(false)}
              />
              <Button
                label="Delete"
                variant="danger"
                size="small"
                onPress={() => {
                  void deleteSession(session.id);
                  router.replace('/history');
                }}
              />
            </View>
          </View>
        ) : (
          <Button
            label="Delete session"
            variant="danger"
            size="medium"
            onPress={() => setConfirmingDelete(true)}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    marginLeft: -spacing.md,
  },
  header: {
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resume: {
    marginTop: spacing.lg,
  },
  handsCard: {
    paddingVertical: 0,
  },
  notes: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 96,
    padding: spacing.lg,
    textAlignVertical: 'top',
    ...Platform.select({ web: { outlineStyle: 'none' as 'solid' }, default: {} }),
  },
  dangerZone: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },
  confirmRow: {
    gap: spacing.md,
  },
  confirmText: {
    lineHeight: 22,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  missing: {
    paddingTop: spacing.xxxl,
    gap: spacing.xl,
  },
  missingAction: {
    alignSelf: 'stretch',
  },
});
