/**
 * Finding one thing in a log that has years in it.
 *
 * The filters on Sessions and on Hands narrow by things the app knows about a
 * session: when, which game, which room. They cannot find the night somebody
 * remembers by what they wrote about it, and the notes on sessions and hands
 * were write-only in exactly the way the hands themselves were.
 *
 * Somebody searching their own log is remembering rather than querying, so
 * these check the forgiving parts: part of a word, any order, either case.
 */

import { matchesTerms, searchTerms } from '../search';

describe('reading a query', () => {
  it('is empty when the box is, which matches everything', () => {
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
    expect(matchesTerms(searchTerms(''), 'anything')).toBe(true);
  });

  it('splits on whitespace, however much of it there is', () => {
    expect(searchTerms('  aria   bad beat ')).toEqual(['aria', 'bad', 'beat']);
  });

  it('lowercases, because nobody capitalizes a search', () => {
    expect(searchTerms('Aria')).toEqual(['aria']);
  });
});

describe('what matches', () => {
  const terms = searchTerms;

  it('finds a word inside a field', () => {
    expect(matchesTerms(terms('beat'), 'Took a bad beat on the river')).toBe(true);
  });

  it('and part of one, since the try before the one that works is the problem', () => {
    expect(matchesTerms(terms('ari'), 'Aria')).toBe(true);
  });

  it('ignores case on both sides', () => {
    expect(matchesTerms(terms('ARIA'), 'aria')).toBe(true);
  });

  it('wants every term, so a second word narrows rather than widens', () => {
    expect(matchesTerms(terms('aria beat'), 'Aria', 'Took a bad beat')).toBe(true);
    expect(matchesTerms(terms('aria flop'), 'Aria', 'Took a bad beat')).toBe(false);
  });

  it('in any order, and across fields', () => {
    // The room and the note are two fields and somebody typing remembers one
    // sentence, so a search must not depend on the order this happens to
    // concatenate them in.
    expect(matchesTerms(terms('beat aria'), 'Aria', 'Took a bad beat')).toBe(true);
  });

  it('skips the fields that are null, which is most of them most of the time', () => {
    expect(matchesTerms(terms('beat'), null, 'Took a bad beat', undefined)).toBe(true);
    expect(matchesTerms(terms('beat'), null, undefined)).toBe(false);
  });

  it('matches nothing when every field is empty and something was asked for', () => {
    expect(matchesTerms(terms('beat'), '', null)).toBe(false);
  });
});
