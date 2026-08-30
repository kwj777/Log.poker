/**
 * Haptics with a web fallback.
 *
 * expo-haptics has no web implementation, so calling it directly from shared UI
 * would throw in the browser. Everything here is fire-and-forget: a missing
 * buzz is never worth an error, least of all mid-session at a table.
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

const safely = (run: () => Promise<unknown>): void => {
  if (!supported) return;
  void run().catch(() => {
    // Some devices report haptics as unavailable; that is not an error worth surfacing.
  });
};

/** A tap landed — chips, toggles, card picks. */
export const tapFeedback = (): void =>
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Something meaningful happened — session started, hand saved. */
export const successFeedback = (): void =>
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** A destructive or high-stakes action — ending a session, deleting. */
export const warningFeedback = (): void =>
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
