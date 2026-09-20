/**
 * Which of the four tags summons a reset, and what the card says about it.
 *
 * The decision is two lines of code and it is a product decision about when
 * this app interrupts somebody who is still playing, which is the one thing
 * `MidSessionCheckIn` spends its whole header being careful about. So it is
 * pinned here rather than left to be read off a component this repository's
 * runner cannot render.
 *
 * `handOffs.test.ts` holds the other half: that the offer is made after the
 * hand is written, once in a session, and with a way out. This file is only
 * about which hands are worth making it for.
 */

import { HAND_TAGS, type HandTag } from '../../../domain/types';
import { RATTLING_TAGS, tableOfferCopy, wantsTableReset } from '../tableOffer';

describe('which hands are worth offering a reset for', () => {
  it('a bad beat and a cooler, because both are claims about the runout', () => {
    expect(wantsTableReset(['bad_beat'])).toBe(true);
    expect(wantsTableReset(['cooler'])).toBe(true);
  });

  it('and not a hand the player thinks they misplayed', () => {
    // That tag is a claim about their own decision, not about the game, and
    // the app already keeps its promise about it: `reviewPrompt.ts` brings the
    // hand back on the dashboard and hands it to TiltProof. Answering "I think
    // I got that wrong" with a breathing exercise points at the wrong sister
    // app.
    expect(wantsTableReset(['misplayed'])).toBe(false);
  });

  it('and not a bluff, which is as often a hand somebody is pleased about', () => {
    expect(wantsTableReset(['bluff'])).toBe(false);
  });

  it('nor an untagged hand, which is most of them', () => {
    // The common case, and the one that has to stay silent: the form's whole
    // brief is fifteen seconds, and a card after every save is furniture.
    expect(wantsTableReset([])).toBe(false);
  });

  it('any of them rather than all of them', () => {
    // A hand tagged both is not less of a reason, and a player who added
    // "misplayed?" to a bad beat has not withdrawn the bad beat.
    expect(wantsTableReset(['bad_beat', 'cooler'])).toBe(true);
    expect(wantsTableReset(['misplayed', 'bad_beat'])).toBe(true);
  });

  it('and the set is two of the four this app can record', () => {
    // Pinned against a tag being added to `HAND_TAGS` later and quietly
    // joining this list, or quietly not joining it, without anybody deciding.
    expect([...RATTLING_TAGS].sort()).toEqual(['bad_beat', 'cooler']);
    for (const tag of RATTLING_TAGS) {
      expect(HAND_TAGS).toContain(tag);
    }
    const quiet = HAND_TAGS.filter((tag: HandTag) => !RATTLING_TAGS.includes(tag));
    expect(quiet).toHaveLength(2);
  });
});

describe('what the at-the-table card says', () => {
  it('says the resets are free, because every between-hands one is', () => {
    // Read off Untilt rather than remembered: all seventy-nine of its
    // `phase: "mid"` meditations are `tier: "free"`, with no exception. This
    // is the one offer in the app with nothing to be careful about, and the
    // family's front doors already make that promise about mid-session resets.
    expect(tableOfferCopy()).toMatch(/\bfree\b/i);
  });

  it('and asks for nothing: no price, no purchase, no account', () => {
    // The same place `MidSessionCheckIn`'s copy is tested, and a place with an
    // obvious temptation: somebody who has just logged a bad beat is the most
    // sellable person this app ever sees. `SUBMISSION.md` records what that
    // temptation would cost against App Store guideline 3.1.1.
    expect(tableOfferCopy()).not.toMatch(/\$\s*\d/);
    expect(tableOfferCopy()).not.toMatch(
      /\b(buy|purchase|upgrade|subscribe|trial|unlock|checkout|sign up|sign in)\b/i,
    );
  });

  it('and says nothing about a pass, because nothing here is behind one', () => {
    expect(tableOfferCopy()).not.toMatch(/\bpass\b/i);
  });

  it('warns that Untilt asks its own question, so the second one is not a repeat', () => {
    // `offerCopy`'s reason. Log asked what the hand was; Untilt asks how it
    // landed, in ten named states, and it is the only one of the two that can
    // pick a meditation from the answer.
    expect(tableOfferCopy()).toMatch(/will ask how it landed/);
  });

  it('and promises no duration, because a lane is not one exercise', () => {
    // `resetHandOff` may say sixty seconds: it pins one meditation and that is
    // how long it is. This opens a screen of them at varying lengths, so a
    // number here would be a claim about whichever one Untilt picks.
    expect(tableOfferCopy()).not.toMatch(/\b(sixty|60|thirty|30|a minute)\b/i);
  });
});
