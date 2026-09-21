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
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { formatEntry, formatMoney, formatStakes } from '../../src/domain/money';
import { formatFinish } from '../../src/domain/tournaments';
import {
  durationMs,
  formatDuration,
  hourlyRate,
  netResult,
  totalInvested,
} from '../../src/domain/stats';
import { HandRow } from '../../src/features/sessions/HandRow';
import { MoodTimeline } from '../../src/features/sessions/MoodTimeline';
import { PostSessionReset } from '../../src/features/sessions/PostSessionReset';
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
  const { id, ended } = useLocalSearchParams<{ id: string; ended?: string }>();
  const session = useSessionById(id ?? null);
  const hands = useHandsForSession(id ?? null);
  const moods = useMoodForSession(id ?? null);
  const updateNotes = useLogStore((state) => state.updateSessionNotes);
  const deleteSession = useLogStore((state) => state.deleteSession);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /**
   * A write on this screen that did not work, said out loud.
   *
   * The live-session screens learned this the hard way -- see
   * `__tests__/screens/writeFailures.test.tsx`, which exists because a write
   * that failed silently reads as a write that worked. Both writes on this
   * screen were still silent: the notes were fired off on blur and forgotten,
   * and the delete navigated away before it knew whether it had happened.
   */
  const [failed, setFailed] = useState<string | null>(null);

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

  const { currency } = session;
  const tournament = session.format === 'tournament';
  const invested = totalInvested(session, session.rebuys);
  const net = netResult(session, session.rebuys);
  const hourly = hourlyRate(session, session.rebuys);
  const elapsed = durationMs(session);
  const live = session.endedAt === null;

  /**
   * Save on blur, and say so when it does not save.
   *
   * What the player typed stays in the draft either way, which is the whole
   * reason this is worth catching: the text is still on screen looking saved,
   * so without a word here the only thing that ever says otherwise is coming
   * back to the session tomorrow and finding it empty.
   */
  const saveNotes = async () => {
    const trimmed = notes.trim();
    if (trimmed === (session.notes ?? '')) return;
    setFailed(null);
    try {
      await updateNotes(session.id, trimmed === '' ? null : trimmed);
    } catch (error) {
      setFailed(describeFailure(error, 'Those notes could not be saved.'));
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setFailed(null);
    try {
      await deleteSession(session.id);
      router.replace('/history');
    } catch (error) {
      setFailed(describeFailure(error, 'That session could not be deleted.'));
      setDeleting(false);
    }
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
          {session.venue?.name ?? 'Unknown venue'} ·{' '}
          {tournament
            ? formatEntry(session.buyIn, session.fee, currency)
            : session.stakes === null
              ? session.gameType
              : `${formatStakes(session.stakes, currency)} · ${session.gameType}`}
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
          label={tournament ? 'Entry cost' : 'Bought in'}
          value={formatMoney(invested, { currency })}
          hint={
            session.rebuys.length > 0
              ? `incl. ${session.rebuys.length} ${tournament ? 're-entry' : 'rebuy'}`
              : tournament && session.fee
                ? `incl. ${formatMoney(session.fee, { currency })} fee`
                : tournament
                  ? 'one entry'
                  : 'no rebuys'
          }
        />
        <StatTile
          label={tournament ? 'Prize' : 'Cashed out'}
          value={session.cashOut === null ? '--' : formatMoney(session.cashOut, { currency })}
        />
      </View>

      {tournament && formatFinish(session.finishPosition, session.entrants) !== null ? (
        <View style={styles.tiles}>
          <StatTile
            label="Finished"
            value={formatFinish(session.finishPosition, session.entrants) as string}
            hint={
              session.finishPosition !== null && session.entrants
                ? `top ${Math.max(1, Math.round((session.finishPosition / session.entrants) * 100))}%`
                : undefined
            }
          />
          <StatTile
            label="Result"
            value={net === null ? '--' : formatMoney(net, { currency, signed: true })}
            valueColor={resultColor(net)}
          />
        </View>
      ) : null}

      {live ? (
        <Button
          label="Back to live session"
          style={styles.resume}
          onPress={() => router.replace('/session/active')}
        />
      ) : null}

      {/*
        Only for the session that was just closed out, and only once it is
        closed out. This screen is also where History lands, and an offer to
        wind down from a night three weeks ago is noise. See the header of
        `PostSessionReset`.
      */}
      {ended === '1' && !live ? <PostSessionReset /> : null}

      {moods.length > 0 ? (
        <>
          <SectionHeader title="Tilt meter" />
          <Card>
            <MoodTimeline entries={moods} />
          </Card>
        </>
      ) : null}

      {/*
        Null is "not read yet", which is not "none": the hands are read per
        session now rather than held in the store. Saying "no hands logged" in
        that gap would be wrong rather than early, so the count and the card
        both wait for the answer.
      */}
      <SectionHeader title={hands === null ? 'Hands' : `Hands (${hands.length})`} />
      {hands === null ? null : hands.length === 0 ? (
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
        onBlur={() => void saveNotes()}
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
                loading={deleting}
                // Awaited before leaving. Navigating first meant a delete that
                // threw put the player in History with the session still in
                // it and nothing anywhere saying why.
                onPress={() => void remove()}
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
        <ErrorNote message={failed} />
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
