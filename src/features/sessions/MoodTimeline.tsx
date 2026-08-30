/**
 * How a session felt, start to finish.
 *
 * The whole value of the mood data is the comparison between the ends — walking
 * in calm and leaving rattled is the pattern worth seeing — so the start and end
 * scores are shown side by side with the delta named in words.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { MOOD_LABELS } from '../../components/MoodPicker';
import type { MoodEntry, MoodPhase } from '../../domain/types';
import { colors, moodColor, radius, spacing } from '../../theme';

const PHASE_LABELS: Record<MoodPhase, string> = {
  start: 'Sat down',
  mid: 'Mid-session',
  end: 'Cashed out',
};

const PHASE_ORDER: MoodPhase[] = ['start', 'mid', 'end'];

interface MoodTimelineProps {
  entries: readonly MoodEntry[];
}

export const MoodTimeline = ({ entries }: MoodTimelineProps) => {
  // Keep the latest entry per phase: a player can re-tap a check-in, and the
  // most recent answer is the one they meant.
  const latest = new Map<MoodPhase, MoodEntry>();
  for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
    latest.set(entry.phase, entry);
  }

  const present = PHASE_ORDER.filter((phase) => latest.has(phase));
  if (present.length === 0) return null;

  const start = latest.get('start');
  const end = latest.get('end');
  const swing = start && end ? end.score - start.score : null;

  return (
    <View>
      <View style={styles.row}>
        {present.map((phase) => {
          const entry = latest.get(phase)!;
          return (
            <View key={phase} style={styles.item}>
              <View style={[styles.dot, { backgroundColor: moodColor(entry.score) }]}>
                <Text variant="bodyStrong" color={colors.accentText}>
                  {entry.score}
                </Text>
              </View>
              <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
                {PHASE_LABELS[phase]}
              </Text>
              <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                {MOOD_LABELS[entry.score]}
              </Text>
            </View>
          );
        })}
      </View>

      {swing !== null && swing !== 0 ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.swing}>
          {swing > 0
            ? `You left ${swing} step${swing === 1 ? '' : 's'} more rattled than you arrived.`
            : `You left ${-swing} step${swing === -1 ? '' : 's'} calmer than you arrived.`}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swing: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
