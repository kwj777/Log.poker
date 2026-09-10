/**
 * The screen that is left when something has gone wrong.
 *
 * Two callers, which is the reason it is a component rather than markup in one
 * of them: the root layout shows it when the database will not open, and the
 * error boundary shows it when a render throws. Those are the same thing from
 * where the player is sitting -- the app is not working and they would like it
 * to -- so they say it the same way and offer the same button.
 *
 * ## It asks for nothing
 *
 * No safe area, no theme context, no store. The tree this replaces is the tree
 * that would have provided those: the boundary catches the root layout
 * throwing, and the root layout is what renders `SafeAreaProvider`. An error
 * screen that fails while reporting a failure is the one thing it must not be.
 *
 * Wrapping itself in a provider was the first attempt and is worse than it
 * looks: `SafeAreaProvider` renders **nothing** until it has measured, so the
 * screen that exists to say something would say it a frame late, and say
 * nothing at all anywhere the measurement never arrives. Centered content with
 * generous padding does not need the insets to be right.
 */

import { StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';
import { colors, spacing } from '../theme';

interface ErrorScreenProps {
  title: string;
  /** What went wrong, in whatever words are available. */
  detail: string;
  onRetry: () => void;
  retryLabel?: string;
}

export const ErrorScreen = ({
  title,
  detail,
  onRetry,
  retryLabel = 'Try again',
}: ErrorScreenProps) => (
  <View style={styles.root}>
    <Text variant="heading" center>
      {title}
    </Text>
    <Text color={colors.textSecondary} center style={styles.message}>
      {detail}
    </Text>
    <Button label={retryLabel} onPress={onRetry} style={styles.retry} />
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    // Comfortably past any inset, which is why none is measured.
    padding: spacing.xxl,
  },
  message: {
    marginTop: spacing.sm,
  },
  retry: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
});
