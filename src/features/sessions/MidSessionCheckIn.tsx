/**
 * The mid-session tilt check.
 *
 * Deliberately subtle: an inline card, never a modal, never a notification, and
 * it appears at most once per session after two hours of play. The brief is
 * "subtle prompt" and the reason is behavioural — a check-in that interrupts a
 * hand is one the player learns to dismiss, and a dismissed prompt collects no
 * data and defuses no tilt.
 */

import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { MoodPicker } from '../../components/MoodPicker';
import { Text } from '../../components/Text';
import type { MoodScore, SessionWithChildren } from '../../domain/types';
import { colors, spacing } from '../../theme';
import { useLogStore } from '../../store/useLogStore';

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

  const alreadyLogged = moodEntries.some(
    (entry) => entry.sessionId === session.id && entry.phase === 'mid',
  );

  if (elapsedMs < MID_SESSION_PROMPT_AFTER_MS || alreadyLogged || dismissed !== null) {
    return null;
  }

  const record = (score: MoodScore) => {
    void logMood(session.id, 'mid', score);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text variant="bodyStrong">Quick check — how’s your head?</Text>
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
});
