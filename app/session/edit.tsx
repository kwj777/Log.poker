/**
 * Correct a session that was logged wrong.
 *
 * ## Why this screen exists
 *
 * Everything a session records could be typed wrong and none of it could be
 * changed. The detail screen edited the notes and nothing else, so a cash-out
 * entered as 1800 instead of 180 had exactly one remedy: delete the session,
 * and its hands and its mood entries with it. Meanwhile the wrong number sat
 * in the bankroll curve, the hourly rate, the win rate, the best and worst
 * tiles and the variance estimate -- which is the feature the app is for.
 *
 * The storage layer could always do this. `SessionPatch` has covered the venue,
 * the game, the stakes, the currency, the buy-in, the fee, the cash-out, the
 * field, the finish and both timestamps since it was written, and both
 * repositories implement it under the contract suite. What was missing was a
 * screen.
 *
 * ## The length, rather than the end time
 *
 * A start is a date and a clock time, which is what a player remembers. The
 * other end is asked for as a length, because the case this most often fixes
 * is a session nobody cashed out: the phone went in a pocket, the timer ran
 * until the next afternoon, and eleven hours went into a rate that divides by
 * hours played. Somebody correcting that does not know when the app thinks
 * they finished. They know they played about four hours. So the field takes
 * four hours and the end time is derived, and shown underneath so the
 * arithmetic is visible rather than implied.
 *
 * ## What is not here
 *
 * The format. Cash and tournament are different records rather than a setting
 * -- one has blinds, the other a fee, a field and a finish -- and `SessionPatch`
 * does not carry it. A cash game logged as a tournament is a rare enough
 * mistake, and a destructive enough correction, to be worth deleting and
 * re-entering rather than being one tap away on this screen.
 *
 * The notes, which stay on the detail screen where they are read.
 *
 * A live session's length, which is not a fact yet. Its start is editable
 * here; its end is asked for at cash-out, which is the other half of this and
 * lives in `app/session/active.tsx`.
 */

import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { ChipGroup } from '../../src/components/Chip';
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Text } from '../../src/components/Text';
import { successFeedback } from '../../src/components/haptics';
import {
  formatDateInput,
  formatTimeInput,
  fromHoursAndMinutes,
  isAhead,
  parseDateTime,
  toHoursAndMinutes,
} from '../../src/domain/clock';
import { parseCount } from '../../src/domain/import/values';
import {
  CURRENCIES,
  currencyLabel,
  formatMoney,
  parseAmount,
} from '../../src/domain/money';
import { durationMs } from '../../src/domain/stats';
import { GAME_TYPES, type GameType, type Stakes } from '../../src/domain/types';
import { StakesPicker } from '../../src/features/sessions/StakesPicker';
import { VenuePicker } from '../../src/features/sessions/VenuePicker';
import { DurationInput, StartedAtInput } from '../../src/features/sessions/WhenInput';
import { formatSessionDate, formatTimeOfDay } from '../../src/features/sessions/format';
import { useLogStore, useSessionById } from '../../src/store/useLogStore';
import { colors, radius, spacing, typography } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

const GAME_OPTIONS = GAME_TYPES.map((value) => ({
  value,
  label: value === 'OTHER' ? 'Other' : value,
}));

const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: currencyLabel(value) }));

/** Cents to the string an `AmountInput` holds, and back. */
const toField = (cents: number | null): string => (cents === null ? '' : String(cents / 100));

export default function EditSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSessionById(id ?? null);
  const venues = useLogStore((state) => state.venues);
  const createVenue = useLogStore((state) => state.createVenue);
  const editSession = useLogStore((state) => state.editSession);

  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * The form, seeded from the session and re-seeded if the screen moves to
   * another one. Adjusted during render rather than in an effect, the way the
   * detail screen seeds its notes: an effect renders the empty form first.
   */
  const [form, setForm] = useState(() => seed(session));
  if (session && form.id !== session.id) setForm(seed(session));

  if (!session) {
    return (
      <Screen>
        <PageMeta title="Edit session · Log" />
        <View style={styles.missing}>
          <Text variant="heading" center>
            Session not found
          </Text>
          <Button
            label="Back"
            style={styles.missingAction}
            onPress={() => router.replace('/history')}
          />
        </View>
      </Screen>
    );
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const tournament = session.format === 'tournament';
  const live = session.endedAt === null;

  const startedAt = parseDateTime(form.date, form.time);
  const buyIn = parseAmount(form.buyIn);
  const cashOut = form.cashOut.trim() === '' ? null : parseAmount(form.cashOut);
  const length = live ? null : fromHoursAndMinutes(form.hours, form.minutes);

  const startInvalid = startedAt === null;
  const lengthInvalid = !live && length === null;

  /** What the length works out to, so the arithmetic is on screen. */
  const endsAt = startedAt !== null && length !== null ? startedAt + length : null;

  /**
   * A session cannot have happened later than now.
   *
   * The start applies to a live session too -- one that started in an hour's
   * time is the same typo. The end only applies to a finished one, where a
   * mistyped length (40 hours for 4) is a mistake the start field cannot show.
   */
  const startAhead = startedAt !== null && isAhead(startedAt);
  const endAhead = !live && !startAhead && endsAt !== null && isAhead(endsAt);

  const startHint = startAhead ? 'That is in the future. Check the year.' : undefined;
  const lengthHint = lengthInvalid
    ? 'How long did you actually play? Hours and minutes.'
    : endAhead
      ? 'That length runs past now. Check the hours.'
      : endsAt === null
        ? 'How long you played, rather than when the app stopped counting.'
        : `Finishing ${formatSessionDate(endsAt)} at ${formatTimeOfDay(endsAt)}.`;

  const canSave =
    !startInvalid &&
    !lengthInvalid &&
    !startAhead &&
    !endAhead &&
    buyIn !== null &&
    buyIn > 0 &&
    !saving;

  const save = async () => {
    if (!canSave || startedAt === null || buyIn === null) return;
    setSaving(true);
    setFailed(null);
    try {
      await editSession(session.id, {
        venueId: form.venueId ?? session.venueId,
        gameType: form.gameType,
        // A tournament has no blinds to keep, and a cash session that lost
        // them to an import gets them back here.
        stakes: tournament ? null : form.stakes,
        currency: form.currency,
        buyIn,
        fee: tournament ? (parseAmount(form.fee) ?? 0) : null,
        cashOut,
        ...(tournament
          ? {
              entrants: parseCount(form.entrants),
              finishPosition: parseCount(form.finishPosition),
            }
          : {}),
        startedAt,
        // A live session keeps its open end. Only a finished one has a length
        // to be wrong about.
        ...(live ? {} : { endedAt: startedAt + (length as number) }),
      });
      successFeedback();
      router.back();
    } catch (error) {
      setFailed(describeFailure(error, 'Those changes could not be saved.'));
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label="Save changes"
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
          <Button label="Cancel" variant="ghost" size="medium" onPress={() => router.back()} />
        </View>
      }
    >
      <PageMeta title="Edit session · Log" />
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
        <Text variant="title">Edit session</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          {live
            ? 'This one is still running, so there is no result yet. The start is here if it was wrong.'
            : 'Fix whatever was typed wrong. Everything here feeds your hourly rate and your variance.'}
        </Text>
      </View>

      <SectionHeader title="Where" />
      <VenuePicker
        venues={venues}
        value={form.venueId}
        onChange={(venueId) => set('venueId', venueId)}
        onCreate={createVenue}
      />

      <SectionHeader title="Game" />
      <ChipGroup
        options={GAME_OPTIONS}
        value={form.gameType}
        onChange={(value) => set('gameType', value)}
      />

      <SectionHeader title="Currency" />
      <ChipGroup
        options={CURRENCY_OPTIONS}
        value={form.currency}
        onChange={(value) => set('currency', value)}
        scroll
      />

      {tournament ? null : (
        <>
          <SectionHeader title="Stakes" />
          <StakesPicker
            value={form.stakes}
            onChange={(value) => set('stakes', value)}
            currency={form.currency}
          />
        </>
      )}

      <SectionHeader title={tournament ? 'Buy-in' : 'Bought in for'} />
      <AmountInput
        value={form.buyIn}
        onChangeText={(value) => set('buyIn', value)}
        currency={form.currency}
        accessibilityLabel="Buy-in amount"
      />

      {tournament ? (
        <>
          <SectionHeader title="Entry fee" />
          <AmountInput
            value={form.fee}
            onChangeText={(value) => set('fee', value)}
            currency={form.currency}
            accessibilityLabel="Entry fee"
          />
        </>
      ) : null}

      <SectionHeader title="Started" />
      <StartedAtInput
        date={form.date}
        time={form.time}
        onChangeDate={(value) => set('date', value)}
        onChangeTime={(value) => set('time', value)}
        invalid={startInvalid || startAhead}
        hint={startHint}
      />

      {live ? null : (
        <>
          <SectionHeader title="Played for" />
          <DurationInput
            hours={form.hours}
            minutes={form.minutes}
            onChangeHours={(value) => set('hours', value)}
            onChangeMinutes={(value) => set('minutes', value)}
            hint={lengthHint}
            invalid={lengthInvalid || endAhead}
          />

          <SectionHeader title={tournament ? 'Prize' : 'Cashed out'} />
          <AmountInput
            value={form.cashOut}
            onChangeText={(value) => set('cashOut', value)}
            currency={form.currency}
            accessibilityLabel={tournament ? 'Prize won' : 'Cash-out amount'}
          />
          <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
            {cashOut === null
              ? 'Empty puts this session back to running, with no result.'
              : `A result of ${formatMoney(
                  cashOut - (buyIn ?? 0) - (tournament ? (parseAmount(form.fee) ?? 0) : 0) -
                    session.rebuys.reduce((sum, rebuy) => sum + rebuy.amount, 0),
                  { currency: form.currency, signed: true },
                )}, with the rebuys already logged.`}
          </Text>
        </>
      )}

      {tournament && !live ? (
        <>
          <SectionHeader title="Where you finished" />
          <View style={styles.finishRow}>
            <TextInput
              value={form.finishPosition}
              onChangeText={(value) => set('finishPosition', value)}
              placeholder="Place"
              placeholderTextColor={colors.textTertiary}
              inputMode="numeric"
              accessibilityLabel="Finishing position"
              style={styles.finishInput}
            />
            <Text color={colors.textTertiary}>of</Text>
            <TextInput
              value={form.entrants}
              onChangeText={(value) => set('entrants', value)}
              placeholder="Entrants"
              placeholderTextColor={colors.textTertiary}
              inputMode="numeric"
              accessibilityLabel="Number of entrants"
              style={styles.finishInput}
            />
          </View>
        </>
      ) : null}

      <ErrorNote message={failed} />
    </Screen>
  );
}

/** The form as the session currently reads. */
const seed = (session: ReturnType<typeof useSessionById>) => {
  const fallback = {
    id: null as string | null,
    venueId: null as string | null,
    gameType: 'NLHE' as GameType,
    stakes: { smallBlind: 100, bigBlind: 200 } as Stakes,
    currency: 'USD',
    buyIn: '',
    fee: '',
    cashOut: '',
    entrants: '',
    finishPosition: '',
    date: '',
    time: '',
    hours: '',
    minutes: '',
  };
  if (session === null) return fallback;

  const played = toHoursAndMinutes(durationMs(session));
  return {
    ...fallback,
    id: session.id,
    venueId: session.venueId,
    gameType: session.gameType,
    stakes: session.stakes ?? fallback.stakes,
    currency: session.currency,
    buyIn: toField(session.buyIn),
    fee: toField(session.fee),
    cashOut: toField(session.cashOut),
    entrants: session.entrants === null ? '' : String(session.entrants),
    finishPosition: session.finishPosition === null ? '' : String(session.finishPosition),
    date: formatDateInput(session.startedAt),
    time: formatTimeInput(session.startedAt),
    // A live session has no length to seed: `durationMs` would give whatever
    // the clock says right now, which is the number being corrected.
    hours: session.endedAt === null ? '' : played.hours,
    minutes: session.endedAt === null ? '' : played.minutes,
  };
};

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    marginLeft: -spacing.md,
  },
  header: {
    paddingTop: spacing.md,
  },
  subtitle: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  hint: {
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  finishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  finishInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  footer: {
    gap: spacing.sm,
  },
  missing: {
    paddingTop: spacing.xxxl,
    gap: spacing.xl,
  },
  missingAction: {
    alignSelf: 'stretch',
  },
});
