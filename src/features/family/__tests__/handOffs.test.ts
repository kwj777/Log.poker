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
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FAMILY_LINKS } from '../../../config';
import { RESET_MEDITATION_ID, drillHandOff, resetHandOff } from '../links';

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

  it('and the drill hand-off still carries the hand it was given', () => {
    const handOff = drillHandOff({ holeCards: 'AsKd', position: 'BTN' });
    expect(handOff.handClass).toBe('AKo');
    expect(new URL(handOff.url).searchParams.get('hand')).toBe('AKo');
    expect(new URL(handOff.url).searchParams.get('position')).toBe('BTN');
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
