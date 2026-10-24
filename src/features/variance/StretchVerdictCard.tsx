/**
 * The verdict card: a headline and a paragraph, in the one color the verdict
 * has earned.
 *
 * Two screens render it. On the Variance tab it is the page's answer and sits
 * under the page's own subtitle, so it is not a tap target: there is nowhere
 * for it to go. On the dashboard it is a summary, so it opens the tab that
 * shows the working.
 *
 * ## It renders nothing when there is nothing honest to say
 *
 * `insufficient_data` is the ordinary state for a new player, and the Variance
 * tab answers it properly: an empty state, a card explaining why a sample is
 * needed, and a link to the guide. That explanation belongs on the page whose
 * job it is. A dashboard that opened with "not enough data yet" would be
 * spending the app's most valuable line on an apology, so the caller that has
 * somewhere else to put the explanation passes `hideWhenUnreadable`.
 *
 * The same shape as `ReviewFlagged`, which the dashboard already renders
 * directly below this and which draws nothing in the ordinary case.
 */

import { StyleSheet, type ViewStyle } from 'react-native';

import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import type { StretchAssessment } from '../../domain/variance';
import { colors, spacing } from '../../theme';
import { VERDICT_COLORS } from './recentStretch';

interface StretchVerdictCardProps {
  assessment: StretchAssessment;
  /** What a tap does. Omitted on the Variance tab, which is where a tap would go. */
  onPress?: () => void;
  /** Draw nothing at all when the verdict is `insufficient_data`. */
  hideWhenUnreadable?: boolean;
  style?: ViewStyle;
}

export const StretchVerdictCard = ({
  assessment,
  onPress,
  hideWhenUnreadable = false,
  style,
}: StretchVerdictCardProps) => {
  if (hideWhenUnreadable && assessment.verdict === 'insufficient_data') return null;

  return (
    <Card
      style={[styles.card, style]}
      onPress={onPress}
      // The headline alone. The body repeats it at length, and a tap target
      // read out as two paragraphs is one nobody waits through.
      accessibilityLabel={onPress ? `${assessment.headline}. See the detail.` : undefined}
    >
      <Text variant="heading" color={VERDICT_COLORS[assessment.verdict]}>
        {assessment.headline}
      </Text>
      <Text color={colors.textSecondary} style={styles.body}>
        {assessment.body}
      </Text>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    borderColor: colors.accentDim,
  },
  body: {
    marginTop: spacing.sm,
    lineHeight: 23,
  },
});
