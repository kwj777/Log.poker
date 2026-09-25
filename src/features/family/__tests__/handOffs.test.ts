/**
 * The links out of this app, and the one that opens mid-session.
 *
 * These had no tests, which was tolerable while they were cross-promo buttons
 * on a review screen and is not now: `resetHandOff` is offered to somebody
 * sitting at a table who has just said they are rattled, and a dead link or a
 * paywall at that moment is worse than no offer at all.
 *
 * The mid-session card itself is read rather than rendered, the same way
 * `endpoint.test.ts` reads the function it cannot call: this repository has no
 * component renderer. What is read is one property, and it is the property the
 * whole feature is safe or unsafe on.
 *
 * The TiltProof block below is the other half of that argument and was learned
 * the expensive way. `drillHandOff` pointed at an address that app has never
 * served, for the whole time it shipped, and nothing here noticed -- a wrong URL
 * raises nothing on this side and renders a 404 on the far one. So the emitted
 * address and the whole parameter set are pinned literally, not sampled.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FAMILY_LINKS } from '../../../config';
import { POSITIONS } from '../../../domain/types';
import {
  RESET_MEDITATION_ID,
  TILTPROOF_REVIEW,
  UNTILT_POST_LANE,
  UNTILT_PRE_LANE,
  UNTILT_TABLE_LANE,
  drillHandOff,
  postSessionHandOff,
  preSessionHandOff,
  resetHandOff,
  tableHandOff,
  untiltHandOff,
} from '../links';

const source = (...parts: string[]): string =>
  readFileSync(join(__dirname, '..', '..', '..', '..', ...parts), 'utf8');

describe('the sixty-second reset', () => {
  it('opens Untilt straight into the exercise rather than at its front page', () => {
    // `play=<id>` is Untilt's shareable form of a meditation. Landing on a home
    // screen and asking somebody mid-session to go and find the right thing is
    // most of the way to not offering it.
    const { url } = resetHandOff();
    expect(url.startsWith(FAMILY_LINKS.untilt)).toBe(true);
    expect(new URL(url).searchParams.get('play')).toBe(RESET_MEDITATION_ID);
  });

  it('names the meditation Untilt itself treats as the free one', () => {
    // Checked against that app rather than assumed: its own quick-reset button
    // opens this id, and it is listed there among the meditations a free sample
    // is drawn from. If Untilt ever renames it the link fails safe, opening the
    // app normally, which is silent -- hence pinning the string here.
    expect(RESET_MEDITATION_ID).toBe('sixty-second-reset');
  });

  it('does not put the player’s mood in the address', () => {
    // Nothing over there reads it and Untilt strips the whole query on arrival,
    // so it would buy nothing. What it would cost is a URL that says out loud
    // how tilted somebody is, sitting in an address bar and a browser history.
    const url = new URL(resetHandOff().url);
    expect(url.searchParams.get('mood')).toBeNull();
    expect(url.search).not.toMatch(/\b[45]\b/);
  });

  it('says what it is in the label, without a number or a verb about buying', () => {
    expect(resetHandOff().label).toMatch(/sixty seconds/i);
    expect(resetHandOff().label).not.toMatch(/\$|\b(buy|try|upgrade|unlock)\b/i);
  });
});

describe('the TiltProof hand-off', () => {
  const spot = (over: Partial<Parameters<typeof drillHandOff>[0]> = {}) =>
    drillHandOff({ holeCards: 'AsKd', board: null, position: 'BTN', ...over });

  const query = (over?: Partial<Parameters<typeof drillHandOff>[0]>) =>
    new URL(spot(over).url).searchParams;

  it('lands on the review, under the /app prefix that is TiltProof’s app', () => {
    // Both halves of this were wrong at once and each alone was enough to break
    // it: `/drill` is not a route over there, and nothing outside `/app` reaches
    // that app at all -- it answers with its own 404. Pinned whole, because a
    // wrong address here fails silently on the far side and never here.
    expect(TILTPROOF_REVIEW).toBe('https://tiltproof.poker/app/review');

    const url = new URL(spot().url);
    expect(url.origin).toBe(FAMILY_LINKS.tiltproof);
    expect(url.pathname).toBe('/app/review');
  });

  it('sends the exact cards, because Log has them and a class is twelve hands', () => {
    // The suits are not decoration: they decide card removal, and they decide
    // whether a board the player types is even legal -- nobody holds `AhKs` on a
    // board containing the king of spades. Sent as `AKo` the review has to stop
    // and ask which twelve it was.
    expect(query().get('hand')).toBe('AsKd');
    expect(query({ holeCards: 'Th9h' }).get('hand')).toBe('Th9h');
    expect(query({ holeCards: '7c7d' }).get('hand')).toBe('7c7d');
  });

  it('and never the class, which is the shape this used to send', () => {
    expect(query().get('hand')).not.toBe('AKo');
    expect(query({ holeCards: 'Th9h' }).get('hand')).not.toBe('T9s');
  });

  it('still calls the hand what a person calls it, in the label', () => {
    // The class is the right thing to say out loud even though it is the wrong
    // thing to send, so it stays on the return value for the label's sake.
    const handOff = spot();
    expect(handOff.handClass).toBe('AKo');
    expect(handOff.label).toBe('Review AKo in TiltProof');
  });

  it('says nothing about a hand it was never given', () => {
    // The far side answers a link with no hand with "That link is missing the
    // hand", which is the honest outcome: a hand logged without cards has no
    // spot to review.
    expect(query({ holeCards: null }).get('hand')).toBeNull();
    expect(spot({ holeCards: null }).handClass).toBeNull();
    expect(spot({ holeCards: null }).label).toBe('Review this hand in TiltProof');
  });

  it('spells every seat Log can record the way the review reads it', () => {
    // Eight of the nine already match. `UTG1` is the ninth, and a position that
    // side does not know is shown back as typed rather than refused, so the
    // mismatch would never surface from here. Looped over `POSITIONS` so adding
    // a tenth seat has to answer this question too.
    const understood = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    for (const position of POSITIONS) {
      expect(understood).toContain(query({ position }).get('position'));
    }
    expect(query({ position: 'UTG1' }).get('position')).toBe('UTG+1');
    expect(query({ position: 'BTN' }).get('position')).toBe('BTN');

    // And percent-encoded on the wire, which is not a detail to tidy away: a
    // raw `+` in a query string decodes as a space, so `UTG+1` written out
    // literally arrives as `UTG 1`. `URLSearchParams` gets this right and
    // hand-built string concatenation is where it would stop being right.
    expect(spot({ position: 'UTG1' }).url).toContain('position=UTG%2B1');
  });

  it('carries the board too, which is what makes it a spot', () => {
    // `AKo` on the button is a holding. `AKo` on the button on a king-high
    // flop is a decision somebody made, which is the thing there is to drill.
    expect(query({ board: '7c2sKh' }).get('board')).toBe('7c2sKh');
  });

  it('but never a half-typed one, which would describe a runout that did not happen', () => {
    // Two cards is somebody who stopped tapping, and the far side has no way
    // to tell that from a flop.
    expect(query({ board: '7c2s' }).get('board')).toBeNull();
  });

  it('and says nothing about a board when there is none', () => {
    expect(query().get('board')).toBeNull();
  });

  it('puts nothing in the address the player wrote about their own play', () => {
    // The note is optional over there and this is Log's call, not TiltProof's:
    // a query string lands in a browser history and in every log that sees the
    // URL, and the review works without it. Same reasoning as keeping the mood
    // score out of `resetHandOff`, and pinned as the whole set of parameters so
    // that adding one later is a decision somebody makes rather than a default.
    const keys = [...query({ board: '7c2sKh' }).keys()].sort();
    expect(keys).toEqual(['board', 'hand', 'position', 'source']);
    expect(spot({ board: '7c2sKh' }).url).not.toMatch(/note/i);
  });

  it('says where it came from', () => {
    expect(query().get('source')).toBe('log');
  });
});

describe('what the mid-session card does with a tap', () => {
  const card = source('src', 'features', 'sessions', 'MidSessionCheckIn.tsx');
  const record = card.slice(card.indexOf('const record ='), card.indexOf('if (offered !== null)'));

  it('records it before anything else looks at it', () => {
    // The property this whole feature is safe or unsafe on. `MoodPicker` says
    // mood data is only useful if logging it costs nothing, so a check-in that
    // summons something *before* recording is one people answer with a 3 to be
    // left alone, and the correlation the data exists for dies quietly.
    const logged = record.indexOf('logMood(');
    const decided = record.indexOf('wantsReset(');
    expect(logged).toBeGreaterThan(-1);
    expect(decided).toBeGreaterThan(logged);
  });

  it('and records it unconditionally, with nothing to fail in front of it', () => {
    const before = record.slice(0, record.indexOf('logMood('));
    expect(before).not.toMatch(/\b(if|return|await|&&|\?\?|\?)\b/);
  });

  it('only offers the reset behind the shared definition of rattled', () => {
    // `wantsReset` rather than a literal 4 or 5 here, so the score that counts
    // as rattled for tonight's offer is the same one that counts as rattled in
    // the month-end comparison.
    expect(record).toContain('if (wantsReset(score)) setOffered(score);');
    expect(card).not.toMatch(/score >= 4|score === 4|\[4, 5\]/);
  });
});

describe('what the mid-session card says', () => {
  const card = source('src', 'features', 'sessions', 'MidSessionCheckIn.tsx');
  const offer = card.slice(card.indexOf('Logged.'), card.indexOf('</Card>'));

  it('says the reset is free rather than leaving somebody to wonder', () => {
    expect(offer).toMatch(/\bfree\b/i);
  });

  it('and asks for nothing: no price, no purchase, no address', () => {
    // The creed's promise is that the resets reached for mid-session are free
    // across the family. This is the place that promise is kept or broken, and
    // it is a place with an obvious temptation, two hours into a losing night.
    expect(offer).not.toMatch(/\$\s*\d/);
    expect(offer).not.toMatch(/\b(buy|purchase|upgrade|subscribe|trial|sign up|sign in)\b/i);
  });

  it('and leaves as easily as it arrived', () => {
    expect(offer).toContain('Back to the game');
  });
});

describe('the after-session offer', () => {
  it('opens the lane that asks how the night went', () => {
    // A lane rather than a meditation, because there are thirty-three
    // wind-downs and which one fits depends on the answer to a question only
    // Untilt asks. `after` is the id of its "I just finished" lane.
    for (const paid of [false, true]) {
      const url = new URL(postSessionHandOff(paid).url);
      expect(url.origin + url.pathname).toBe(new URL(FAMILY_LINKS.untilt).origin + '/');
      expect(url.searchParams.get('lane')).toBe(UNTILT_POST_LANE);
      expect(url.searchParams.get('source')).toBe('log');
    }
  });

  it('names the lane Untilt itself calls the after-session one', () => {
    // Checked against that app rather than assumed, the way
    // `RESET_MEDITATION_ID` is. A lane Untilt does not know is ignored over
    // there and the app opens on its home screen, which is silent from here.
    expect(UNTILT_POST_LANE).toBe('after');
  });

  it('sends no meditation id, because there is no right one to send', () => {
    // Every after-session meditation is inside the pass and which of them
    // fits is the question the lane exists to ask. A `play` here would answer
    // it on the player's behalf and would be wrong most of the time.
    for (const paid of [false, true]) {
      expect(new URL(postSessionHandOff(paid).url).searchParams.get('play')).toBeNull();
    }
  });

  it('carries nothing about the night that was just logged', () => {
    // The same rule as the mid-session reset, for the same reason: a query
    // string lands in an address bar and in every log that sees the URL. The
    // mood is the tempting one, and Untilt is about to ask for it in its own
    // vocabulary anyway.
    for (const paid of [false, true]) {
      const url = new URL(postSessionHandOff(paid).url);
      for (const leak of ['mood', 'result', 'net', 'stakes', 'venue', 'session']) {
        expect(url.searchParams.get(leak)).toBeNull();
      }
    }
  });

  it('is the same address for a player who has paid and one who has not', () => {
    // The lane is right for both. Somebody without the pass arrives at
    // Untilt's own account of what the wind-downs are, plus a free reset
    // matched to the mood they just picked, which is better than anything
    // this app could write and is written where the library is known.
    expect(postSessionHandOff(true).url).toBe(postSessionHandOff(false).url);
  });

  it('names no price and no verb about buying, on either branch', () => {
    for (const paid of [false, true]) {
      expect(postSessionHandOff(paid).label).not.toMatch(
        /\$|\b(buy|purchase|upgrade|subscribe|trial|unlock)\b/i,
      );
    }
  });
});

describe('what the after-session card says', () => {
  const card = source('src', 'features', 'sessions', 'PostSessionReset.tsx');
  const copy = card.slice(card.indexOf('export const offerCopy'), card.indexOf('export const PostSessionReset'));

  it('offers the same thing after a win as after a loss', () => {
    // The brief is "after a session, good or bad". A card that only appears
    // after a losing night is a card that tells somebody they lost.
    expect(copy).toMatch(/win or lose/i);
    expect(card).not.toMatch(/\bnet\b|\bwon\b|cashOut|resultColor/);
  });

  it('says the material is inside the pass rather than pretending it is free', () => {
    expect(copy).toMatch(/\bpass\b/);
    expect(copy).not.toMatch(/\bfree\b/i);
  });

  it('and still names no price, no checkout and no purchase', () => {
    // `SUBMISSION.md` records why the distance matters: App Store guideline
    // 3.1.1 is about steering a customer to a purchase Apple does not take.
    // Saying a sister app has something is not that. Selling it here is.
    expect(copy).not.toMatch(/\$\s*\d/);
    expect(copy).not.toMatch(/\b(buy|purchase|upgrade|subscribe|trial|checkout|sign up)\b/i);
  });

  it('does not sell the pass to somebody who already has it', () => {
    expect(copy).toContain('Your pass');
  });

  it('warns that Untilt asks its own question, so the second one is not a repeat', () => {
    // This card follows the cash-out sheet's "how are you leaving?", and the
    // lane opens on "how are you feeling?". Two moods in a row reads as a bug
    // unless the first screen says the second one is coming.
    expect(copy).toMatch(/will ask how it went/);
  });

  it('and leaves as easily as it arrived', () => {
    expect(card).toContain('Not now');
  });
});

describe('when the after-session card is allowed on screen', () => {
  const detail = source('app', 'session', '[id].tsx');
  const active = source('app', 'session', 'active.tsx');

  it('only for the session that was just closed out', () => {
    // The detail screen is also where History lands. Without the guard this
    // offers a wind-down for a night three weeks gone, every time.
    expect(detail).toContain("{ended === '1' && !live ? <PostSessionReset /> : null}");
  });

  it('and cash-out is the only thing that says so', () => {
    expect(active).toContain('router.replace(`/session/${session.id}?ended=1`);');
  });
});

describe('the variance-screen link, which names no destination', () => {
  it('carries nothing about the stretch that summoned it', () => {
    // It used to send `context=running_bad`. Untilt's `readArrival` speaks
    // `welcome`, `play` and `lane` and strips the whole query on arrival, so
    // the verdict reached nothing over there for the whole time it shipped --
    // while sitting in an address bar and a browser history saying how badly
    // this player is doing. The same call `resetHandOff` makes about a mood.
    const url = new URL(untiltHandOff().url);
    expect(url.searchParams.get('context')).toBeNull();
    expect([...url.searchParams.keys()]).toEqual(['source']);
  });

  it('takes no argument, because there is nothing left for one to say', () => {
    // Pinned so a caller cannot quietly start passing the verdict again.
    expect(untiltHandOff).toHaveLength(0);
  });

  it('and still says where it came from', () => {
    expect(new URL(untiltHandOff().url).searchParams.get('source')).toBe('log');
  });
});

describe('the before-the-session offer', () => {
  it('opens the lane for somebody who has not sat down yet', () => {
    const url = new URL(preSessionHandOff(false).url);
    expect(url.origin + url.pathname).toBe(new URL(FAMILY_LINKS.untilt).origin + '/');
    expect(url.searchParams.get('lane')).toBe(UNTILT_PRE_LANE);
  });

  it('names the lane Untilt itself calls the before-the-session one', () => {
    // Read off that app's `LANES`, where `preflight` is "I am about to play".
    // An unknown lane is ignored over there and the app opens on its home
    // screen, so a guess costs the player the feature and costs this app no
    // error at all -- the same silent failure `RESET_MEDITATION_ID` is pinned
    // against.
    expect(UNTILT_PRE_LANE).toBe('preflight');
  });

  it('sends no meditation id, because every one of them is premium', () => {
    // All thirty-five of Untilt's before-the-session meditations are inside
    // the pass, so there is no free id to pin even if pinning one were right.
    // What that screen does have is `preflightFallback`, which puts the free
    // between-hands reset under the suggestions -- so the landing is Untilt's
    // to choose and it is never a screen with nothing playable on it.
    expect(new URL(preSessionHandOff(false).url).searchParams.get('play')).toBeNull();
  });

  it('carries nothing about the night that has not happened yet', () => {
    // The mood that summoned this is a 4 or a 5 on Log's own scale, and it
    // stays here. Same rule as `resetHandOff` and `postSessionHandOff`.
    for (const paid of [true, false]) {
      const params = new URL(preSessionHandOff(paid).url).searchParams;
      expect([...params.keys()].sort()).toEqual(['lane', 'source']);
    }
  });

  it('is the same address for a player who has paid and one who has not', () => {
    expect(preSessionHandOff(true).url).toBe(preSessionHandOff(false).url);
    expect(preSessionHandOff(true).label).not.toBe(preSessionHandOff(false).label);
  });

  it('names no price and no verb about buying, on either branch', () => {
    for (const paid of [true, false]) {
      expect(preSessionHandOff(paid).label).not.toMatch(
        /\$|\b(buy|purchase|upgrade|subscribe|trial|unlock)\b/i,
      );
    }
  });
});

describe('what the before-the-session card says', () => {
  const card = source('src', 'features', 'sessions', 'PreSessionWarmUp.tsx');
  const copy = card.slice(card.indexOf('export const warmUpCopy'), card.indexOf('interface PreSessionWarmUpProps'));

  it('says the material is inside the pass rather than pretending it is free', () => {
    expect(copy).toMatch(/\bpass\b/);
  });

  it('and still tells an unpaid player what they can actually play there', () => {
    // The one way this differs from the after-session card, and it is a fact
    // about Untilt rather than a softener: `preflightFallback` puts the free
    // between-hands reset on that screen for somebody without the pass. A card
    // that implied a wall would be talking them out of a tap that works.
    expect(copy).toMatch(/free between-hands reset/);
  });

  it('and names no price, no checkout and no purchase', () => {
    expect(copy).not.toMatch(/\$\s*\d/);
    expect(copy).not.toMatch(/\b(buy|purchase|upgrade|subscribe|trial|checkout|sign up)\b/i);
  });

  it('does not sell the pass to somebody who already has it', () => {
    expect(copy).toContain('Your pass');
  });
});

describe('when the before-the-session card is allowed on screen', () => {
  const card = source('src', 'features', 'sessions', 'PreSessionWarmUp.tsx');
  const screen = source('app', 'session', 'new.tsx');

  it('only behind the shared definition of rattled', () => {
    // `wantsReset` rather than a literal, so the score that opens this is the
    // same one that opens the mid-session reset and the same one that groups a
    // session as rattled in the month-end comparison.
    expect(card).toContain('!wantsReset(mood)');
    expect(card).not.toMatch(/mood >= 4|mood === 4|\[4, 5\]/);
  });

  it('and it cannot make a 5 costlier to tap than a 3', () => {
    // The failure this card could cause is silent and permanent: the start
    // scores are what `mood.ts` computes the whole tilt-cost comparison from,
    // and an offer with a dismiss control on it teaches players to answer the
    // picker with a 3 to be left alone. So it has no way to be tapped past,
    // and the Start button is in the screen's footer where this cannot move
    // it.
    expect(card).not.toMatch(/Not now|Dismiss|setDismissed/);
    expect(screen).toContain('<PreSessionWarmUp mood={mood} />');
    expect(screen).toMatch(/footer=\{/);
  });

  it('and draws nothing until it knows which sentence is true', () => {
    // `PostSessionReset`'s call, for its reason: null is "not read yet", not
    // "has not paid", and a wrong sentence for one frame is the failure that
    // card's tests already exist to prevent.
    expect(card).toContain('paid === null) return null');
  });
});

describe('the at-the-table offer', () => {
  it('opens the lane for somebody still in their seat', () => {
    const url = new URL(tableHandOff().url);
    expect(url.origin + url.pathname).toBe(new URL(FAMILY_LINKS.untilt).origin + '/');
    expect(url.searchParams.get('lane')).toBe(UNTILT_TABLE_LANE);
  });

  it('names the lane Untilt itself calls the at-the-table one', () => {
    // `table` is "I am at the table" in that app's `LANES`, whose own blurb is
    // "A reset between hands. You never have to leave your seat."
    expect(UNTILT_TABLE_LANE).toBe('table');
  });

  it('sends a lane and not the sixty-second reset, which is the harder call', () => {
    // That id is free, sixty seconds and already pointed at from this app, so
    // it is the tempting answer. The difference is what Log has already asked.
    // `resetHandOff` follows a check-in where the player has just answered a
    // 1-to-5, so a second mood question would be a repeat. Here Log has asked
    // only what happened at the table, so Untilt's mood screen is the first
    // time anybody asks -- and it can tell "just took a brutal one" from
    // "beating yourself up" where a tag cannot.
    expect(new URL(tableHandOff().url).searchParams.get('play')).toBeNull();
  });

  it('carries nothing about the hand that was just tagged', () => {
    expect([...new URL(tableHandOff().url).searchParams.keys()].sort()).toEqual([
      'lane',
      'source',
    ]);
  });

  it('and has no paid branch, because there is nothing here that is not free', () => {
    // All seventy-nine of Untilt's between-hands meditations are free, with no
    // exception. `postSessionHandOff` takes a `paid` because every wind-down is
    // premium; the mirror of that fact is that this one needs no such argument
    // and no sentence about a pass.
    expect(tableHandOff).toHaveLength(0);
    expect(tableHandOff().label).not.toMatch(
      /\$|\b(buy|purchase|upgrade|subscribe|trial|unlock|pass)\b/i,
    );
  });
});

describe('when the at-the-table offer is allowed on screen', () => {
  const screen = source('app', 'session', 'hand.tsx');
  const save = screen.slice(screen.indexOf('const save ='), screen.indexOf('if (offered)'));
  const store = source('src', 'store', 'useLogStore.ts');

  it('decides only after the hand is written', () => {
    // `MidSessionCheckIn`'s rule, applied to the other write a player makes at
    // a table. A hand this screen made harder to save is a hand that does not
    // get logged, and the whole brief for this form is fifteen seconds.
    const written = save.indexOf('logHand(');
    const decided = save.indexOf('wantsTableReset(');
    expect(written).toBeGreaterThan(-1);
    expect(decided).toBeGreaterThan(written);
    expect(save.slice(0, written)).not.toContain('wantsTableReset');
  });

  it('behind the shared definition of which tags mean the game did it to you', () => {
    // Not a literal, so the two tags that summon this are readable in one
    // place. `misplayed?` is deliberately not among them: that one is a claim
    // about the player's own decision and `reviewPrompt.ts` already keeps the
    // app's promise about it, by handing the hand to TiltProof.
    expect(save).toContain('wantsTableReset(tags)');
    expect(screen).not.toMatch(/tags\.includes\('bad_beat'\)|tags\.includes\('cooler'\)/);
  });

  it('once in a session, and never twice on a bad run', () => {
    // A player taking three bad beats in an hour is exactly who this is for
    // and exactly who a repeat would drive away. `FamilyCrossPromo` rules out
    // standing furniture and this app has no key-value store to remember a
    // dismissal in, so the bound is the session.
    expect(save).toContain('tableOfferMadeAt === null');
    expect(save).toContain('markTableOffer()');
  });

  it('and the session is what forgets it, at both ends', () => {
    // Cleared by the same two writes that clear the mid-session prompt, so a
    // player who starts a second session tonight is offered it again and one
    // who reopens the app tomorrow is not carrying anything.
    expect(store).toContain('set({ lastMidSessionPromptAt: null, tableOfferMadeAt: null });');
    expect(store.match(/tableOfferMadeAt: null \}\);/g) ?? []).toHaveLength(2);
  });

  it('and leaves as easily as it arrived', () => {
    expect(screen).toContain('Back to the game');
  });
});
