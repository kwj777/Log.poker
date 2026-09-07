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
import { Chip, ChipGroup } from '../../src/components/Chip';
import { MoodPicker } from '../../src/components/MoodPicker';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Text } from '../../src/components/Text';
import { successFeedback } from '../../src/components/haptics';
import { formatEntry, formatMoney, formatStakes, parseAmount } from '../../src/domain/money';
import {
  GAME_TYPES,
  SESSION_FORMATS,
  SESSION_FORMAT_LABELS,
  type GameType,
  type MoodScore,
  type SessionFormat,
  type Stakes,
} from '../../src/domain/types';
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
  const [buyIn, setBuyIn] = useState(String(defaults.buyIn / 100));
  const [fee, setFee] = useState(String(defaults.fee / 100));
  const [mood, setMood] = useState<MoodScore | null>(null);
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
        currency: defaults.currency,
        buyIn: buyInCents,
        fee: tournament ? feeCents : null,
        mood,
      });
      successFeedback();
      // Replace rather than push: backing out of a live session into the "start
      // a session" screen would be a dead end.
      router.replace('/session/active');
    } catch {
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
                  ? `Start ${formatEntry(buyInCents ?? 0, feeCents, defaults.currency)}`
                  : `Start ${formatStakes(stakes, defaults.currency)} · ${formatMoney(
                      buyInCents ?? 0,
                      { currency: defaults.currency },
                    )}`
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

      {tournament ? (
        <>
          <SectionHeader title="Entry" />
          <View style={styles.entryChips}>
            {ENTRY_PRESETS.map((preset) => (
              <Chip
                key={preset.buyIn}
                label={formatEntry(preset.buyIn, preset.fee, defaults.currency)}
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
            currency={defaults.currency}
            accessibilityLabel="Tournament buy-in"
          />
          <SectionHeader title="Entry fee" />
          <AmountInput
            value={fee}
            onChangeText={setFee}
            currency={defaults.currency}
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
          <StakesPicker value={stakes} onChange={setStakes} />

          <SectionHeader title="Buy-in" />
          <AmountInput
            value={buyIn}
            onChangeText={setBuyIn}
            currency={defaults.currency}
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
