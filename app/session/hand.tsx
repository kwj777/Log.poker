/**
 * Log a hand.
 *
 * The target is fifteen seconds, so the screen is ordered by what a player
 * reaches for first and every field is optional. Cards, position and a tag are
 * all taps; the note is one line by default. Save is enabled from the moment
 * anything at all has been entered -- a hand logged as "cooler, no cards" is a
 * far better outcome than a hand not logged because the form demanded more.
 *
 * One hand in a session leaves on a different screen. A hand tagged as a bad
 * beat or a cooler is the app's sharpest live signal that the game has just
 * done something to somebody, so the save is followed by an offer of a reset
 * rather than by the way out -- once per session, and never in front of the
 * write. See `features/family/tableOffer.ts` for which tags and why those.
 *
 * ## Which session it writes to
 *
 * The live one by default, and the one named by `sessionId` when the screen is
 * opened from a session that has already ended. `logHand` has always taken a
 * session id and has never cared whether that session was running; only this
 * screen cared, by reading `activeSession` and refusing when there was none.
 * The effect was that a night you wrote down afterwards could never have a
 * hand attached to it, for as long as it existed -- which sat oddly beside an
 * app that will let you add the session itself, edit it, and edit every hand
 * already in it.
 *
 * A hand added to a session that is over is timed at that session's end rather
 * than at now. It happened somewhere inside that night, this screen cannot
 * know where, and the end of it is the one guess that keeps the hand among the
 * right session's hands and in the right year. It also gets no reset offer,
 * for the reason editing does not: the offer is for the minute after a hand
 * happened, and neither of these is that minute.
 *
 * ## The same screen edits one
 *
 * With an `id` it opens on a hand that already exists and writes over it. One
 * screen rather than two, because the form is the whole screen: cards, seat,
 * tags, a line, a pot swing and a runout, with every one of them optional.
 * Duplicating that to change a card somebody typed wrong would be duplicating
 * the entire thing, and the copy that got fixed would be whichever one anybody
 * happened to be looking at.
 *
 * Editing differs in four places and nowhere else. It reads its session from
 * the hand rather than from the store's live one, because a hand being fixed
 * is usually from a night that ended weeks ago. It has a Delete. It never
 * offers a reset -- the offer is for the moment a hand happened, and this is
 * not that moment. And the tagline says which it is, since the two screens are
 * otherwise identical and a form that silently overwrites is worse than one
 * that says it will.
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { ChipGroup, ChipMultiGroup } from '../../src/components/Chip';
import { Card } from '../../src/components/Card';
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
import {
  MAX_BOARD,
  cardToString,
  clashingCards,
  isBoard,
} from '../../src/domain/handNotation';
import { formatSessionDate } from '../../src/features/sessions/format';
import { openLink } from '../../src/features/family/hooks';
import { tableHandOff } from '../../src/features/family/links';
import { tableOfferCopy, wantsTableReset } from '../../src/features/family/tableOffer';
import { useHandById, useLogStore, useSessionById } from '../../src/store/useLogStore';
import { colors, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

const POSITION_OPTIONS = POSITIONS.map((value) => ({ value, label: value }));
const TAG_OPTIONS = HAND_TAGS.map((value) => ({ value, label: HAND_TAG_LABELS[value] }));

export default function LogHandScreen() {
  /**
   * `id` is present when this screen is opened on a hand that already exists;
   * `sessionId` when it is opened to add one to a session that is not running.
   * Neither is present for the ordinary case, a hand at a live table.
   */
  const { id, sessionId } = useLocalSearchParams<{ id?: string; sessionId?: string }>();
  const editingId = id ?? null;
  const editing = editingId !== null;

  const activeSession = useLogStore((state) => state.activeSession);
  const logHand = useLogStore((state) => state.logHand);
  const updateHand = useLogStore((state) => state.updateHand);
  const removeHand = useLogStore((state) => state.deleteHand);
  const tableOfferMadeAt = useLogStore((state) => state.tableOfferMadeAt);
  const markTableOffer = useLogStore((state) => state.markTableOffer);

  const existing = useHandById(editingId);
  /**
   * The session this hand belongs to, which is not always the live one.
   *
   * It decides two things on this screen: how many hole cards the picker deals
   * (PLO has four) and what currency the pot swing is in. A hand from a PLO
   * night being edited during a hold'em session has to keep asking for four.
   */
  const handSession = useSessionById(existing == null ? null : existing.sessionId);
  /** The session named by the route, for a hand being added to a finished night. */
  const namedSession = useSessionById(editing ? null : (sessionId ?? null));
  /**
   * The live session only when the route named nothing.
   *
   * It was `namedSession ?? activeSession`, and that fallback fires as readily
   * for a session that was named and is gone as for one that was never named.
   * The screen already knows the difference and says so, but the branch that
   * says it cannot be reached while a live session exists, because `session`
   * is never null. So opening last Tuesday from History, tapping Log a hand,
   * and having a sync delete that session from another device while the form
   * is open swapped the screen to tonight's table without a word: `atTheTable`
   * then matched, and Save wrote the hand to the session the player is sitting
   * at, stamped now.
   */
  const session = editing ? handSession : sessionId != null ? namedSession : activeSession;

  /**
   * Whether this is a hand at the table the player is sitting at right now.
   *
   * Against `activeSession` rather than against which param was used, because
   * those can disagree in both directions. Opening the live session's own
   * detail screen and tapping Log a hand passes its id, and that is still a
   * live hand. A session left running from a week ago has a null `endedAt` and
   * is not one: the store calls that stranded, the player is not at it, and it
   * should no more offer them a break than last Tuesday should.
   */
  const atTheTable =
    !editing && session !== null && activeSession !== null && session.id === activeSession.id;

  const [holeCards, setHoleCards] = useState<string | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [tags, setTags] = useState<HandTag[]>([]);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [showAmount, setShowAmount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /**
   * Whether the hand that was just written is one worth offering a reset for.
   *
   * Local, and held rather than derived from the store, for `MidSessionCheckIn`'s
   * reason: `tableOfferMadeAt` flips the instant the offer is made and would
   * take the card away with it. It lives for this mounting only, which is
   * right -- it is a moment, not a fixture.
   */
  const [offered, setOffered] = useState(false);

  /**
   * The form filled in from the hand, once, when it arrives.
   *
   * Adjusted during render rather than synced in an effect, the way session
   * detail seeds its notes draft: an effect would render the empty form first
   * and then fill it, so a hand being edited would flash as a blank one. The
   * id it was seeded from is remembered rather than a boolean, so a screen
   * that moves to a different hand re-seeds and one that merely re-renders
   * does not throw away what is being typed.
   */
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  if (existing != null && seededFrom !== existing.id) {
    setSeededFrom(existing.id);
    setHoleCards(existing.holeCards);
    setBoard(existing.board);
    setShowBoard(existing.board !== null);
    setPosition(existing.position);
    setTags(existing.tags);
    setNote(existing.note ?? '');
    setAmount(existing.amount === null ? '' : String(existing.amount / 100));
    setShowAmount(existing.amount !== null);
  }

  const title = editing ? 'Edit hand' : 'Log a hand';
  const pageTitle = `${title} · Log`;

  if (editing && existing === null) {
    // Deleted here in another tab, or on another device and synced away while
    // this was open. Said plainly rather than shown as an empty form that
    // would write the hand back.
    return (
      <Screen>
        <PageMeta title={pageTitle} />
        <View style={styles.empty}>
          <Text variant="heading" center>
            Hand not found
          </Text>
          <Text color={colors.textSecondary} center>
            It may have been deleted.
          </Text>
          <Button label="Close" onPress={() => router.back()} style={styles.emptyAction} />
        </View>
      </Screen>
    );
  }

  if (!session) {
    // While editing this is the read not having landed, which is a beat; the
    // form would be empty and seed itself a frame later, so nothing is drawn.
    if (editing) {
      return (
        <Screen>
          <PageMeta title={pageTitle} />
        </Screen>
      );
    }
    // A named session that is not here is a different thing from no session at
    // all, and telling somebody to start one would be advice for a problem
    // they do not have.
    const named = sessionId != null;
    return (
      <Screen>
        <PageMeta title={pageTitle} />
        <View style={styles.empty}>
          <Text variant="heading" center>
            {named ? 'Session not found' : 'No session running'}
          </Text>
          <Text color={colors.textSecondary} center>
            {named
              ? 'It may have been deleted.'
              : 'Start a session, or open one you have already logged and add the hand there.'}
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
  /**
   * A card in both halves of the hand, which one deck does not allow.
   *
   * The picker now refuses to deal one twice, so this can only be a hand
   * stored before it did. `clashingCards` was written for exactly this and had
   * no caller anywhere in the app, which is why nothing ever said so.
   */
  const clash = showBoard ? clashingCards(holeCards, board) : [];

  /** What the form says, in the shape both writes take. */
  const entered = () => ({
    holeCards,
    // Only what is on screen: collapsing the section leaves what was typed
    // in place, and a board nobody can see is not one they chose to log.
    board: showBoard ? board : null,
    position,
    tags,
    note: note.trim() === '' ? null : note.trim(),
    amount: showAmount ? parseAmount(amount) : null,
  });

  const save = async () => {
    if (!hasSomething || partialBoard || saving) return;
    setSaving(true);
    setFailed(null);
    try {
      if (editing && editingId !== null) {
        await updateHand(editingId, entered());
        successFeedback();
        // Straight back, with no offer: see the header. The reset is for the
        // minute after a hand happened and this is not it.
        router.back();
        return;
      }
      await logHand({
        sessionId: session.id,
        // A hand added to a night that is over is timed at the end of it. See
        // the header: nothing here knows when inside the session it happened,
        // and `Date.now()` would file it under today.
        ...(atTheTable ? {} : { at: session.endedAt ?? session.startedAt }),
        ...entered(),
      });
      successFeedback();
      /*
        The write is done and nothing below may undo it or stand in front of
        it, which is the rule `MidSessionCheckIn` states about `logMood` and
        the same rule here: a hand this screen made harder to save is a hand
        that does not get logged. So the offer is decided after the await, off
        the tags that were actually written, and the worst it can do is leave
        somebody on a screen with a way out on it.
      */
      if (atTheTable && wantsTableReset(tags) && tableOfferMadeAt === null) {
        markTableOffer();
        setOffered(true);
        return;
      }
      router.back();
    } catch (error) {
      // Said rather than swallowed. A spinner that stops and a screen that does
      // not move is what success looks like from a foot away, so a hand that
      // failed to save read as one that saved.
      setFailed(describeFailure(error, 'That hand could not be saved.'));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (editingId === null || deleting) return;
    setDeleting(true);
    setFailed(null);
    try {
      await removeHand(editingId);
      router.back();
    } catch (error) {
      setFailed(describeFailure(error, 'That hand could not be deleted.'));
      setDeleting(false);
    }
  };

  if (offered) {
    const offer = tableHandOff();
    return (
      <Screen>
        <PageMeta title={pageTitle} />
        <Card style={styles.offer}>
          <Text variant="bodyStrong">That one is logged.</Text>
          <Text variant="caption" color={colors.textTertiary} style={styles.offerHint}>
            {tableOfferCopy()}
          </Text>
          <View style={styles.offerRow}>
            <Button
              label={offer.label}
              variant="secondary"
              size="small"
              onPress={() => openLink(offer.url)}
            />
            <Button
              label="Back to the game"
              variant="ghost"
              size="small"
              onPress={() => router.back()}
            />
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button
            label={editing ? 'Save changes' : 'Save hand'}
            onPress={() => void save()}
            disabled={!hasSomething || partialBoard}
            loading={saving}
          />
          <Button label="Cancel" variant="ghost" size="medium" onPress={() => router.back()} />
        </View>
      }
    >
      <PageMeta title={pageTitle} />
      <View style={styles.header}>
        <Text variant="title">{title}</Text>
        <Text color={colors.textSecondary} style={styles.subtitle}>
          {editing
            ? 'Change what was wrong. Everything here is still optional.'
            : atTheTable
              ? 'Everything here is optional. Tap what matters and save.'
              : // Which night it is going into, since this is the one case
                // where the answer is not "the one you are sitting in".
                `Adding to ${session.venue?.name ?? 'your session'} on ${formatSessionDate(session.startedAt)}. Everything here is optional.`}
        </Text>
      </View>

      <SectionHeader title="Your cards" />
      {/*
        Told the board, for the same reason the board is told these: one deck.
        The guard was wired one way only, so a player who set the runout first
        and their own cards second could deal the same card twice, and the
        hand stored a board and a holding that cannot both be true.
      */}
      <CardPicker
        value={holeCards}
        onChange={setHoleCards}
        cardCount={session.gameType === 'PLO' ? 4 : 2}
        exclude={showBoard ? board : null}
      />
      {clash.length > 0 ? (
        <Text variant="caption" color={colors.loss} style={styles.amountHint}>
          {clash.length === 1
            ? `${cardToString(clash[0])} is on the board as well. One of the two is wrong.`
            : `${clash.map(cardToString).join(' and ')} are on the board as well.`}
        </Text>
      ) : null}

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

      {/*
        Only on a hand that exists, and behind a confirmation, the way session
        detail asks before dropping a night. A hand is a smaller thing to lose
        than a session and still not one a stray tap should take.
      */}
      {editing ? (
        <View style={styles.dangerZone}>
          {confirmingDelete ? (
            <View style={styles.confirmRow}>
              <Text color={colors.textSecondary} style={styles.confirmText}>
                Delete this hand? This can’t be undone.
              </Text>
              <View style={styles.confirmActions}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  size="small"
                  onPress={() => setConfirmingDelete(false)}
                />
                <Button
                  label="Delete"
                  variant="danger"
                  size="small"
                  loading={deleting}
                  onPress={() => void remove()}
                />
              </View>
            </View>
          ) : (
            <Button
              label="Delete hand"
              variant="danger"
              size="medium"
              onPress={() => setConfirmingDelete(true)}
            />
          )}
        </View>
      ) : null}
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
  offer: {
    marginTop: spacing.xl,
    borderColor: colors.accentDim,
  },
  offerHint: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  dangerZone: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },
  confirmRow: {
    gap: spacing.md,
  },
  confirmText: {
    lineHeight: 22,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
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
