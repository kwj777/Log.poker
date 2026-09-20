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
 *
 * The only hand-off in this file that names no destination, and that is the
 * honest answer rather than a gap. Untilt's lanes are the three phases of a
 * session plus the library; a player reading their own variance at home is in
 * none of them, so this lands on "What are you here for?", which is the
 * question they are actually at. A lane invented to avoid an unparameterized
 * link would be a worse screen chosen to look like a better link.
 *
 * **It used to carry `context=<verdict>` and that parameter was never read.**
 * Untilt's `readArrival` speaks `welcome`, `play` and `lane`, and strips the
 * whole query on arrival; the verdict reached nothing over there for the whole
 * time it shipped. What it did do was put the state of somebody's downswing in
 * an address bar and a browser history, which is the thing `resetHandOff` and
 * `postSessionHandOff` each go out of their way not to do. So it is gone, and
 * this takes no argument, because there is nothing left for one to say.
 */
export const untiltHandOff = (): { url: string; label: string } => ({
  url: `${FAMILY_LINKS.untilt}?source=log`,
  label: 'Open Untilt.poker',
});

/**
 * The Untilt lane for the minutes before a player sits down.
 *
 * `preflight` is the id of Untilt's "I am about to play" lane, in its own
 * `LANES`, and the screen it opens says "Set it up now, while deciding
 * anything is still cheap." That sentence is why this hand-off exists: it is
 * the only moment in a session where the useful advice is still a decision
 * rather than a consolation, which is the same argument `mood.ts` makes for
 * grouping on the start score and not the end one.
 *
 * A lane rather than a meditation, for `postSessionHandOff`'s reason and one
 * more of its own. Every one of Untilt's thirty-five before-the-session
 * meditations is premium, so there is no free id to pin even if pinning one
 * were right -- and a player who has not bought the library still gets a
 * playable row, because `preflightFallback` over there puts the free
 * between-hands reset under the suggestions rather than leaving them a screen
 * they can only look at. So this degrades to something usable rather than to a
 * wall, and the copy at the call site says which is which.
 *
 * Nothing about the session crosses, the same as every other hand-off here.
 * The mood that summoned this is a 4 or a 5 on Log's own scale and it stays on
 * Log's side of the link.
 */
export const UNTILT_PRE_LANE = 'preflight';

export const preSessionHandOff = (paid: boolean): { url: string; label: string } => {
  const params = new URLSearchParams({ source: 'log', lane: UNTILT_PRE_LANE });

  return {
    url: `${FAMILY_LINKS.untilt}?${params.toString()}`,
    label: paid ? 'Open your warm-up' : 'Find a warm-up',
  };
};

/**
 * The Untilt lane for a player still in their seat.
 *
 * `table` is the id of Untilt's "I am at the table" lane, whose own blurb is
 * "A reset between hands. You never have to leave your seat." Offered after a
 * hand is logged as a bad beat or a cooler, which is the app's most reliable
 * signal that the game has just done something to somebody -- earlier and
 * sharper than the two-hour timer `MidSessionCheckIn` waits on.
 *
 * **There is no paid branch and no sentence about a pass, because there is
 * nothing here that is not free.** All seventy-nine of Untilt's between-hands
 * meditations are, with no exception, which makes this the one hand-off in the
 * family that needs no care about what it is promising. `postSessionHandOff`
 * carries "inside its pass" because every wind-down is premium; the mirror of
 * that fact is that this one may say free and mean it.
 *
 * **A lane and not `RESET_MEDITATION_ID`, which is the harder call**, since
 * that id is free, sixty seconds, and already pointed at from this app. The
 * difference is what Log has already asked. `resetHandOff` follows a check-in
 * where the player has just answered a 1-to-5, so sending them to a screen
 * that asks how they feel would be asking the same thing twice and the pinned
 * exercise is right. Here Log has asked nothing about how they feel -- only
 * what happened at the table -- so Untilt's mood screen is the first time
 * anybody asks, and it can tell "just took a brutal one" from "beating
 * yourself up" in its own ten words where a tag cannot. Same call, for the
 * same reason, as `UNTILT_POST_LANE`.
 */
export const UNTILT_TABLE_LANE = 'table';

export const tableHandOff = (): { url: string; label: string } => {
  const params = new URLSearchParams({ source: 'log', lane: UNTILT_TABLE_LANE });

  return { url: `${FAMILY_LINKS.untilt}?${params.toString()}`, label: 'Pick a reset' };
};

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
