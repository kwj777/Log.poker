import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { colors, spacing } from '../theme';
import { Text } from './Text';

/**
 * The family mark, per BRAND.md, which asks that app icons, favicons and empty
 * states all derive from the same geometry.
 *
 * It is the PNG the icon generator writes rather than a drawn component, and
 * that is the point: rendering it with `Image` needs no SVG dependency, and the
 * mark on an empty screen is the same bytes as the mark on the home screen
 * rather than a second drawing free to drift from it. Regenerate with
 * `node scripts/generate-icons.mjs`.
 */
const MARK = require('../../assets/mark.png');

interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

export const EmptyState = ({ title, body, action }: EmptyStateProps) => (
  <View style={styles.root}>
    {/* Held back deliberately. An empty screen is a place somebody arrived
        expecting content, so the mark is a watermark behind the sentence that
        explains it rather than the thing they have to look at first. */}
    <Image source={MARK} style={styles.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
    <Text variant="heading" centre>
      {title}
    </Text>
    <Text color={colors.textSecondary} centre style={styles.body}>
      {body}
    </Text>
    {action ? <View style={styles.action}>{action}</View> : null}
  </View>
);

const styles = StyleSheet.create({
  mark: {
    width: 76,
    height: 76,
    opacity: 0.45,
    marginBottom: spacing.xs,
  },
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
  },
  body: {
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
});
