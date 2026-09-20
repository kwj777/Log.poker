/**
 * Where a hand-off goes, as pure functions over records.
 *
 * Split from `hooks.ts`, which imports `Linking` from react-native and so
 * cannot be loaded by this repository's test runner: the suite is plain ts-jest
 * in Node, deliberately, because everything worth testing here is pure
 * TypeScript. That one import made these URL builders untestable by accident of
 * sharing a file with a two-line wrapper, which is why they had no tests until
 * one of them started being offered to somebody mid-session.
 *
 * The opening half stayed behind. Building a URL and following one are
 * different jobs and only the first has anything to get wrong.
 *
 * The hand-off payload is the stable notation from `handNotation.ts` -- the
 * whole reason hands are stored in that format rather than as free text.
 */

import { FAMILY_LINKS } from '../../config';
import { cardsToNotation, isBoard, parseNotation, toHandClass } from '../../domain/handNotation';
import type { Hand, Position } from '../../domain/types';

export interface DrillHandOff {
  url: string;
  label: string;
  /** The hand class (`AKo`) when the cards are known, else null. */
  handClass: string | null;
}

/**
 * The screen on the far side of the hand-off, written out in full.
 *
 * Two things are pinned here and both were wrong at once, which is why this is
 * a constant with a test on it rather than a literal inside a template string.
 * The `/app` prefix is TiltProof's, recorded beside `FAMILY_LINKS`; `/review`
 * is the route, and it is the only one this hand-off may use. `/drill` was
 * neither: not under the prefix, and not a route in either place, since
 * TiltProof's `app/drill/[mode].tsx` wants a mode segment and does not count
 * `review` among its modes.
 *
 * Pinned for the same reason `RESET_MEDITATION_ID` is. The far side answers an
 * address it does not have with its own 404, so getting this wrong costs a
 * player the whole feature and costs this app no error at all.
 */
export const TILTPROOF_REVIEW = `${FAMILY_LINKS.tiltproofApp}/review`;

/**
 * Positions TiltProof's review spells differently from Log's record.
 *
 * Eight of the nine in `POSITIONS` are already the short form that side reads.
 * `UTG1` is the ninth, over there it is `UTG+1`, and a position that side does
 * not know is shown back to the player as typed rather than refused. So the
 * mismatch would be invisible from here and wrong on one seat in nine.
 */
const REVIEW_POSITIONS: Partial<Record<Position, string>> = { UTG1: 'UTG+1' };

/**
 * "Drill this in TiltProof" for a hand the player flagged as misplayed.
 *
 * Opens TiltProof's review on the spot, which is a real hand-off rather than a
 * greeting: `hand` and `position` are read on arrival and the player lands on
 * the hand they logged. Unknown parameters are ignored over there rather than
 * refused, so this can carry more than the review reads today without the link
 * breaking; `hand` is the one it cannot do without.
 *
 * **The exact cards, not the class.** Log stores `AsKd` and knows it, so
 * sending `AKo` throws away something it already has: a class is twelve
 * holdings, and the suits are what decide card removal and whether a board the
 * player types is even legal -- nobody holds `AhKs` on a board with the king of
 * spades in it. Sent as a class the review has to stop and ask which suits
 * these were. Sent whole, that screen never appears. The class stays on the
 * return value because the *label* wants it: "Drill AKo in TiltProof" is what a
 * person calls the hand.
 *
 * **The board is what makes it a spot rather than a holding.** `AKo` on the
 * button is a preflop class and there is only so much to drill about it; `AKo`
 * on the button on a king-high flop is a decision somebody made. Sent only
 * when it is a board -- a half-typed one would describe a runout that did not
 * happen, and the far side has no way to tell.
 *
 * **The note deliberately does not cross.** It is free text a player wrote
 * about their own play, a query string lands in browser history and in every
 * log that sees the URL, and the review works without it. Same call, for the
 * same reason, as keeping the mood score out of `resetHandOff`.
 *
 * Worth knowing and not enforced here: the review is postflop only, because it
 * grades against a range written on the screen and preflop that is 1,712,304
 * runouts per combination rather than 990. A hand that ended preflop still
 * opens the link; the player just cannot finish the review. Whether Log should
 * offer the hand-off on such a hand at all is a question for `HandRow`, not for
 * the URL builder.
 */
export const drillHandOff = (hand: Pick<Hand, 'holeCards' | 'board' | 'position'>): DrillHandOff => {
  const cards = parseNotation(hand.holeCards);
  const holding = cards !== null && cards.length === 2 ? cardsToNotation(cards) : null;
  const handClass = toHandClass(holding);

  const params = new URLSearchParams({ source: 'log' });
  if (holding !== null) params.set('hand', holding);
  if (hand.position !== null) {
    params.set('position', REVIEW_POSITIONS[hand.position] ?? hand.position);
  }
  if (isBoard(hand.board)) params.set('board', hand.board as string);

  return {
    url: `${TILTPROOF_REVIEW}?${params.toString()}`,
    label: handClass === null ? 'Drill this spot in TiltProof' : `Drill ${handClass} in TiltProof`,
    handClass,
  };
};

/**
 * The Untilt suggestion shown when the variance view finds a rough stretch.
 * Post-MVP this passes the stretch itself so Untilt can open on the right
 * exercise instead of the front page.
 */
export const untiltHandOff = (verdict: string): { url: string; label: string } => ({
  url: `${FAMILY_LINKS.untilt}?source=log&context=${encodeURIComponent(verdict)}`,
  label: 'Open Untilt.poker',
});

/**
 * The meditation Untilt opens for a mid-session reset.
 *
 * Verified rather than guessed. Untilt's own `#quick-reset` button opens this
 * id, it appears in that app's `SAMPLE_IDS`, which its source documents as
 * "the free meditation a sample comes from", and its `isLocked` only ever
 * returns true for a premium meditation with no cues. So this is free, it needs
 * no account, and it is sixty seconds, which is what makes it the right thing
 * to put in front of somebody sitting at a table.
 *
 * An id Untilt does not recognize fails safe over there: `readArrival` resolves
 * it to null and the app opens normally. That is worth knowing but is not a
 * reason to be careless, because the failure is silent.
 */
export const RESET_MEDITATION_ID = 'sixty-second-reset';

/**
 * "Take sixty seconds", for a player who just logged that they are rattled.
 *
 * `play=<id>` is Untilt's shareable form of a meditation, so this lands in the
 * exercise rather than on a home screen the player then has to navigate. The
 * mood score is deliberately **not** in the URL: nothing over there reads it,
 * Untilt strips the whole query on arrival anyway, and a link that says out
 * loud how tilted somebody is has no business being in an address bar or a
 * browser history.
 */
export const resetHandOff = (): { url: string; label: string } => ({
  url: `${FAMILY_LINKS.untilt}?source=log&play=${RESET_MEDITATION_ID}`,
  label: 'Take sixty seconds',
});

/**
 * The Untilt lane a player is sent to once they have closed out a session.
 *
 * A lane rather than a meditation, and that is the whole design. `play=<id>`
 * lands in one exercise, which is right for the mid-session reset because
 * there is exactly one right answer there: sixty seconds, free, at a table.
 * After a session there are thirty-three wind-downs and which one fits
 * depends on how the night went -- and Untilt asks that itself, on the screen
 * this lane opens, in its own ten words for it. Log knows a number from 1 to
 * 5 and could not pick between "self-critical" and "drained" from it.
 *
 * So there is no id to pin here, which is the second reason. An id Untilt
 * does not recognize resolves to null over there and opens the app normally,
 * so a guess fails silently and costs a player the whole feature.
 *
 * `after` is the id of Untilt's "I just finished" lane, in its own `LANES`.
 * An unknown lane is ignored over there and the app opens on its home screen,
 * where that lane is the third card, so this degrades to the landing it had
 * before rather than to nothing.
 */
export const UNTILT_POST_LANE = 'after';

/**
 * What a player is offered when they close out a session, win or lose.
 *
 * Unlike `resetHandOff`, which is for somebody rattled at a table and points
 * at the free sixty-second reset, this is the after-session offer and the
 * material behind it is inside Untilt's pass. Every one of the wind-downs is,
 * with no free exception, which is why the copy says so rather than leaving
 * anybody to find out on arrival. Two more things follow.
 *
 * **It says nothing about price and links to no checkout.** `SUBMISSION.md`
 * records why: App Store guideline 3.1.1 is about an app steering a customer
 * to a purchase it does not take through Apple, and the distance between "this
 * exists over there" and "buy it here" is the whole of what keeps an outbound
 * link to a sister app an ordinary link. Nothing in Log is sold or unlocked
 * either way, which stays true with this card on the screen.
 *
 * **Nothing about the session crosses.** Not the result, not the mood, not the
 * venue. `lane` names a screen and `source` names this app; neither says
 * anything about this player's night. The mood is the tempting one and it
 * stays out for the same reason it stays out of `resetHandOff`: a query
 * string lands in browser history and in every log that sees the URL, and
 * Untilt is about to ask the question in its own vocabulary anyway.
 */
export const postSessionHandOff = (paid: boolean): { url: string; label: string } => {
  const params = new URLSearchParams({ source: 'log', lane: UNTILT_POST_LANE });

  return {
    url: `${FAMILY_LINKS.untilt}?${params.toString()}`,
    label: paid ? 'Open your wind-down' : 'Find a wind-down',
  };
};
