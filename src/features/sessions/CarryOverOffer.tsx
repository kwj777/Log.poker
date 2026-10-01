/**
 * The offer a player sees when the record, rather than the player, says the
 * last night is still with them.
 *
 * `carryOver` in the domain holds the argument for why this moment exists, why
 * it reads both directions, and why the threshold is scaled to the player's
 * own swing. This file is the rendering and the two decisions rendering owns:
 * what it says, and when it stands aside.
 *
 * ## It stands aside for the card that is already there
 *
 * `PreSessionWarmUp` sits on this same screen and makes the same offer, to a
 * player who has just said on the mood picker that they are rattled. Both
 * showing at once would be two Untilt cards stacked on the one screen whose
 * job is the Start button, which is the clutter `FamilyCrossPromo` promises
 * this app does not do. The self-report wins when it is there: it is about
 * right now, where this is an inference from Tuesday.
 *
 * ## It cannot delay, gate or precede starting the session
 *
 * Every rule `PreSessionWarmUp` states applies here unchanged, and one of them
 * with more force. That card appears in response to a 4 or a 5, so a player
 * who wants it gone picks another score. This one appears before the picker
 * has been touched, which makes it the first thing on the screen -- so it is an
 * inline card and nothing else: not a modal, no dismiss control to tap past,
 * no change to what Start does, and nothing that moves the picker or the
 * footer the Start button lives in. If tapping a 5 were in any way more
 * expensive than tapping a 3 because of this card, it would corrupt the start
 * scores the mood comparison is computed from, silently, for as long as it
 * shipped.
 *
 * ## What it says it is
 *
 * The same lane and the same promise as `PreSessionWarmUp`, so the sentence
 * about the pass is the same sentence: every one of Untilt's before-the-session
 * meditations is premium, the unpaid branch lands on a screen that still has
 * the free between-hands reset on it, and the copy says which is which. No
 * price, no checkout, no verb about buying, on either branch, for the reason
 * `SUBMISSION.md` records about App Store guideline 3.1.1.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { getSession, hasPass } from '../../auth';
import { wantsReset } from '../../domain/mood';
import type { CarryOverDirection } from '../../domain/carryOver';
import type { MoodScore } from '../../domain/types';
import { colors, spacing } from '../../theme';
import { openLink } from '../family/hooks';
import { preSessionHandOff } from '../family/links';

/** The heading, which is the only part that differs by direction. */
export const carryOverTitle = (direction: CarryOverDirection): string =>
  direction === 'loss' ? 'Last night was a rough one' : 'Last night was a big one';

/**
 * What the card says, given the direction and what is known about the player.
 *
 * Exported and pure for the reason `warmUpCopy` is: the wording is the load
 * bearing part of this card and a string is cheaper to pin than a render.
 *
 * The first sentence is the one to be careful with. It describes what the
 * player is bringing to the table and says nothing whatever about what the
 * cards will do, because a win does not make a loss due and `variance.ts` has
 * a test asserting none of its verdicts imply otherwise. The same rule, on a
 * card that would be far easier to write the other way.
 */
export const carryOverCopy = (direction: CarryOverDirection, paid: boolean): string => {
  const reason =
    direction === 'loss'
      ? 'A night that far below your own average tends to come back to the table with you, whatever the cards do next.'
      : 'A night that far above your own average comes back to the table too, and it loosens people up.';
  const opening =
    'Untilt has a lane for the ten minutes before you sit down, while deciding anything is still cheap.';
  return paid
    ? `${reason} ${opening} Your pass covers them.`
    : `${reason} ${opening} Those are inside its pass, and the free between-hands reset is on the same screen.`;
};

interface CarryOverOfferProps {
  /** What the last session left behind, from `carryOver`. Null on an ordinary night. */
  carried: CarryOverDirection | null;
  /** Whatever the mood picker is showing right now, including nothing. */
  mood: MoodScore | null;
}

export const CarryOverOffer = ({ carried, mood }: CarryOverOfferProps) => {
  // Null is "not read yet", which is not "has not paid". See `PostSessionReset`.
  const [paid, setPaid] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void getSession().then((held) => {
      if (alive) setPaid(hasPass(held?.claim ?? null));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (carried === null || paid === null) return null;
  // The player's own answer about right now beats an inference about Tuesday.
  if (mood !== null && wantsReset(mood)) return null;

  const offer = preSessionHandOff(paid);

  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">{carryOverTitle(carried)}</Text>
      <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
        {carryOverCopy(carried, paid)}
      </Text>
      <View style={styles.offerRow}>
        <Button
          label={offer.label}
          variant="secondary"
          size="small"
          onPress={() => openLink(offer.url)}
        />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    borderColor: colors.accentDim,
  },
  hint: {
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  offerRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
});
