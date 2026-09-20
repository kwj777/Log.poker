/**
 * Which flagged hands are still worth a review, and what the offer says.
 *
 * ## The moment this exists for
 *
 * `HandRow` already offers "Drill this in TiltProof" on a hand tagged
 * *misplayed?*, and until now that link was the only TiltProof moment in the
 * app. It is in the wrong place for the thing it is offering. A player taps
 * *misplayed?* at a table, where the tap means *come back to this*; the link
 * sits in the hands list on session detail, which is a screen reached by
 * opening History, picking a night and scrolling. Nothing ever brings the hand
 * back up, so the tag makes a promise the app does not keep.
 *
 * The review itself cannot happen at the table -- `HandRow`'s `showDrillLink`
 * is off during a live session for exactly that reason -- and it does not
 * belong in the minute after cash-out, which `PostSessionReset` has and which
 * is about how the night felt rather than what to do differently. What is left
 * is the next time the player opens the app, which is where this goes.
 *
 * ## Why it cannot become furniture
 *
 * `FamilyCrossPromo` is explicit that the cross-promo here is quiet: one card,
 * no badges, no interstitials, because a tracker that nags about the other
 * apps is the cluttered thing this category is already full of. A standing
 * "you have hands to review" banner is exactly that, and this app has no
 * key-value store to remember a dismissal in, so a "not now" would come back
 * on the next tab change.
 *
 * So the prompt is bounded by two things that clear it without anybody having
 * to dismiss anything:
 *
 *  - **One session, the last one finished.** Playing again replaces it, with
 *    that night's flagged hands or with nothing. The card cannot accumulate.
 *  - **`REVIEW_WINDOW_MS` since it ended.** A hand you have not looked at in
 *    a week is not waiting, it is history, and the offer goes quiet by itself.
 *
 * That also keeps the read cheap. `useHandsForSession` is the bounded read the
 * store already has; reading every hand ever logged onto the dashboard is the
 * thing that was deliberately taken out of the store, and nothing here asks
 * for it back.
 *
 * ## Nothing about the player crosses
 *
 * Same rule as `postSessionHandOff` and `resetHandOff`: the hand-off is built
 * by `drillHandOff`, which sends the cards, the position and the runout and
 * leaves the note out. This module picks which hand and writes the sentence;
 * it builds no URL of its own.
 */

import { isBoard } from '../../domain/handNotation';
import type { Hand, Session } from '../../domain/types';

/**
 * How long after a session ends its flagged hands are still an offer.
 *
 * A week, which is roughly the distance at which a player still remembers the
 * hand well enough to answer questions about it. Past that the review would be
 * reconstruction rather than recall, and a prompt about it is noise on a
 * dashboard somebody opened to look at their bankroll.
 */
export const REVIEW_WINDOW_MS = 7 * 86_400_000;

/** At most this many hands are named. The rest are counted, not listed. */
export const MAX_PROMPTED = 3;

export interface ReviewPrompt {
  /** The hands to offer, best candidate first, never more than `MAX_PROMPTED`. */
  hands: Hand[];
  /** How many hands the session has flagged in total, listed or not. */
  count: number;
}

/**
 * The flagged hands of one session, ordered by which review can be finished.
 *
 * TiltProof's review is postflop: it grades a range against a board, and
 * preflop that is 1,712,304 runouts per combination rather than 990. A hand
 * with no runout still opens the link and that side explains itself, but it is
 * a weaker hand to lead with, so a hand that reached a flop is offered first.
 * Cards come next for the same reason: `app/review.tsx` has a whole screen for
 * a hand Log kept a note about and never got the cards for, which is a fine
 * thing to arrive at and a poor thing to be sent to first.
 *
 * Ties keep the order they came in, which is `listHands`' newest first.
 */
export const orderForReview = (hands: readonly Hand[]): Hand[] => {
  const rank = (hand: Hand): number => {
    if (isBoard(hand.board)) return 0;
    if ((hand.holeCards ?? '') !== '') return 1;
    return 2;
  };
  return [...hands].sort((a, b) => rank(a) - rank(b));
};

interface PromptInput {
  /** The most recently finished session, or null when there is not one. */
  session: Pick<Session, 'endedAt'> | null;
  /** That session's hands, or null while the read is still out. */
  hands: readonly Hand[] | null;
  now: number;
}

/**
 * What to offer, or null for the silence that is the common case.
 *
 * Null while the hands read is still out, rather than an empty prompt that
 * appears a frame later: the same call `PostSessionReset` makes about its
 * entitlement read, for the same reason.
 */
export const reviewPrompt = ({ session, hands, now }: PromptInput): ReviewPrompt | null => {
  if (session === null || hands === null) return null;
  if (session.endedAt === null) return null;
  if (now - session.endedAt > REVIEW_WINDOW_MS) return null;

  const flagged = hands.filter((hand) => hand.tags.includes('misplayed'));
  if (flagged.length === 0) return null;

  return { hands: orderForReview(flagged).slice(0, MAX_PROMPTED), count: flagged.length };
};

/**
 * The heading, which is the player's own tap read back to them.
 *
 * It says *you flagged*, not *review these*, because the tag was the player's
 * decision and the card is the app keeping their note rather than the app
 * having an opinion about their play. The count is the whole of the urgency;
 * there is no badge and no color on it.
 */
export const promptTitle = (count: number): string =>
  count === 1 ? 'You flagged a hand' : `You flagged ${count} hands`;

/**
 * What TiltProof does with one, and what it costs, in two sentences.
 *
 * **It names what is free, and does not name a price.** `SUBMISSION.md` has
 * the argument in full: App Store guideline 3.1.1 is about an app steering a
 * customer to a purchase it does not take through Apple, and the distance
 * between "this exists over there" and "buy it here" is what keeps an outbound
 * link to a sister app an ordinary link. Nothing is sold or unlocked from
 * inside Log, and this card does not change that.
 *
 * What it does do is say which side of that app's line a review falls on, so
 * nobody taps through and finds out on arrival. There is no such side any
 * more: reviewing a hand you played is free over there, every hand, and this
 * sentence is the second attempt at saying so.
 *
 * **The first attempt shipped wrong and is worth recording.** It read "The
 * first review there is free, and the rest are inside the family pass",
 * against a `FREE_REVIEWS` of 1 and a `canReview` that spent it. TiltProof
 * deleted both, and `PRICING.md` over there now lists the review of a hand you
 * played as free on both sides of its table -- the argument being that the
 * wall landed on the least invested person in that product, who is usually
 * somebody Log had just handed over. So the copy was true when it was written
 * and false within a day of shipping, in the worse of the two directions: it
 * told a player their second flagged hand costs money, on a card whose whole
 * job is a second tap.
 *
 * The lesson is the one `TILTPROOF_REVIEW` already carries about addresses. A
 * claim about the far side's pricing fails silently here -- nothing renders an
 * error, nothing 404s, the player simply does not tap -- so it has to be read
 * off that repository rather than remembered.
 *
 * It stays a fact about that app and not a promise to this player: Log cannot
 * read TiltProof's entitlement across a registrable domain (see
 * `auth/handoff.ts`), and it does not need to for a sentence that is true
 * whoever is holding the phone.
 */
export const promptCopy = (): string =>
  'TiltProof walks one hand back four steps: the tell, the range, the equity, the exploit. ' +
  'Reviewing a hand you played is free there, however many you bring.';
