/**
 * The page frame every screen sits in.
 *
 * On phones it is an edge-to-edge safe-area view. On desktop web the content is
 * capped at phone width and centred — Log is a one-handed app, and a 1400px-wide
 * session form would be a different (worse) product.
 */

import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '../theme';
import { useHasTabBar } from './TabBar';

interface ScreenProps {
  children: ReactNode;
  /** Set false for screens that manage their own scrolling (e.g. a FlatList). */
  scroll?: boolean;
  /** Pinned to the bottom, outside the scroll area — primary actions live here. */
  footer?: ReactNode;
  contentStyle?: ViewStyle;
}

export const Screen = ({ children, scroll = true, footer, contentStyle }: ScreenProps) => {
  const insets = useSafeAreaInsets();
  // The tab bar sits in normal flow below this screen and already absorbs the
  // bottom safe-area inset, so adding it here too would double the gap.
  const bottomInset = useHasTabBar() ? spacing.md : Math.max(insets.bottom, spacing.lg);
  const footerInset = footer ? 0 : bottomInset;

  const body = <View style={[styles.column, contentStyle]}>{children}</View>;

  return (
    <View style={styles.root}>
      <View style={styles.centre}>
        {scroll ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: spacing.xxl + footerInset },
            ]}
            keyboardShouldPersistTaps="handled"
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
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centre: {
    flex: 1,
    width: '100%',
    // `alignSelf: center` plus a max width is what produces the centred column
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
