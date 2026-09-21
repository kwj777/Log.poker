/**
 * One logged hand, as it appears in a session.
 *
 * Cards first and largest -- that is what a player scans for when looking back
 * at a night. The note is truncated to one line here; the full text lives in
 * the hand itself.
 *
 * ## The row opens the hand
 *
 * `onPress` was on this component's props from the start, and set an
 * `accessibilityRole` of "button" when given -- but no caller passed it, and
 * nothing here was pressable anyway, so the prop was a plan rather than a
 * feature. A hand logged with the wrong cards stayed wrong, because the row
 * showing it was the only place anybody would think to tap and it did nothing.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '../../components/Text';
import { formatMoney } from '../../domain/money';
import { formatNotation } from '../../domain/handNotation';
import { HAND_TAG_LABELS, type Hand } from '../../domain/types';
import { openLink } from '../family/hooks';
import { drillHandOff } from '../family/links';
import { colors, radius, resultColor, spacing, typography } from '../../theme';

interface HandRowProps {
  hand: Hand;
  /** Opens the hand. A row without one is a record rather than a control. */
  onPress?: () => void;
  currency?: string;
  /**
   * Shows the TiltProof hand-off on hands tagged "misplayed?". Off in the live
   * session -- sending a player out to a training app mid-session is the last
   * thing this app should do.
   */
  showDrillLink?: boolean;
}

export const HandRow = ({
  hand,
  onPress,
  currency = 'USD',
  showDrillLink = false,
}: HandRowProps) => {
  const body = (
    <>
    <View style={styles.cards}>
      <Text variant="bodyStrong" style={styles.notation}>
        {formatNotation(hand.holeCards)}
      </Text>
      {hand.position ? (
        <Text variant="caption" color={colors.textTertiary}>
          {hand.position}
        </Text>
      ) : null}
    </View>

    <View style={styles.body}>
      {hand.note ? (
        <Text numberOfLines={1} color={colors.text}>
          {hand.note}
        </Text>
      ) : (
        <Text numberOfLines={1} color={colors.textTertiary}>
          No note
        </Text>
      )}
      {/*
        The runout, under the note rather than beside the cards: it is three to
        five cards wide and would push everything else off a phone. Absent on
        most hands, which is why it takes no room when there is none.
      */}
      {hand.board ? (
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
          {formatNotation(hand.board)}
        </Text>
      ) : null}
      {hand.tags.length > 0 ? (
        <View style={styles.tags}>
          {hand.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={typography.caption} color={colors.textSecondary}>
                {HAND_TAG_LABELS[tag]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>

    {hand.amount !== null && hand.amount !== 0 ? (
      <Text variant="bodyStrong" color={resultColor(hand.amount)}>
        {formatMoney(hand.amount, { currency, signed: true })}
      </Text>
    ) : null}
    </>
  );

  return (
    <View>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          // The cards, which is what a player scans the list by and the one
          // part of a row that is always there. The note and the tags are read
          // after it by the elements that hold them.
          accessibilityLabel={`${describeHand(hand)}. Opens the hand.`}
          onPress={onPress}
          style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.row}>{body}</View>
      )}

      {showDrillLink && hand.tags.includes('misplayed') ? <DrillLink hand={hand} /> : null}
    </View>
  );
};

/** What a row is, in a phrase, for the label on the control that opens it. */
const describeHand = (hand: Hand): string => {
  const cards = hand.holeCards === null ? 'Hand with no cards' : formatNotation(hand.holeCards);
  return hand.position === null ? cards : `${cards} from ${hand.position}`;
};

/**
 * The "misplayed?" → TiltProof hand-off. A link out for now; the seam for the
 * real integration lives in `features/family/hooks.ts`.
 */
const DrillLink = ({ hand }: { hand: Hand }) => {
  const handOff = drillHandOff(hand);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={handOff.label}
      onPress={() => openLink(handOff.url)}
      style={({ pressed }) => [styles.drill, pressed ? styles.drillPressed : null]}
    >
      <Ionicons name="flash-outline" size={14} color={colors.accent} />
      <Text variant="caption" color={colors.accent}>
        {handOff.label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: 0.6,
  },
  cards: {
    minWidth: 64,
  },
  notation: {
    letterSpacing: 0.5,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tag: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  drill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingLeft: 64 + spacing.md,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  drillPressed: {
    opacity: 0.6,
  },
});
