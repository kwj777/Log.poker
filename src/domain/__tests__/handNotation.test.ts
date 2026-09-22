import {
  boardStreet,
  cardToString,
  clashingCards,
  isBoard,
  FULL_DECK,
  cardsToNotation,
  cardsEqual,
  formatNotation,
  isValidNotation,
  parseNotation,
  toHandClass,
  notationSearchForms,
} from '../handNotation';
import { matchesTerms, searchTerms } from '../search';


describe('parseNotation', () => {
  it('parses hole cards', () => {
    expect(parseNotation('AsKd')).toEqual([
      { rank: 'A', suit: 's' },
      { rank: 'K', suit: 'd' },
    ]);
  });

  it('parses a longer sequence, such as a board handed off to a drill', () => {
    expect(parseNotation('AsKdQh')).toHaveLength(3);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseNotation('  Th9h  ')).toHaveLength(2);
  });

  it('rejects malformed input rather than half-parsing it', () => {
    for (const bad of ['', 'A', 'AsK', 'Xs2h', 'Asxd', '1s2h', 'as kd']) {
      expect(parseNotation(bad)).toBeNull();
    }
  });

  it('rejects a duplicated card', () => {
    expect(parseNotation('AsAs')).toBeNull();
  });

  it('treats null and undefined as absent', () => {
    expect(parseNotation(null)).toBeNull();
    expect(parseNotation(undefined)).toBeNull();
  });

  it('is case-sensitive, matching the format every other poker tool uses', () => {
    expect(parseNotation('asKD')).toBeNull();
  });
});

describe('round-tripping', () => {
  it('survives a trip through cards and back', () => {
    for (const notation of ['AsKd', 'Th9h', '7c7d', '2s3h4d5c']) {
      expect(cardsToNotation(parseNotation(notation)!)).toBe(notation);
    }
  });

  it('validates in one call', () => {
    expect(isValidNotation('QhQd')).toBe(true);
    expect(isValidNotation('QhQh')).toBe(false);
  });
});

describe('toHandClass', () => {
  it('collapses suits into the class a drill keys on', () => {
    expect(toHandClass('AsKs')).toBe('AKs');
    expect(toHandClass('AsKd')).toBe('AKo');
    expect(toHandClass('7c7d')).toBe('77');
  });

  it('orders by rank regardless of how the cards were tapped in', () => {
    expect(toHandClass('KdAs')).toBe('AKo');
    expect(toHandClass('2h9h')).toBe('92s');
  });

  it('has no class for anything but two cards', () => {
    expect(toHandClass('AsKdQh')).toBeNull();
    expect(toHandClass('As')).toBeNull();
    expect(toHandClass(null)).toBeNull();
  });
});

describe('formatNotation', () => {
  it('renders suit symbols for display', () => {
    expect(formatNotation('AsKd')).toBe('A♠ K♦');
    expect(formatNotation('Th9c')).toBe('T♥ 9♣');
  });

  it('renders an em dash when no cards were recorded', () => {
    expect(formatNotation(null)).toBe('--');
    expect(formatNotation('garbage')).toBe('--');
  });
});

describe('cards', () => {
  it('compares by rank and suit', () => {
    expect(cardsEqual({ rank: 'A', suit: 's' }, { rank: 'A', suit: 's' })).toBe(true);
    expect(cardsEqual({ rank: 'A', suit: 's' }, { rank: 'A', suit: 'h' })).toBe(false);
  });

  it('exposes a full 52-card deck with no duplicates, aces first', () => {
    expect(FULL_DECK).toHaveLength(52);
    expect(new Set(FULL_DECK.map((card) => `${card.rank}${card.suit}`)).size).toBe(52);
    expect(FULL_DECK[0].rank).toBe('A');
  });
});

describe('boards', () => {
  it('accepts a flop, a turn and a river', () => {
    expect(isBoard('7c2sKh')).toBe(true);
    expect(isBoard('7c2sKhAd')).toBe(true);
    expect(isBoard('7c2sKhAd9d')).toBe(true);
  });

  it('refuses one card and two, which are not boards but half-typed ones', () => {
    // A hand that saw a flop saw three cards at once. Two is somebody who
    // stopped tapping, and storing it would log a thing that never happened.
    expect(isBoard('7c')).toBe(false);
    expect(isBoard('7c2s')).toBe(false);
  });

  it('refuses six, and refuses nothing at all', () => {
    expect(isBoard('7c2sKhAd9d3h')).toBe(false);
    expect(isBoard(null)).toBe(false);
    expect(isBoard('')).toBe(false);
  });

  it('refuses a board that deals the same card twice', () => {
    expect(isBoard('7c2s7c')).toBe(false);
  });

  it('names the street it ran to', () => {
    expect(boardStreet('7c2sKh')).toBe('flop');
    expect(boardStreet('7c2sKhAd')).toBe('turn');
    expect(boardStreet('7c2sKhAd9d')).toBe('river');
    expect(boardStreet('7c2s')).toBeNull();
    expect(boardStreet(null)).toBeNull();
  });

  it('finds a card dealt in both the hand and the board', () => {
    // The one duplicate `parseNotation` cannot see, because it only ever reads
    // one string: two strings, one deck.
    expect(clashingCards('AsKd', '7c2sAs').map(cardToString)).toEqual(['As']);
    expect(clashingCards('AsKd', '7c2sKh')).toEqual([]);
  });

  it('and reports nothing to compare when either side is missing', () => {
    expect(clashingCards('AsKd', null)).toEqual([]);
    expect(clashingCards(null, '7c2sKh')).toEqual([]);
    expect(clashingCards('AsKd', 'nonsense')).toEqual([]);
  });
});

describe('the forms a search has to answer to', () => {
  /**
   * `AsKd` is the wire format and nothing draws it. `HandRow` renders
   * `formatNotation`, so what a player is looking at is `A♠ K♦`, and the Hands
   * search put only the raw string in its haystack -- under a comment claiming
   * `AsKd` was "how the row draws it". Typing what is on screen matched
   * nothing, and so did `AK` and `AA`.
   */
  const finds = (query: string, notation: string) =>
    matchesTerms(searchTerms(query), ...notationSearchForms(notation));

  it('finds a hand by what the row shows', () => {
    expect(finds('A♠ K♦', 'AsKd')).toBe(true);
    expect(finds('A♠', 'AsKd')).toBe(true);
    expect(finds('k♦', 'AsKd')).toBe(true);
  });

  it('and by the name a player says it out loud with', () => {
    expect(finds('AK', 'AsKd')).toBe(true);
    expect(finds('AA', 'AsAh')).toBe(true);
    expect(finds('77', '7c7d')).toBe(true);
    expect(finds('AKs', 'AsKs')).toBe(true);
  });

  it('and still by the notation, which is what the export writes', () => {
    expect(finds('AsKd', 'AsKd')).toBe(true);
  });

  it('but not by a hand it is not', () => {
    expect(finds('AK', '7c7d')).toBe(false);
    expect(finds('Q♠', 'AsKd')).toBe(false);
    expect(finds('AKs', 'AsKd')).toBe(false);
  });

  it('and a board reads the same three ways', () => {
    expect(finds('7♣', '7c2sKh')).toBe(true);
    expect(finds('7c2sKh', '7c2sKh')).toBe(true);
    // No hand class for three cards, which is what `toHandClass` refuses.
    expect(notationSearchForms('7c2sKh')).toHaveLength(2);
  });

  it('and nothing at all goes in the haystack for a hand with no cards', () => {
    // `formatNotation` answers a dash, and a dash every hand shares is a term
    // that matches all of them.
    for (const empty of [null, undefined, '', 'not cards']) {
      expect(notationSearchForms(empty)).toEqual([]);
    }
    expect(matchesTerms(searchTerms('--'), ...notationSearchForms(null))).toBe(false);
  });
});

