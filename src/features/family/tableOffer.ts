/**
 * Whether a hand somebody just logged is worth offering a reset for, and what
 * the offer says.
 *
 * ## The moment this exists for
 *
 * `MidSessionCheckIn` is the app's only offer to a player still in their seat,
 * and it fires on a clock: two hours in, once, and only if the score they tap
 * is a 4 or a 5. That is a good prompt and it is a slow one. Tilt does not
 * arrive on the half-hour; it arrives on a hand, and this app already knows
 * which hand, because the player stopped to tag it.
 *
 * Tagging a hand *bad beat* or *cooler* is the sharpest signal Log collects.
 * It is a tap somebody made, at the table, in the minute after the thing
 * happened, and it means the game just did something to them. The timer may be
 * ninety minutes away, and the flagged-hands card on the dashboard is for the
 * next app open. Between the two there was nothing.
 *
 * ## Two tags and not four
 *
 * *bad beat* and *cooler* are claims about the runout -- the game did this.
 * The other two are not, and neither wants this offer:
 *
 *  - *misplayed?* is a claim about the player's own decision, and the app
 *    already keeps its promise about that one in `reviewPrompt.ts`, which
 *    brings the hand back and hands it to TiltProof. Answering "I think I got
 *    that wrong" with a breathing exercise points at the wrong sister app.
 *  - *bluff* is not a complaint at all. It is as often a hand somebody is
 *    pleased about, and an app that offered a reset for it would be reading
 *    the tag rather than the player.
 *
 * ## It is offered once in a session, and the session forgets
 *
 * A player taking three bad beats in an hour is the player this is for and
 * also the player a repeat would drive away. `FamilyCrossPromo` rules out
 * standing furniture and this app has no key-value store to remember a
 * dismissal in, so the bound is the same one `lastMidSessionPromptAt` uses:
 * a flag in the store that lives in memory and is cleared when a session
 * starts or ends. Nothing accumulates and nothing survives the night.
 *
 * ## Nothing about the hand crosses
 *
 * The same rule as every other hand-off in this folder. `tableHandOff` names a
 * lane and this app, and says nothing about what was tagged or what it cost.
 * Untilt asks how it landed in its own ten words on the screen the link opens,
 * which is a question Log has not asked here -- see that builder's header for
 * why this one sends a lane where the mid-session check-in sends an exercise.
 */

import type { HandTag } from '../../domain/types';

/**
 * The tags that mean the game did it to you.
 *
 * A constant rather than a literal inside the predicate, for the reason
 * `RATTLED_SCORES` is one: this is a product decision about which of four taps
 * summons a sister app, and it should be readable, testable and in one place.
 */
export const RATTLING_TAGS: readonly HandTag[] = ['bad_beat', 'cooler'];

/**
 * Whether the hand just saved is one of those.
 *
 * Any of them, not all: a hand tagged both a cooler and a bad beat is not less
 * of a reason to offer, and a player who added *misplayed?* to a bad beat has
 * not withdrawn the bad beat.
 */
export const wantsTableReset = (tags: readonly HandTag[]): boolean =>
  tags.some((tag) => RATTLING_TAGS.includes(tag));

/**
 * What the card says, in two sentences, and why neither is careful.
 *
 * This is the one offer in the app that has nothing to be careful about.
 * `postSessionHandOff` says "inside its pass" because every one of Untilt's
 * after-session wind-downs is premium, and `PreSessionWarmUp` says it for the
 * same reason about the preflight material. All seventy-nine of the
 * between-hands meditations are free, with no exception, so this may say free
 * and mean it -- which is also the promise the family's front doors already
 * make about the resets you reach for mid-session.
 *
 * It names no price and no checkout for the reason the rest of this folder
 * does not: see `SUBMISSION.md` on App Store guideline 3.1.1. There is nothing
 * here that would want to, which is the point of saying so.
 *
 * It says Untilt will ask, for `offerCopy`'s reason: a player who has just
 * told Log what happened and is then asked something over there has been asked
 * twice unless somebody says why. The two questions are different ones. Log
 * asked what the hand was; Untilt asks how it landed, in ten named states, and
 * it is the only one of the two that can pick from them.
 */
export const tableOfferCopy = (): string =>
  'That is the kind of hand that follows you around for an orbit. ' +
  'Untilt will ask how it landed and pick a reset to match. ' +
  'They are free, they need no account, and you never leave your seat.';
