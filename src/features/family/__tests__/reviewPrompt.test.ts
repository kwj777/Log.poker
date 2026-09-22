/**
 * The flagged-hand review prompt: when it appears, and what it says.
 *
 * Two kinds of test here, and the split is deliberate. The first kind is over
 * `reviewPrompt` itself, which is pure and where the whole of "does this nag"
 * lives: a prompt that does not clear itself is the failure mode this feature
 * has, because `FamilyCrossPromo` promises the cross-promo in this app is
 * quiet and there is no store to remember a dismissal in.
 *
 * The second kind reads the card's source, the way the mid-session and
 * after-session blocks in `handOffs.test.ts` do, because *this file's* project
 * is plain ts-jest in Node and cannot render a component. The repository's
 * other project can, and does render this card, in
 * `__tests__/screens/reviewFlagged.test.tsx`. What is read here is the copy
 * and the rule that keeps the card off the screen at a table.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Hand, HandTag } from '../../../domain/types';
import {
  MAX_PROMPTED,
  REVIEW_WINDOW_MS,
  orderForReview,
  promptCopy,
  promptTitle,
  reviewPrompt,
} from '../reviewPrompt';

const source = (...parts: string[]): string =>
  readFileSync(join(__dirname, '..', '..', '..', '..', ...parts), 'utf8');

const NOW = 1_750_000_000_000;

let next = 0;
const hand = (over: Partial<Hand> = {}): Hand => {
  next += 1;
  return {
    id: `hand-${next}`,
    sessionId: 'session-1',
    holeCards: 'AsKd',
    board: null,
    position: 'BTN',
    note: null,
    tags: ['misplayed'] as HandTag[],
    amount: null,
    at: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
};

const ended = (at: number = NOW - 3_600_000) => ({ endedAt: at });

describe('when the review prompt appears', () => {
  it('offers the hands the player flagged on the session they just finished', () => {
    const prompt = reviewPrompt({
      session: ended(),
      hands: [hand(), hand({ tags: ['cooler'] }), hand()],
      now: NOW,
    });
    expect(prompt).not.toBeNull();
    expect(prompt?.count).toBe(2);
  });

  it('says nothing when no hand was flagged, which is the ordinary night', () => {
    // The common case by a distance, and the one the card has to be silent in.
    // A dashboard that carries a cross-promo card on every visit is the badge
    // and interstitial clutter `FamilyCrossPromo` says this app does not do.
    expect(
      reviewPrompt({ session: ended(), hands: [hand({ tags: [] }), hand({ tags: ['bluff'] })], now: NOW }),
    ).toBeNull();
  });

  it('stays quiet while the hands read is still out, rather than flashing empty', () => {
    // Null is "not read yet", which `useHandsForSession` is explicit is not
    // "none". Treating them alike would put a card on screen one frame after
    // the dashboard said there was nothing to do.
    expect(reviewPrompt({ session: ended(), hands: null, now: NOW })).toBeNull();
  });

  it('goes quiet by itself once the session is older than the window', () => {
    // The whole of the no-nagging argument. Nothing dismisses this card and
    // nothing can: there is no key-value store in this app to remember a
    // dismissal in, so the offer has to expire on its own or it is furniture.
    const stale = ended(NOW - REVIEW_WINDOW_MS - 1);
    expect(reviewPrompt({ session: stale, hands: [hand()], now: NOW })).toBeNull();

    const fresh = ended(NOW - REVIEW_WINDOW_MS + 1);
    expect(reviewPrompt({ session: fresh, hands: [hand()], now: NOW })).not.toBeNull();
  });

  it('never offers a session that has not been closed out', () => {
    // A live session reaches here only if the dashboard's own guard is removed,
    // and the answer is the same either way: `HandRow` turns its drill link off
    // mid-session because sending somebody to a training app at a table is the
    // last thing this app should do.
    expect(reviewPrompt({ session: { endedAt: null }, hands: [hand()], now: NOW })).toBeNull();
    expect(reviewPrompt({ session: null, hands: [hand()], now: NOW })).toBeNull();
  });

  it('names at most three hands and counts the rest', () => {
    const prompt = reviewPrompt({
      session: ended(),
      hands: [hand(), hand(), hand(), hand(), hand()],
      now: NOW,
    });
    expect(prompt?.hands).toHaveLength(MAX_PROMPTED);
    expect(prompt?.count).toBe(5);
  });
});

describe('which flagged hand is offered first', () => {
  it('leads with a hand that reached a flop, because that review can be finished', () => {
    // TiltProof's review grades a range against a board. A hand that ended
    // preflop opens the link and that app explains itself, but leading with one
    // hands the player a review they cannot complete. `links.ts` says out loud
    // that this call belongs on this side rather than in the URL builder.
    const preflop = hand({ board: null });
    const postflop = hand({ board: 'Kh7d2c' });
    expect(orderForReview([preflop, postflop])[0]).toBe(postflop);
  });

  it('puts a hand with no cards on it last, and still keeps it', () => {
    // The journal keeps hands somebody wrote a note about and never filled the
    // cards in for, and TiltProof has a screen that says so kindly. Fine to
    // arrive at, poor to be sent to first.
    const cardless = hand({ holeCards: null });
    const carded = hand({ holeCards: 'QhQs' });
    const ordered = orderForReview([cardless, carded]);
    expect(ordered[0]).toBe(carded);
    expect(ordered).toHaveLength(2);
  });

  it('leaves hands in the order they arrived when nothing separates them', () => {
    // `listHands` hands them over newest first and that is the right tiebreak:
    // the hand somebody is still annoyed about is usually the recent one.
    const first = hand({ board: 'Kh7d2c' });
    const second = hand({ board: 'Ad9s4h' });
    expect(orderForReview([first, second])).toEqual([first, second]);
  });
});

describe('what the review card says', () => {
  it('reads the count back as the player’s own tap', () => {
    expect(promptTitle(1)).toBe('You flagged a hand');
    expect(promptTitle(3)).toBe('You flagged 3 hands');
  });

  it('says a review is free, because over there every one of them is', () => {
    // Read off TiltProof rather than remembered. `canReview` and
    // `FREE_REVIEWS` are gone from that app's `entitlement.ts` and its
    // `PRICING.md` lists the review of a hand you played as free on both sides
    // of its table. What the pass sells there is levels 3, 4 and 5 and an
    // uncapped drill queue, neither of which this card is about.
    expect(promptCopy()).toMatch(/\bfree\b/i);
  });

  it('and does not tell anybody their second flagged hand costs money', () => {
    // The wording this replaced, which was true when it was written and false
    // within a day of shipping. It is the worse direction to be wrong in: the
    // card's whole job is getting a player to tap more than one hand, and it
    // was quietly charging them for the second. A claim about the far side's
    // pricing raises nothing on this side when it goes stale, so it is pinned
    // here.
    expect(promptCopy()).not.toMatch(/\bfirst\b/i);
    expect(promptCopy()).not.toMatch(/\bthe rest\b/i);
    expect(promptCopy()).not.toMatch(/\bpass\b/i);
  });

  it('and names no price, no purchase and no checkout', () => {
    // The constraint `SUBMISSION.md` records against App Store guideline
    // 3.1.1, and the same assertion the after-session card carries. Naming a
    // sister app's feature is an ordinary outbound link; selling it from
    // inside Log is what would cost the submission.
    for (const text of [promptCopy(), promptTitle(1), promptTitle(4)]) {
      expect(text).not.toMatch(/\$\s*\d/);
      expect(text).not.toMatch(
        /\b(buy|purchase|upgrade|subscribe|trial|unlock|checkout|sign up)\b/i,
      );
    }
  });

  it('spells the four steps TiltProof actually walks', () => {
    // Read off that app's `TREE_STEPS`, not guessed. A card that promises a
    // shape the far side does not have is the same class of silent wrongness
    // as a URL it does not serve.
    for (const step of ['tell', 'range', 'equity', 'exploit']) {
      expect(promptCopy().toLowerCase()).toContain(step);
    }
  });
});

describe('what the dashboard does not read to draw the card', () => {
  const dashboard = source('app', '(tabs)', 'index.tsx');

  it('reads one session’s hands, not every hand ever logged', () => {
    // The one thing about this feature that cannot be seen on the screen. The
    // store used to hold every hand in the log, which is what made a hand write
    // the most expensive write in the app, and `useHandsForSession` is the
    // bounded read that replaced it. A card on the dashboard is exactly the
    // kind of caller that would quietly bring the unbounded one back, and a
    // rendered test would pass either way.
    expect(dashboard).toContain('useHandsForSession(lastFinished?.id ?? null)');
    expect(dashboard).not.toMatch(/listHands\(\s*\)/);
  });

  it('and is counted among that hook’s callers, which it was not', () => {
    // `useHandsForSession`'s docstring said "the two callers both branch on
    // it" about the null-means-not-read-yet rule. This screen was the third,
    // and it branches indirectly -- `reviewPrompt` refuses a null `hands` on
    // its first line, which is what keeps the card off the screen in the frame
    // before the read lands. A headcount in a comment goes stale silently; the
    // rule does not.
    const store = source('src', 'store', 'useLogStore.ts');
    expect(store).not.toContain('The two callers');
    expect(store).toContain('Every caller branches on it');
  });
});
