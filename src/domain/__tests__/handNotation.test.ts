import {
  FULL_DECK,
  cardsToNotation,
  cardsEqual,
  formatNotation,
  isValidNotation,
  parseNotation,
  toHandClass,
} from '../handNotation';

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
