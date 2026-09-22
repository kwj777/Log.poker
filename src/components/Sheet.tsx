/**
 * A bottom sheet built on RN's `Modal`, which is the one overlay primitive that
 * behaves the same on iOS, Android and web. Used for the flows that must not
 * lose the screen behind them -- cash-out, rebuy -- where a full navigation push
 * would break the player's sense of "I am still in this session".
 */

import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, radius, spacing } from '../theme';
import { focusHost, focusedIn, returnFocusTo, type Focusable } from './returnFocus';
import { Text } from './Text';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export const Sheet = ({ visible, onClose, title, children }: SheetProps) => {
  const insets = useSafeAreaInsets();

  // Read while rendering, on purpose, and this is the half of the fix that is
  // easy to undo by tidying.
  //
  // The modal's subtree mounts in the same commit that flips `visible`, and
  // effects run children first, so by the time any effect of this component
  // runs the sheet's `autoFocus` field already has the keyboard. Render is the
  // last moment at which the opener is still the focused element -- and
  // missing it is exactly what react-native-web's own focus trap does, which
  // is why closing a sheet leaves focus on `document.body`. See `returnFocus`.
  //
  // As state adjusted during render rather than a ref, which is the shape
  // React documents for "a prop changed and this has to change with it": the
  // re-render it schedules happens before the children are committed, so the
  // read still lands before the field can take the focus. The document is read
  // and nothing is written, so a double render costs a second look and no
  // more.
  const [shown, setShown] = useState(visible);
  const [opener, setOpener] = useState<Focusable | null>(null);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setOpener(focusedIn(focusHost()));
  }

  // `onRequestClose` covers the Android back button but not the web's Escape
  // key, which is what a browser user reaches for first.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      // After the sheet has animated out, rather than when `visible` turned
      // false: while the trap is still mounted it holds a capture-phase focus
      // listener that pulls the keyboard straight back inside. `onDismiss`
      // fires from the commit that unmounts it, so by then there is nothing
      // left to argue with. It is iOS-only on native, where `opener` is null
      // because there was no document to read one from.
      onDismiss={() => returnFocusTo(opener, focusHost())}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrapper}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
            <View style={styles.grabber} />
            <Text variant="heading" style={styles.title}>
              {title}
            </Text>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  sheetWrapper: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  title: {
    marginBottom: spacing.lg,
  },
});
