/**
 * The card picker — the component the 15-second target lives or dies on.
 *
 * Two taps per card: rank, then suit. A flat 52-card grid would be one tap
 * fewer, but each target would be ~40pt wide on a phone, which is below what a
 * thumb can hit reliably without looking — and looking is the thing that costs
 * the seconds. With this layout every target is full-width-ish and the whole
 * hand is four confident taps.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { tapFeedback } from '../../components/haptics';
import {
  RANKS,
  SUITS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  cardsToNotation,
  isRedSuit,
  parseNotation,
  type Card,
  type Rank,
} from '../../domain/handNotation';
import { colors, radius, spacing } from '../../theme';

interface CardPickerProps {
  /** Current notation, e.g. `"AsKd"`. */
  value: string | null;
  onChange: (notation: string | null) => void;
  /** How many cards to collect — 2 for hold'em, 4 for Omaha. */
  cardCount?: number;
}

export const CardPicker = ({ value, onChange, cardCount = 2 }: CardPickerProps) => {
  const cards = parseNotation(value) ?? [];
  const [pendingRank, setPendingRank] = useState<Rank | null>(null);

  const complete = cards.length >= cardCount;
  const taken = new Set(cards.map((card) => `${card.rank}${card.suit}`));

  const addCard = (card: Card) => {
    const next = [...cards, card].slice(0, cardCount);
    onChange(cardsToNotation(next));
    setPendingRank(null);
  };

  const removeAt = (index: number) => {
    tapFeedback();
    const next = cards.filter((_, position) => position !== index);
    onChange(next.length === 0 ? null : cardsToNotation(next));
    setPendingRank(null);
  };

  return (
    <View>
      <View style={styles.slots}>
        {Array.from({ length: cardCount }, (_, index) => {
          const card = cards[index];
          return (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={
                card
                  ? `${card.rank} of ${SUIT_NAMES[card.suit]}, tap to remove`
                  : `Card ${index + 1}, empty`
              }
              disabled={!card}
              onPress={() => removeAt(index)}
              style={({ pressed }) => [
                styles.slot,
                card ? styles.slotFilled : null,
                pressed && card ? styles.pressed : null,
              ]}
            >
              {card ? (
                <Text
                  style={styles.slotText}
                  color={isRedSuit(card.suit) ? colors.loss : colors.text}
                >
                  {card.rank}
                  {SUIT_SYMBOLS[card.suit]}
                </Text>
              ) : (
                <Text style={styles.slotText} color={colors.textTertiary}>
                  ?
                </Text>
              )}
            </Pressable>
          );
        })}

        {cards.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear cards"
            onPress={() => {
              tapFeedback();
              onChange(null);
              setPendingRank(null);
            }}
            style={styles.clear}
          >
            <Text variant="caption" color={colors.textTertiary}>
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>

      {complete ? null : pendingRank === null ? (
        <View style={styles.grid}>
          {RANKS.slice().reverse().map((rank) => (
            <Pressable
              key={rank}
              accessibilityRole="button"
              accessibilityLabel={`Rank ${rank}`}
              onPress={() => {
                tapFeedback();
                setPendingRank(rank);
              }}
              style={({ pressed }) => [styles.rank, pressed ? styles.pressed : null]}
            >
              <Text variant="heading">{rank}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.suits}>
          {SUITS.map((suit) => {
            const used = taken.has(`${pendingRank}${suit}`);
            return (
              <Pressable
                key={suit}
                accessibilityRole="button"
                accessibilityLabel={`${pendingRank} of ${SUIT_NAMES[suit]}`}
                accessibilityState={{ disabled: used }}
                disabled={used}
                onPress={() => {
                  tapFeedback();
                  addCard({ rank: pendingRank, suit });
                }}
                style={({ pressed }) => [
                  styles.suit,
                  used ? styles.used : null,
                  pressed && !used ? styles.pressed : null,
                ]}
              >
                <Text
                  style={styles.suitText}
                  color={isRedSuit(suit) ? colors.loss : colors.text}
                >
                  {pendingRank}
                  {SUIT_SYMBOLS[suit]}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a different rank"
            onPress={() => setPendingRank(null)}
            style={styles.back}
          >
            <Text variant="caption" color={colors.textTertiary}>
              Back
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  slots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  slot: {
    width: 56,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  slotFilled: {
    borderStyle: 'solid',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  slotText: {
    fontSize: 24,
    fontWeight: '700',
  },
  clear: {
    marginLeft: 'auto',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rank: {
    // Five per row on a phone-width column, each comfortably above the 48pt
    // minimum in both dimensions.
    minWidth: 56,
    flexGrow: 1,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  suits: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  suit: {
    flexGrow: 1,
    minWidth: 72,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  suitText: {
    fontSize: 26,
    fontWeight: '700',
  },
  used: {
    opacity: 0.3,
  },
  back: {
    width: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.surfaceActive,
  },
});
