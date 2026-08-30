import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../theme';
import { Text } from './Text';

interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

export const EmptyState = ({ title, body, action }: EmptyStateProps) => (
  <View style={styles.root}>
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
