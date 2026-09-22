/**
 * The page frame every screen sits in.
 *
 * On phones it is an edge-to-edge safe-area view. On desktop web the content is
 * capped at phone width and centered -- Log is a one-handed app, and a 1400px-wide
 * session form would be a different (worse) product.
 *
 * ## Why the frame gets out of the keyboard's way
 *
 * The footer is the primary action on almost every screen that has one, and it
 * sits in normal flow at the bottom of the frame. On iOS the keyboard is drawn
 * over the app rather than shrinking it, so "Save hand" sat underneath the
 * keyboard the moment somebody tapped the note field -- on the one screen this
 * app exists to make take fifteen seconds. The same held for the buy-in on
 * "New session" and the paste box on Import.
 *
 * Invisible on web, where the browser resizes the viewport itself, and on
 * Android, where `adjustResize` does: `behavior` is undefined on both and
 * `KeyboardAvoidingView` then does nothing. So this is an iOS fix that costs
 * the other two platforms one wrapper view.
 *
 * `Sheet` has done this since it was written. This is the same thing, on the
 * frame the rest of the app uses.
 *
 * ## Why that was only half of it
 *
 * Lifting the footer does not move the field being typed into. `padding`
 * shrinks the frame, so the scroll area gets shorter and whatever was near the
 * bottom of it is simply below the fold, with nothing scrolling it back. The
 * hand note is the case that found this: tap it, and the line you are typing is
 * under the keyboard until you dismiss the keyboard to read it.
 *
 * `automaticallyAdjustKeyboardInsets` is the other half and is what scrolls the
 * focused field into view. It is iOS only and it measures the keyboard's
 * overlap with the scroll view's own frame rather than taking the keyboard's
 * height, so it does not fight the wrapper above it: by the time it is asked,
 * that frame has already been lifted clear and there is no overlap left to
 * inset for. What remains is the part that was missing.
 */

import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '../theme';
import { useHasTabBar } from './TabBar';

interface ScreenProps {
  children: ReactNode;
  /** Set false for screens that manage their own scrolling (e.g. a FlatList). */
  scroll?: boolean;
  /** Pinned to the bottom, outside the scroll area -- primary actions live here. */
  footer?: ReactNode;
  contentStyle?: ViewStyle;
}

export const Screen = ({ children, scroll = true, footer, contentStyle }: ScreenProps) => {
  const insets = useSafeAreaInsets();
  // **The top inset is this component's job and nothing else's.** Every route
  // is drawn with `headerShown: false`, so there is no navigation bar above any
  // of this to hold the status bar off, and the first element a screen renders
  // starts at the very top of the window. On web that is invisible: a browser
  // tab reports a zero top inset, and a browser is the only place this app had
  // ever run. On a phone it put the Back control under the clock, drawn half
  // occluded and not tappable at all, which is how this fails -- not a crash,
  // a control that is simply gone.
  //
  // Padded on the root rather than inside the scroll, so nothing slides under
  // the status bar on its way past. The background fills the inset either way.
  // The tab bar sits in normal flow below this screen and already absorbs the
  // bottom safe-area inset, so adding it here too would double the gap.
  const bottomInset = useHasTabBar() ? spacing.md : Math.max(insets.bottom, spacing.lg);
  const footerInset = footer ? 0 : bottomInset;

  const body = <View style={[styles.column, contentStyle]}>{children}</View>;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        {scroll ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: spacing.xxl + footerInset },
            ]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        ) : (
          <View style={styles.scroll}>{body}</View>
        )}

        {footer ? (
          <View style={[styles.footer, { paddingBottom: bottomInset }]}>
            <View style={styles.column}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    width: '100%',
    // `alignSelf: center` plus a max width is what produces the centered column
    // on desktop web while staying full-bleed on a phone.
    alignSelf: 'center',
    maxWidth: layout.maxContentWidth,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  column: {
    paddingHorizontal: spacing.lg,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: spacing.md,
  },
});
