/**
 * The mid-session tilt check, and the one thing it offers afterwards.
 *
 * Deliberately subtle: an inline card, never a modal, never a notification, and
 * it appears at most once per session after two hours of play. The brief is
 * "subtle prompt" and the reason is behavioral -- a check-in that interrupts a
 * hand is one the player learns to dismiss, and a dismissed prompt collects no
 * data and defuses no tilt.
 *
 * ## What happens after a 4 or a 5
 *
 * A player who has just told the app they are rattled, at a table, two hours in,
 * is in the exact state Untilt exists for. So the card does not simply vanish on
 * those two scores: it offers a sixty-second reset, which is free, needs no
 * account and opens straight into the exercise.
 *
 * **The tap is recorded first and unconditionally**, and that ordering is the
 * whole safety of this. `MoodPicker`'s own header says mood data is only useful
 * if logging it costs nothing, and the moment it feels like homework players
 * stop -- so a check-in that summons something is a check-in people answer with
 * a 3 to be left alone, and the correlation the data exists for dies quietly.
 * Nothing below may gate, delay or precede `logMood`.
 *
 * **And there is nothing to sell here.** The resets reached for mid-session are
 * free across the family, by the front door's own promise, so this names no
 * price, asks for no address, and says so rather than making anybody wonder. The
 * paid material is mentioned on the variance screen next to a number, away from
 * the table, which is where that promise puts it.
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { MoodPicker } from '../../components/MoodPicker';
import { Text } from '../../components/Text';
import { wantsReset } from '../../domain/mood';
import type { MoodScore, SessionWithChildren } from '../../domain/types';
import { colors, spacing } from '../../theme';
import { useLogStore } from '../../store/useLogStore';
import { openHandOff } from '../family/hooks';
import { resetHandOff } from '../family/links';

/** How long into a session before the check-in appears. */
export const MID_SESSION_PROMPT_AFTER_MS = 2 * 60 * 60 * 1000;

interface MidSessionCheckInProps {
  session: SessionWithChildren;
  elapsedMs: number;
}

export const MidSessionCheckIn = ({ session, elapsedMs }: MidSessionCheckInProps) => {
  const moodEntries = useLogStore((state) => state.moodEntries);
  const dismissed = useLogStore((state) => state.lastMidSessionPromptAt);
  const logMood = useLogStore((state) => state.logMood);
  const dismiss = useLogStore((state) => state.dismissMidSessionPrompt);

  // What was just tapped, held locally because the store's `alreadyLogged`
  // flips true the instant it is recorded and would take the card away with it.
  // It lives for this mounting only: leave the screen and come back and the
  // offer is gone, which is right. It is a moment, not a fixture.
  const [offered, setOffered] = useState<MoodScore | null>(null);

  const alreadyLogged = moodEntries.some(
    (entry) => entry.sessionId === session.id && entry.phase === 'mid',
  );

  const record = (score: MoodScore) => {
    // First, and not conditional on anything. See the header.
    void logMood(session.id, 'mid', score);
    if (wantsReset(score)) setOffered(score);
  };

  if (offered !== null) {
    const reset = resetHandOff();
    return (
      <Card style={styles.card}>
        <Text variant="bodyStrong">Logged.</Text>
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          Untilt has a sixty-second reset for exactly this. It is free, it needs no
          account, and it is sixty seconds. Otherwise, back to the game.
        </Text>
        <View style={styles.offerRow}>
          <Button
            label={reset.label}
            variant="secondary"
            size="small"
            onPress={() => openHandOff(reset.url)}
          />
          <Button
            label="Back to the game"
            variant="ghost"
            size="small"
            onPress={() => setOffered(null)}
          />
        </View>
      </Card>
    );
  }

  if (elapsedMs < MID_SESSION_PROMPT_AFTER_MS || alreadyLogged || dismissed !== null) {
    return null;
  }

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text variant="bodyStrong">Quick check: how’s your head?</Text>
        <Button label="Not now" variant="ghost" size="small" onPress={dismiss} />
      </View>
      <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
        Two hours in. One tap, then back to the game.
      </Text>
      <MoodPicker value={null} onChange={record} compact />
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    borderColor: colors.accentDim,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  hint: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
