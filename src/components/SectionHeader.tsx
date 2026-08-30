import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme';
import { Overline } from './Text';

interface SectionHeaderProps {
  title: string;
  /** Right-aligned control — a filter, a "see all", a toggle. */
  action?: ReactNode;
}

export const SectionHeader = ({ title, action }: SectionHeaderProps) => (
  <View style={styles.row}>
    <Overline>{title}</Overline>
    {action}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
});
