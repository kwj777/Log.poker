/**
 * What a pile of logged hands adds up to.
 *
 * The thing worth testing here is not the arithmetic, which is a loop with a
 * counter in it. It is the two decisions that stop the output being
 * misleading: a hand with two tags counting in both piles, and a group
 * reporting how many of its hands actually carry a pot swing. Both exist
 * because these are the hands somebody chose to write down rather than the
 * hands they played, and a number drawn from that set is one caveat away from
 * being read as a positional win rate.
 */

import { byPosition, byTag, describeGroup, handTotals } from '../hands';
import type { Hand } from '../types';

const T0 = Date.UTC(2026, 2, 14, 19, 30);

const hand = (over: Partial<Hand> = {}): Hand => ({
  id: 'h1',
  sessionId: 's1',
  holeCards: 'AsKd',
  board: null,
  position: null,
  note: null,
  tags: [],
  amount: null,
  at: T0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

describe('hands by tag', () => {
  it('counts a hand carrying two tags in both piles', () => {
    // A hand that was a cooler and a bluff belongs in both: picking one would
    // quietly drop the other from a list somebody is reading to decide what
    // they keep doing.
    const groups = byTag([hand({ tags: ['cooler', 'bluff'] })]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.count === 1)).toBe(true);
  });

  it('leaves untagged hands out rather than bucketing them as "none"', () => {
    // Most logged hands carry no tag, so that bar would tower over the four
    // that mean something and say nothing at all.
    const groups = byTag([hand({ id: 'a' }), hand({ id: 'b', tags: ['bad_beat'] })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('bad_beat');
  });

  it('names the tag the way the rest of the app does', () => {
    expect(byTag([hand({ tags: ['bad_beat'] })])[0].label).toBe('bad beat');
  });

  it('sorts by how many, since that is what the list is about', () => {
    const groups = byTag([
      hand({ id: 'a', tags: ['bluff'] }),
      hand({ id: 'b', tags: ['cooler'] }),
      hand({ id: 'c', tags: ['cooler'] }),
    ]);
    expect(groups[0].key).toBe('cooler');
  });

  it('sums only the hands that recorded a pot, and says how many those were', () => {
    // The caveat that stops three priced hands inside twelve being read as
    // twelve hands' worth of money.
    const groups = byTag([
      hand({ id: 'a', tags: ['bad_beat'], amount: -20_000 }),
      hand({ id: 'b', tags: ['bad_beat'], amount: 5_000 }),
      hand({ id: 'c', tags: ['bad_beat'] }),
    ]);
    expect(groups[0].count).toBe(3);
    expect(groups[0].withAmount).toBe(2);
    expect(groups[0].net).toBe(-15_000);
  });

  it('treats a pot swing of zero as unpriced, because that is what it is', () => {
    const groups = byTag([hand({ tags: ['bluff'], amount: 0 })]);
    expect(groups[0].withAmount).toBe(0);
  });
});

describe('hands by seat', () => {
  it('comes back in seat order rather than by size', () => {
    // Every other breakdown sorts by result. This one must not: a reader
    // scanning for the blinds expects them at the end, and sorting by money
    // would reorder the list every time a hand is logged.
    const groups = byPosition([
      hand({ id: 'a', position: 'BB', amount: 100_000 }),
      hand({ id: 'b', position: 'UTG', amount: 1_000 }),
      hand({ id: 'c', position: 'BTN', amount: 50_000 }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['UTG', 'BTN', 'BB']);
  });

  it('leaves out a seat with nothing logged rather than drawing it as zero', () => {
    const groups = byPosition([hand({ position: 'BTN' })]);
    expect(groups).toHaveLength(1);
  });

  it('ignores hands that recorded no seat, which is most of them', () => {
    const groups = byPosition([hand({ id: 'a' }), hand({ id: 'b', position: 'CO' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });
});

describe('the totals over the whole pile', () => {
  it('counts the tagged and the seated apart, since the groups double-count', () => {
    // `byTag` puts a two-tag hand in two piles on purpose, so its counts sum
    // to more than the number of hands. This is the honest denominator.
    const totals = handTotals([
      hand({ id: 'a', tags: ['cooler', 'bluff'], position: 'BTN' }),
      hand({ id: 'b', tags: [] }),
    ]);
    expect(totals.count).toBe(2);
    expect(totals.tagged).toBe(1);
    expect(totals.seated).toBe(1);
  });

  it('is empty on an empty pile rather than dividing by nothing', () => {
    expect(handTotals([])).toEqual({ count: 0, withAmount: 0, net: 0, tagged: 0, seated: 0 });
  });
});

describe('what a group says to a screen reader', () => {
  const money = (cents: number) => `$${cents / 100}`;

  it('leads with the count, because the count is the caveat', () => {
    const [group] = byTag([hand({ tags: ['bad_beat'], amount: -20_000 })]);
    expect(describeGroup(group, money)).toBe('bad beat: 1 hand, all of them priced, $-200 across those.');
  });

  it('says so when only some of them carry a pot', () => {
    const [group] = byTag([
      hand({ id: 'a', tags: ['bad_beat'], amount: -20_000 }),
      hand({ id: 'b', tags: ['bad_beat'] }),
    ]);
    expect(describeGroup(group, money)).toContain('1 of them priced');
  });

  it('and offers no figure at all when none of them do', () => {
    const [group] = byTag([hand({ tags: ['bluff'] })]);
    expect(describeGroup(group, money)).toBe('bluff: 1 hand, none with a pot recorded.');
  });
});
