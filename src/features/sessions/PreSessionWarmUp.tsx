/**
 * The offer a player sees when they say, before a card is dealt, that they are
 * not in a state to play.
 *
 * ## Why this moment and not one of the three already built
 *
 * `MidSessionCheckIn` catches a rattled player two hours into a session and
 * `PostSessionReset` catches them after the chips are counted. Both arrive
 * after the money is at risk. This is the only offer in the app that arrives
 * before it, and `mood.ts` spends its header explaining why that is the one
 * worth having:
 *
 *   > The `start` score is recorded before a single hand is dealt, so the
 *   > result cannot have caused it. That makes the comparison a real one and,
 *   > better, an actionable one: it is about a decision the player still has
 *   > in front of them.
 *
 * The comparison on the variance tab makes that argument to a player over
 * months, with their own money in it, and says out loud that some nights the
 * right move is not to sit down. Until now nothing in the app made it at the
 * moment it could be acted on, although the app has been collecting the answer
 * on this screen since it shipped. Untilt's own preflight screen says the same
 * thing in six words -- "while deciding anything is still cheap" -- which is
 * what makes this a hand-off rather than a lecture Log would have to write.
 *
 * ## It is a 4 or a 5, and it is the shared definition of those
 *
 * `wantsReset` rather than a literal, for the reason its own header gives:
 * two definitions of rattled in one app is one too many. The same two scores
 * summon the mid-session reset, group a session as rattled in the mood
 * comparison, and open this.
 *
 * ## It cannot delay, gate or precede starting the session
 *
 * The rule `MidSessionCheckIn` states about `logMood` applies here with the
 * same force and a different mechanism. There the danger was a check-in that
 * summons something, which players learn to answer with a 3. Here the danger
 * is worse, because the mood picker sits on the screen whose whole job is the
 * Start button: an offer that took a tap to dismiss, or moved the footer, or
 * in any way made a 5 more expensive to tap than a 3, would corrupt the start
 * scores this app's flagship comparison is computed from -- and it would do it
 * silently, for as long as it shipped.
 *
 * So this is an inline card below the picker and nothing else. It is not a
 * modal, it does not move the Start button (which lives in the screen's
 * footer), it has no dismiss control to tap past, and it changes nothing about
 * what Start does. Choosing another score puts it away, which is the only
 * interaction it has.
 *
 * ## What it says it is
 *
 * Every one of Untilt's thirty-five before-the-session meditations is inside
 * its pass, so the copy says so rather than leaving somebody to find out on
 * arrival -- the call `PostSessionReset` already made for the wind-downs, for
 * the reason `SUBMISSION.md` records about App Store guideline 3.1.1: naming
 * what exists elsewhere is an ordinary outbound link, and selling it from
 * inside Log is what would cost the submission. No price, no checkout, no verb
 * about buying, on either branch.
 *
 * It also says what the unpaid branch actually lands on, because that one is
 * not a wall: `preflightFallback` over there puts the free between-hands reset
 * under the suggestions, so the screen always has a row on it that plays. A
 * card that implied otherwise would be talking somebody out of a tap that
 * works.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { getSession, hasPass } from '../../auth';
import { wantsReset } from '../../domain/mood';
import type { MoodScore } from '../../domain/types';
import { colors, spacing } from '../../theme';
import { openLink } from '../family/hooks';
import { preSessionHandOff } from '../family/links';

/**
 * What the card says, given what is known about the player.
 *
 * Exported and pure for the reason `PostSessionReset`'s is: the wording is the
 * load bearing part of this card and this repository's test runner cannot
 * render a component.
 *
 * Both branches name the pass, because both are true of the same screen. The
 * unpaid one adds the free reset, which is the row that player will actually
 * be able to play when they get there.
 */
export const warmUpCopy = (paid: boolean): string => {
  const opening =
    'Untilt has a lane for the ten minutes before you sit down, while deciding anything is still cheap.';
  return paid
    ? `${opening} Your pass covers them.`
    : `${opening} Those are inside its pass, and the free between-hands reset is on the same screen.`;
};

interface PreSessionWarmUpProps {
  /** Whatever the mood picker is showing right now, including nothing. */
  mood: MoodScore | null;
}

export const PreSessionWarmUp = ({ mood }: PreSessionWarmUpProps) => {
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

  if (mood === null || !wantsReset(mood) || paid === null) return null;

  const offer = preSessionHandOff(paid);

  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">Rough day already?</Text>
      <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
        {warmUpCopy(paid)}
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
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    borderColor: colors.accentDim,
  },
  hint: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
