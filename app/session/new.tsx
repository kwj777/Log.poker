/**
 * Start a session.
 *
 * Everything on this screen is pre-filled from the player's last session, so the
 * common path is: open, glance, Start. The primary button carries the full
 * summary of what is about to be logged, which is what makes tapping it without
 * reading the rest of the screen safe.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
import { Chip, ChipGroup } from '../../src/components/Chip';
import { MoodPicker } from '../../src/components/MoodPicker';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Text } from '../../src/components/Text';
import { successFeedback } from '../../src/components/haptics';
import {
  CURRENCIES,
  currencyLabel,
  formatEntry,
  formatMoney,
  formatStakes,
  parseAmount,
} from '../../src/domain/money';
import {
  GAME_TYPES,
  SESSION_FORMATS,
  SESSION_FORMAT_LABELS,
  type GameType,
  type MoodScore,
  type SessionFormat,
  type Stakes,
} from '../../src/domain/types';
import { PreSessionWarmUp } from '../../src/features/sessions/PreSessionWarmUp';
import { StakesPicker } from '../../src/features/sessions/StakesPicker';
import { VenuePicker } from '../../src/features/sessions/VenuePicker';
import {
  ENTRY_PRESETS,
  buyInPresets,
  deriveDefaults,
} from '../../src/features/sessions/defaults';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

const GAME_OPTIONS = GAME_TYPES.map((value) => ({
  value,
  label: value === 'OTHER' ? 'Other' : value,
}));

const FORMAT_OPTIONS = SESSION_FORMATS.map((value) => ({
  value,
  label: SESSION_FORMAT_LABELS[value],
}));

const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: currencyLabel(value) }));

export default function NewSessionScreen() {
  const venues = useLogStore((state) => state.venues);
  const sessions = useLogStore((state) => state.sessions);
  const createVenue = useLogStore((state) => state.createVenue);
  const startSession = useLogStore((state) => state.startSession);

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
  const [mood, setMood] = useState<MoodScore | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const tournament = format === 'tournament';
  const buyInCents = parseAmount(buyIn);
  // A freeroll is a real thing, so an empty or unreadable fee is zero rather
  // than a reason the button will not press.
  const feeCents = tournament ? (parseAmount(fee) ?? 0) : 0;
  const canStart = venueId !== null && buyInCents !== null && buyInCents > 0 && !starting;

  const start = async () => {
    if (!canStart || venueId === null || buyInCents === null) return;
    setStarting(true);
    try {
      await startSession({
        venueId,
        format,
        gameType,
        // A tournament has no blinds; `buildSession` drops them anyway, but
        // sending them would be sending something the screen never asked for.
        stakes: tournament ? null : stakes,
        currency,
        buyIn: buyInCents,
        fee: tournament ? feeCents : null,
        mood,
      });
      successFeedback();
      // Replace rather than push: backing out of a live session into the "start
      // a session" screen would be a dead end.
      router.replace('/session/active');
    } catch (error) {
      // Told, rather than left on a screen that has not moved. A session that
      // failed to start and one that is starting look identical otherwise.
      setFailed(describeFailure(error, 'That session could not be started.'));
      setStarting(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label={
              !canStart
                ? 'Start session'
                : tournament
                  ? `Start ${formatEntry(buyInCents ?? 0, feeCents, currency)}`
                  : `Start ${formatStakes(stakes, currency)} · ${formatMoney(buyInCents ?? 0, {
                      currency,
                    })}`
            }
            onPress={() => void start()}
            disabled={!canStart}
            loading={starting}
            accessibilityHint="Begins timing the session and records your buy-in"
          />
          <Button label="Cancel" variant="ghost" size="medium" onPress={() => router.back()} />
        </View>
      }
    >
      <PageMeta title="New session · Log" />
      <View style={styles.header}>
        <Text variant="title">New session</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          Everything below is set to your last session. Change what’s different, then start.
        </Text>
      </View>

      <SectionHeader title="Where" />
      <VenuePicker
        venues={venues}
        value={venueId}
        onChange={setVenueId}
        onCreate={createVenue}
      />

      <SectionHeader title="Format" />
      <ChipGroup options={FORMAT_OPTIONS} value={format} onChange={setFormat} />

      <SectionHeader title="Game" />
      <ChipGroup options={GAME_OPTIONS} value={gameType} onChange={setGameType} />

      {/*
        Set once and then carried by `deriveDefaults`, like everything else on
        this screen: a player picks their currency on their first session and
        never thinks about it again, and one who flies somewhere to play can
        change it for that trip and change it back.

        Here rather than in Settings because this is where the money on this
        session is decided, and because a setting somewhere else would be a
        second source of truth for a field that already lives on the record.
        Every price on this screen redraws when it moves, so the choice is
        visible rather than filed away.
      */}
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
          <Text variant="caption" color={colors.textTertiary} style={styles.moodHint}>
            The rake, kept apart from the buy-in so a year of it can be totaled. Leave it at
            zero for a freeroll. Where you finish is asked for at the end.
          </Text>
        </>
      ) : (
        <>
          <SectionHeader title="Stakes" />
          <StakesPicker value={stakes} onChange={setStakes} currency={currency} />

          <SectionHeader title="Buy-in" />
          <AmountInput
            value={buyIn}
            onChangeText={setBuyIn}
            currency={currency}
            presets={buyInPresets(stakes)}
            accessibilityLabel="Buy-in amount"
          />
        </>
      )}

      <SectionHeader title="How are you feeling? (optional)" />
      <MoodPicker value={mood} onChange={setMood} />
      <Text variant="caption" color={colors.textTertiary} style={styles.moodHint}>
        Logged alongside your result. Skip it. It’s never required.
      </Text>

      {/*
        Below the picker and above nothing that matters. It draws only on a 4
        or a 5, it has no dismiss control, and Start is in the footer where
        this cannot reach it -- see the header over there for why an offer on
        this screen must never make one score costlier to tap than another.
      */}
      <PreSessionWarmUp mood={mood} />

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
  moodHint: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  entryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  footer: {
    gap: spacing.sm,
  },
});
