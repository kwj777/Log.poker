/**
 * The offer a player sees once they have closed out a session.
 *
 * `MidSessionCheckIn` is the other half of this and the two are deliberately
 * not the same offer. That one is for somebody rattled at a table two hours
 * in, so it appears only on a 4 or a 5, it names the free sixty-second reset,
 * and its header explains at length why nothing is sold there: a card that
 * tries to sell to somebody mid-hand is a card people learn to dismiss, and a
 * dismissed check-in collects no data.
 *
 * This one is after the chips are counted. The player is away from the table,
 * the session is written, and there is nothing left to interrupt -- which is
 * exactly where that same header says the paid material belongs. So this shows
 * after every session, win or lose, because the hour after a bad night and the
 * hour after a good one are both the hour the session sticks.
 *
 * ## Shown once, at the moment, and never again
 *
 * The session detail screen is also where somebody lands from History three
 * weeks later, and "take a reset" on a night they have already forgotten is
 * noise. So the card is not a property of the screen: it is rendered only when
 * the cash-out navigation says this is the session that just ended, which is
 * the `ended` search param `app/session/active.tsx` sets and nothing else
 * does.
 *
 * ## Two sentences, and it waits to know which
 *
 * A player who has bought the pass should not be sold what they already own,
 * and a player who has not should not be promised something that will ask them
 * for money when they arrive. So the copy branches on `hasPass`, and the card
 * renders nothing at all until that read lands rather than showing one
 * sentence and swapping it: a wrong sentence for one frame is the failure this
 * screen's tests already exist to prevent, one section up.
 *
 * `hasPass` is false for everybody today, because Log's own door mints the
 * free tier and no token of Untilt's can reach this app. That is not a reason
 * to leave the branch unwritten. See `SYNC_NEEDS_PASS`: everything that reads
 * an entitlement here is built, wired and tested against both answers, so that
 * the day the shared entitlement exists this is a constant changing rather
 * than a feature being written.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { getSession, hasPass } from '../../auth';
import { colors, spacing } from '../../theme';
import { openHandOff } from '../family/hooks';
import { postSessionHandOff } from '../family/links';

/**
 * What the card says, given what is known about the player and the link.
 *
 * Pulled out of the component and exported so the wording can be tested
 * without rendering anything, the way `features/account/copy.ts` is. The
 * wording is the load bearing part of this card: see the note in
 * `postSessionHandOff` about the distance App Store guideline 3.1.1 draws
 * between naming something that exists elsewhere and selling it here.
 */
export const offerCopy = (paid: boolean, lands: boolean): string => {
  if (!paid) {
    return 'Win or lose, the hour after a session is the one that sticks. Untilt has resets for exactly that, inside its pass.';
  }
  return lands
    ? 'Win or lose, the hour after a session is the one that sticks. Your pass covers this one.'
    : 'Win or lose, the hour after a session is the one that sticks. Your pass already covers Untilt’s after-session resets.';
};

export const PostSessionReset = () => {
  // Null is "not read yet", which is not "has not paid". See the header.
  const [paid, setPaid] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Read once on mount, the way `SignInCard` does: there is nothing to
    // subscribe to, because nothing on this screen can change the token.
    let alive = true;
    void getSession().then((held) => {
      if (alive) setPaid(hasPass(held?.claim ?? null));
    });
    return () => {
      alive = false;
    };
  }, []);

  if (dismissed || paid === null) return null;

  const offer = postSessionHandOff(paid);

  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">That one is logged.</Text>
      <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
        {offerCopy(paid, offer.lands)}
      </Text>
      <View style={styles.offerRow}>
        <Button
          label={offer.label}
          variant="secondary"
          size="small"
          onPress={() => openHandOff(offer.url)}
        />
        <Button
          label="Not now"
          variant="ghost"
          size="small"
          onPress={() => setDismissed(true)}
        />
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
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
