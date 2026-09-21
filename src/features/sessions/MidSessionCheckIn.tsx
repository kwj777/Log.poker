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
import { ErrorNote, describeFailure } from '../../components/ErrorNote';
import { MoodPicker } from '../../components/MoodPicker';
import { Text } from '../../components/Text';
import { wantsReset } from '../../domain/mood';
import type { MoodScore, SessionWithChildren } from '../../domain/types';
import { colors, spacing } from '../../theme';
import { useLogStore } from '../../store/useLogStore';
import { openLink } from '../family/hooks';
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

  /**
   * What the write said, when it did not work.
   *
   * The card that comes next opens with the word "Logged.", and this was the
   * one mood write in the app with neither a catch nor anywhere to say so:
   * every other one reports through `ErrorNote` and is pinned in
   * `writeFailures.test.tsx`. A quota or a full disk left the rejection
   * unhandled and the card asserting a check-in that is not in the log, which
   * the end-of-session summary then quietly disagrees with.
   */
  const [failed, setFailed] = useState<string | null>(null);

  const record = (score: MoodScore) => {
    setFailed(null);
    // First, and not conditional on anything. See the header. The offer is
    // about the player's head rather than about the write, so a failure says
    // so beside it instead of holding it back.
    void logMood(session.id, 'mid', score).catch((error: unknown) => {
      setFailed(describeFailure(error, 'That check-in could not be saved.'));
    });
    if (wantsReset(score)) setOffered(score);
  };

  if (offered !== null) {
    const reset = resetHandOff();
    return (
      <Card style={styles.card}>
        <Text variant="bodyStrong">{failed === null ? 'Logged.' : 'Not logged.'}</Text>
        <ErrorNote message={failed} />
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          Untilt has a sixty-second reset for exactly this. It is free, it needs no
          account, and it is sixty seconds. Otherwise, back to the game.
        </Text>
        <View style={styles.offerRow}>
          <Button
            label={reset.label}
            variant="secondary"
            size="small"
            onPress={() => openLink(reset.url)}
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

  // A failure keeps the card up even once the moment for it has passed, so a
  // score that wanted no reset has somewhere to report one: without this the
  // card simply vanished and the write was lost in silence.
  if (
    failed === null &&
    (elapsedMs < MID_SESSION_PROMPT_AFTER_MS || alreadyLogged || dismissed !== null)
  ) {
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
      <ErrorNote message={failed} />
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
