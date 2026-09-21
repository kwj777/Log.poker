/**
 * Log a session that was already played.
 *
 * ## Why this screen exists
 *
 * A session could only ever begin now. `startSession` has taken a `startedAt`
 * since it was written, documented as the hook for "back-filling a session
 * logged after the fact", and nothing in the app ever passed one -- so the
 * only way into the log was to be holding the phone at the table when you sat
 * down. Anybody who forgot, or whose battery died, or who played the weekend
 * before installing the app, had two options: the CSV importer, which wants a
 * file they do not have, or nothing.
 *
 * That is a hole in the app's own promise. Log exists to tell a player what
 * their hourly rate and their variance really are, and both of those are
 * computed over the sessions in the log. A log missing every night somebody
 * forgot to start the timer is not a smaller sample of the truth; it is a
 * biased one, because the nights that get forgotten are not a random half.
 *
 * ## One write
 *
 * A live session is two writes hours apart, which is correct: it is created
 * when play starts and finished when the player racks up. This one is a single
 * form submitted once, so it is a single `createSession` carrying the result
 * already on it -- see `logPastSession`. Starting it and then ending it would
 * open a window where the second write failing leaves a session running that
 * nobody is playing.
 *
 * ## The length, rather than the end time
 *
 * Same as `edit.tsx`, and for the same reason: a player remembers that they
 * played about four hours, not the minute they stood up. The finish time is
 * derived and shown underneath so the arithmetic is on screen.
 *
 * ## No mood
 *
 * The pre-session score is asked at the table because it is about how somebody
 * feels right then. A score remembered a week later is a different measurement
 * wearing the same name, and it would be averaged in with the honest ones.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { Chip, ChipGroup } from '../../src/components/Chip';
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Text } from '../../src/components/Text';
import { successFeedback } from '../../src/components/haptics';
import {
  formatDateInput,
  fromHoursAndMinutes,
  isAhead,
  parseDateTime,
} from '../../src/domain/clock';
import { parseCount } from '../../src/domain/import/values';
import {
  CURRENCIES,
  currencyLabel,
  formatEntry,
  formatMoney,
  parseAmount,
} from '../../src/domain/money';
import {
  GAME_TYPES,
  GAME_TYPE_LABELS,
  SESSION_FORMATS,
  SESSION_FORMAT_LABELS,
  type GameType,
  type SessionFormat,
  type Stakes,
} from '../../src/domain/types';
import { StakesPicker } from '../../src/features/sessions/StakesPicker';
import { VenuePicker } from '../../src/features/sessions/VenuePicker';
import { DurationInput, StartedAtInput } from '../../src/features/sessions/WhenInput';
import {
  ENTRY_PRESETS,
  buyInPresets,
  deriveDefaults,
} from '../../src/features/sessions/defaults';
import { formatSessionDate, formatTimeOfDay } from '../../src/features/sessions/format';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, radius, spacing, typography } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

const GAME_OPTIONS = GAME_TYPES.map((value) => ({ value, label: GAME_TYPE_LABELS[value] }));

const FORMAT_OPTIONS = SESSION_FORMATS.map((value) => ({
  value,
  label: SESSION_FORMAT_LABELS[value],
}));

const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: currencyLabel(value) }));

export default function PastSessionScreen() {
  const venues = useLogStore((state) => state.venues);
  const sessions = useLogStore((state) => state.sessions);
  const createVenue = useLogStore((state) => state.createVenue);
  const logPastSession = useLogStore((state) => state.logPastSession);

  const defaults = useMemo(() => deriveDefaults(sessions), [sessions]);

  const [venueId, setVenueId] = useState<string | null>(
    defaults.venueId ?? venues[0]?.id ?? null,
  );
  const [format, setFormat] = useState<SessionFormat>(defaults.format);
  const [gameType, setGameType] = useState<GameType>(defaults.gameType);
  const [stakes, setStakes] = useState<Stakes>(defaults.stakes);
  const [currency, setCurrency] = useState(defaults.currency);
  const [buyIn, setBuyIn] = useState(String(defaults.buyIn / 100));
  const [fee, setFee] = useState(String(defaults.fee / 100));
  const [cashOut, setCashOut] = useState('');
  const [entrants, setEntrants] = useState('');
  const [finishPosition, setFinishPosition] = useState('');
  // Today, because the session being back-filled is usually last night or the
  // one before. The time is left empty: there is no hour to guess at, and a
  // guessed one would be saved by somebody who did not look.
  const [date, setDate] = useState(() => formatDateInput(Date.now()));
  const [time, setTime] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tournament = format === 'tournament';
  const buyInCents = parseAmount(buyIn);
  const feeCents = tournament ? (parseAmount(fee) ?? 0) : 0;
  const cashOutCents = parseAmount(cashOut);
  const startedAt = parseDateTime(date, time);
  const length = fromHoursAndMinutes(hours, minutes);

  /**
   * Said only once there is something to be wrong about.
   *
   * A form that opens complaining about the fields it has not been given yet
   * is a form that reads as broken before it has been touched. Both of these
   * still gate the save whether or not they are being said.
   */
  const startInvalid = date.trim() !== '' && time.trim() !== '' && startedAt === null;
  const lengthInvalid = (hours.trim() !== '' || minutes.trim() !== '') && length === null;

  const endedAt = startedAt !== null && length !== null ? startedAt + length : null;

  /**
   * A session that has not happened yet is a typo, and an expensive one.
   *
   * Both ends are checked because they fail differently. A start in the future
   * is a mistyped year, which is the classic. An end in the future with a
   * sound start is a mistyped length -- 40 hours for 4 -- and that one is
   * invisible on the start field.
   */
  const startAhead = startedAt !== null && isAhead(startedAt);
  const endAhead = !startAhead && endedAt !== null && isAhead(endedAt);

  const startHint = startAhead
    ? 'That is in the future. Check the year.'
    : undefined;
  const lengthHint = lengthInvalid
    ? 'How long did you play? Hours and minutes.'
    : endAhead
      ? 'That length runs past now. Check the hours.'
      : endedAt === null
        ? 'How long you played.'
        : `Finishing ${formatSessionDate(endedAt)} at ${formatTimeOfDay(endedAt)}.`;

  const canSave =
    venueId !== null &&
    startedAt !== null &&
    length !== null &&
    length > 0 &&
    !startAhead &&
    !endAhead &&
    buyInCents !== null &&
    buyInCents > 0 &&
    cashOutCents !== null &&
    !saving;

  const net =
    buyInCents === null || cashOutCents === null ? null : cashOutCents - buyInCents - feeCents;

  const save = async () => {
    if (
      !canSave ||
      venueId === null ||
      startedAt === null ||
      length === null ||
      buyInCents === null ||
      cashOutCents === null
    ) {
      return;
    }
    setSaving(true);
    setFailed(null);
    try {
      await logPastSession({
        venueId,
        format,
        gameType,
        stakes: tournament ? null : stakes,
        currency,
        buyIn: buyInCents,
        fee: tournament ? feeCents : null,
        startedAt,
        endedAt: startedAt + length,
        cashOut: cashOutCents,
        ...(tournament
          ? { entrants: parseCount(entrants), finishPosition: parseCount(finishPosition) }
          : {}),
      });
      successFeedback();
      // Back rather than to the new session: this one is over, and the player
      // is where they were -- on the dashboard or in History, both of which
      // now carry it.
      router.back();
    } catch (error) {
      setFailed(describeFailure(error, 'That session could not be saved.'));
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label={
              net === null ? 'Add session' : `Add session · ${formatMoney(net, { currency, signed: true })}`
            }
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
            accessibilityHint="Saves a finished session with the result you entered"
          />
          <Button label="Cancel" variant="ghost" size="medium" onPress={() => router.back()} />
        </View>
      }
    >
      <PageMeta title="Add a past session · Log" />
      <View style={styles.header}>
        <Text variant="title">Add a past session</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          A night you played before you logged it. It counts toward your hourly rate and your
          variance exactly like the ones you timed.
        </Text>
      </View>

      <SectionHeader title="Where" />
      <VenuePicker venues={venues} value={venueId} onChange={setVenueId} onCreate={createVenue} />

      <SectionHeader title="Format" />
      <ChipGroup options={FORMAT_OPTIONS} value={format} onChange={setFormat} />

      <SectionHeader title="Game" />
      <ChipGroup options={GAME_OPTIONS} value={gameType} onChange={setGameType} />

      <SectionHeader title="Currency" />
      <ChipGroup options={CURRENCY_OPTIONS} value={currency} onChange={setCurrency} scroll />

      {tournament ? (
        <>
          <SectionHeader title="Entry" />
          <View style={styles.entryChips}>
            {ENTRY_PRESETS.map((preset) => (
              <Chip
                key={preset.buyIn}
                label={formatEntry(preset.buyIn, preset.fee, currency)}
                selected={buyInCents === preset.buyIn && feeCents === preset.fee}
                onPress={() => {
                  setBuyIn(String(preset.buyIn / 100));
                  setFee(String(preset.fee / 100));
                }}
              />
            ))}
          </View>
          <AmountInput
            value={buyIn}
            onChangeText={setBuyIn}
            currency={currency}
            accessibilityLabel="Tournament buy-in"
          />
          <SectionHeader title="Entry fee" />
          <AmountInput
            value={fee}
            onChangeText={setFee}
            currency={currency}
            accessibilityLabel="Tournament entry fee"
          />
        </>
      ) : (
        <>
          <SectionHeader title="Stakes" />
          <StakesPicker value={stakes} onChange={setStakes} currency={currency} />

          <SectionHeader title="Bought in for" />
          <AmountInput
            value={buyIn}
            onChangeText={setBuyIn}
            currency={currency}
            presets={buyInPresets(stakes)}
            accessibilityLabel="Buy-in amount"
          />
          <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
            Everything you put on the table that night, rebuys included. A past session has no
            rebuys of its own to log.
          </Text>
        </>
      )}

      <SectionHeader title="Started" />
      <StartedAtInput
        date={date}
        time={time}
        onChangeDate={setDate}
        onChangeTime={setTime}
        invalid={startInvalid || startAhead}
        hint={startHint}
      />

      <SectionHeader title="Played for" />
      <DurationInput
        hours={hours}
        minutes={minutes}
        onChangeHours={setHours}
        onChangeMinutes={setMinutes}
        hint={lengthHint}
        invalid={lengthInvalid || endAhead}
      />

      <SectionHeader title={tournament ? 'Prize' : 'Cashed out'} />
      <AmountInput
        value={cashOut}
        onChangeText={setCashOut}
        currency={currency}
        accessibilityLabel={tournament ? 'Prize won' : 'Cash-out amount'}
      />
      <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
        {tournament
          ? 'Zero if you busted, which is most of them.'
          : 'What you took off the table. Zero if you lost the lot.'}
      </Text>

      {tournament ? (
        <>
          <SectionHeader title="Where you finished (optional)" />
          <View style={styles.finishRow}>
            <TextInput
              value={finishPosition}
              onChangeText={setFinishPosition}
              placeholder="Place"
              placeholderTextColor={colors.textTertiary}
              inputMode="numeric"
              accessibilityLabel="Finishing position"
              style={styles.finishInput}
            />
            <Text color={colors.textTertiary}>of</Text>
            <TextInput
              value={entrants}
              onChangeText={setEntrants}
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

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
  },
  subtitle: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  hint: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  entryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
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
});
