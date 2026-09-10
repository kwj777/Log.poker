/**
 * One action did not work, said where the action was.
 *
 * `ErrorScreen` is for the app failing; this is for a write failing. The
 * difference matters: nothing is broken, the screen is fine, and the only thing
 * the player needs is to be told that the thing they just tapped did not
 * happen.
 *
 * ## Why it exists
 *
 * Three screens used to say nothing at all. Logging a hand, starting a session
 * and cashing out each stopped their spinner and left the screen exactly as it
 * was, which is what success looks like from a foot away -- so a write that
 * failed read as a write that worked, and the record was quietly not there. The
 * import screen and Settings already said something; this is that, extracted,
 * so the other three can say it the same way.
 *
 * Announced rather than only drawn. A message that appears silently under a
 * button is a message somebody using a screen reader taps past: `alert` gets it
 * read on iOS, `accessibilityLiveRegion` on Android.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors, radius, spacing } from '../theme';

interface ErrorNoteProps {
  /** What went wrong, in whatever words are available. Null renders nothing. */
  message: string | null;
}

export const ErrorNote = ({ message }: ErrorNoteProps) => {
  if (message === null) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.note}
    >
      <Text color={colors.loss}>{message}</Text>
    </View>
  );
};

/** What to show when the thing that threw had nothing readable to say. */
export const describeFailure = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message !== '' ? error.message : fallback;

const styles = StyleSheet.create({
  note: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.loss,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
});
