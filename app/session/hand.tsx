/**
 * Log a hand.
 *
 * The target is fifteen seconds, so the screen is ordered by what a player
 * reaches for first and every field is optional. Cards, position and a tag are
 * all taps; the note is one line by default. Save is enabled from the moment
 * anything at all has been entered -- a hand logged as "cooler, no cards" is a
 * far better outcome than a hand not logged because the form demanded more.
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { ChipGroup, ChipMultiGroup } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Explain } from '../../src/components/Explain';
import { Text } from '../../src/components/Text';
import { successFeedback } from '../../src/components/haptics';
import { parseAmount } from '../../src/domain/money';
import { handTagGlossary, positionGlossary } from '../../src/domain/glossary';
import {
  HAND_TAGS,
  HAND_TAG_LABELS,
  POSITIONS,
  type HandTag,
  type Position,
} from '../../src/domain/types';
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
import { CardPicker } from '../../src/features/hands/CardPicker';
import { MAX_BOARD, isBoard } from '../../src/domain/handNotation';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

const POSITION_OPTIONS = POSITIONS.map((value) => ({ value, label: value }));
const TAG_OPTIONS = HAND_TAGS.map((value) => ({ value, label: HAND_TAG_LABELS[value] }));

export default function LogHandScreen() {
  const session = useLogStore((state) => state.activeSession);
  const logHand = useLogStore((state) => state.logHand);

  const [holeCards, setHoleCards] = useState<string | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [tags, setTags] = useState<HandTag[]>([]);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [showAmount, setShowAmount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!session) {
    return (
      <Screen>
        <PageMeta title="Log a hand · Log" />
        <View style={styles.empty}>
          <Text variant="heading" center>
            No session running
          </Text>
          <Text color={colors.textSecondary} center>
            Hands are logged against a live session. Start one first.
          </Text>
          <Button label="Close" onPress={() => router.back()} style={styles.emptyAction} />
        </View>
      </Screen>
    );
  }

  // Any single piece of information makes the hand worth keeping.
  const hasSomething =
    holeCards !== null || position !== null || tags.length > 0 || note.trim() !== '';

  /**
   * A board that is one card or two, which is not an early runout.
   *
   * Three cards arrive at once, so this is somebody who started tapping and
   * stopped. Storing it would put a thing that never happened in the log, and
   * silently dropping it would lose what they did type -- so the save waits and
   * the line below says why.
   */
  const partialBoard = showBoard && board !== null && !isBoard(board);

  const save = async () => {
    if (!hasSomething || partialBoard || saving) return;
    setSaving(true);
    setFailed(null);
    try {
      await logHand({
        sessionId: session.id,
        holeCards,
        // Only what is on screen: collapsing the section leaves what was typed
        // in place, and a board nobody can see is not one they chose to log.
        board: showBoard ? board : null,
        position,
        tags,
        note: note.trim() === '' ? null : note.trim(),
        amount: showAmount ? parseAmount(amount) : null,
      });
      successFeedback();
      router.back();
    } catch (error) {
      // Said rather than swallowed. A spinner that stops and a screen that does
      // not move is what success looks like from a foot away, so a hand that
      // failed to save read as one that saved.
      setFailed(describeFailure(error, 'That hand could not be saved.'));
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label="Save hand"
            onPress={() => void save()}
            disabled={!hasSomething || partialBoard}
            loading={saving}
          />
          <Button label="Cancel" variant="ghost" size="medium" onPress={() => router.back()} />
        </View>
      }
    >
      <PageMeta title="Log a hand · Log" />
      <View style={styles.header}>
        <Text variant="title">Log a hand</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          Everything here is optional. Tap what matters and save.
        </Text>
      </View>

      <SectionHeader title="Your cards" />
      <CardPicker
        value={holeCards}
        onChange={setHoleCards}
        cardCount={session.gameType === 'PLO' ? 4 : 2}
      />

      <SectionHeader
        title="Position"
        action={<Explain title="Positions" entries={positionGlossary()} />}
      />
      <ChipGroup options={POSITION_OPTIONS} value={position} onChange={setPosition} scroll />

      <SectionHeader
        title="Tag it"
        action={<Explain title="What the tags mean" entries={handTagGlossary()} />}
      />
      <ChipMultiGroup
        options={TAG_OPTIONS}
        values={tags}
        onToggle={(tag) =>
          setTags((current) =>
            current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag],
          )
        }
      />

      <SectionHeader title="One line" />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="What happened?"
        placeholderTextColor={colors.textTertiary}
        style={styles.note}
        multiline
        returnKeyType="done"
        accessibilityLabel="Hand note"
      />

      <SectionHeader
        title="Pot swing (optional)"
        action={
          <Button
            label={showAmount ? 'Hide' : 'Add'}
            accessibilityLabel={showAmount ? 'Hide the pot swing' : 'Add a pot swing'}
            variant="ghost"
            size="small"
            onPress={() => setShowAmount((current) => !current)}
          />
        }
      />
      {showAmount ? (
        <AmountInput
          value={amount}
          onChangeText={setAmount}
          currency={session.currency}
          placeholder="0"
          accessibilityLabel="Pot swing amount"
        />
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.amountHint}>
          Skip it unless the number is the point of the hand.
        </Text>
      )}

      <SectionHeader
        title="Board (optional)"
        action={
          <Button
            label={showBoard ? 'Hide' : 'Add'}
            accessibilityLabel={showBoard ? 'Hide the board' : 'Add a board'}
            variant="ghost"
            size="small"
            onPress={() => setShowBoard((current) => !current)}
          />
        }
      />
      {showBoard ? (
        <>
          {/*
            Told the hole cards, because one deck: without it the board would
            deal a card the player is already holding.
          */}
          <CardPicker value={board} onChange={setBoard} cardCount={MAX_BOARD} exclude={holeCards} />
          <Text
            variant="caption"
            color={partialBoard ? colors.loss : colors.textTertiary}
            style={styles.amountHint}
          >
            {partialBoard
              ? 'A board is three cards, four or five. Add the rest of the flop, or clear it.'
              : 'Stop at the flop if that is where the hand did.'}
          </Text>
        </>
      ) : (
        <Text variant="caption" color={colors.textTertiary} style={styles.amountHint}>
          Worth it when the runout is the story: a cooler, a bad beat, a bluff that got there.
        </Text>
      )}

      <ErrorNote message={failed} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
  },
  subtitle: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  note: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 72,
    padding: spacing.lg,
    textAlignVertical: 'top',
    ...Platform.select({ web: { outlineStyle: 'none' as 'solid' }, default: {} }),
  },
  amountHint: {
    marginBottom: spacing.lg,
  },
  footer: {
    gap: spacing.sm,
  },
  empty: {
    paddingTop: spacing.xxxl,
    gap: spacing.md,
  },
  emptyAction: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
});
