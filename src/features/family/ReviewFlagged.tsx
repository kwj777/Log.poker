/**
 * "You flagged 2 hands", on the dashboard, after the night they were flagged.
 *
 * The other half of `reviewPrompt.ts`, which holds the argument for why this
 * moment exists and why it clears itself. This file is the rendering and the
 * one decision rendering owns: what a tap does.
 *
 * ## One row per hand, not one button for the session
 *
 * TiltProof's review is a review of *one hand*. Its own header says so, and
 * `drillHandOff` carries one hand's cards, position and runout. A single
 * "review these" button would have to pick a hand on the player's behalf and
 * then land them on it with no way back to the others, so the card names the
 * hands and lets the player choose the one they are still annoyed about. Three
 * at most; see `MAX_PROMPTED`.
 *
 * ## Never while a session is running
 *
 * The dashboard's own header says the primary action is always "start a
 * session" or "resume", and `HandRow` turns its drill link off in the live
 * session because sending a player out to a training app mid-session is the
 * last thing this app should do. The same rule holds here and is enforced by
 * the caller: this card is not rendered while `activeSession` is set.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { formatNotation } from '../../domain/handNotation';
import type { Hand } from '../../domain/types';
import { colors, radius, spacing } from '../../theme';
import { openLink } from './hooks';
import { drillHandOff } from './links';
import { promptCopy, promptTitle, type ReviewPrompt } from './reviewPrompt';

interface ReviewFlaggedProps {
  prompt: ReviewPrompt | null;
}

export const ReviewFlagged = ({ prompt }: ReviewFlaggedProps) => {
  if (prompt === null) return null;

  const rest = prompt.count - prompt.hands.length;

  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">{promptTitle(prompt.count)}</Text>
      <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
        {promptCopy()}
      </Text>
      <View style={styles.hands}>
        {prompt.hands.map((hand, index) => (
          <FlaggedHand key={hand.id} hand={hand} last={index === prompt.hands.length - 1} />
        ))}
      </View>
      {rest > 0 ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.rest}>
          {/*
            Counted rather than listed, and it says where they are so the number
            is a fact rather than a tease: the session's own screen carries the
            same hand-off on every flagged row.
          */}
          {rest === 1
            ? 'One more is on that session.'
            : `${rest} more are on that session.`}
        </Text>
      ) : null}
    </Card>
  );
};

/**
 * One flagged hand, as a link into its own review.
 *
 * The cards are the label because that is what a player calls the hand, and
 * the runout sits under them for the same reason `HandRow` puts it there: it
 * is what turns a holding into a spot. A hand logged with no cards at all is
 * still shown -- the journal keeps those and the review has a screen for them
 * -- so the notation falls back to the note rather than to an empty row.
 */
const FlaggedHand = ({ hand, last }: { hand: Hand; last: boolean }) => {
  const handOff = drillHandOff(hand);
  const cards = hand.holeCards === null ? null : formatNotation(hand.holeCards);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={handOff.label}
      onPress={() => openLink(handOff.url)}
      style={({ pressed }) => [
        styles.row,
        last ? styles.lastRow : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.icon}>
        <Ionicons name="flash-outline" size={16} color={colors.accent} />
      </View>
      <View style={styles.body}>
        <Text variant="bodyStrong" style={styles.notation}>
          {cards ?? 'No cards'}
        </Text>
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
          {hand.board === null ? (hand.note ?? 'No note') : formatNotation(hand.board)}
        </Text>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    borderColor: colors.accentDim,
  },
  hint: {
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  hands: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    opacity: 0.6,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDim,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  notation: {
    letterSpacing: 0.5,
  },
  rest: {
    marginTop: spacing.sm,
  },
});

