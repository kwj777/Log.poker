/**
 * Which rooms are the same room.
 *
 * The rule is small and the reason it is here rather than beside the importer
 * is that two callers now depend on it: a file naming "pokerstars" when the log
 * says "PokerStars", and a player typing "aria" at a table on a night the chip
 * said "Aria". Both used to end with two venues and a bankroll split between
 * them.
 *
 * The other half of these tests is what it deliberately does not match. A
 * matcher that guessed at "Bellagio" and "Bellagio Poker Room" would merge
 * somebody's log on a hunch, and there is no undo anywhere in this app.
 */

import { findVenueNamed, venueNameKey } from '../venues';
import type { Venue } from '../types';

const venue = (id: string, name: string): Venue => ({
  id,
  name,
  isHomeGame: false,
  sessionCount: 3,
  createdAt: 1,
  updatedAt: 1,
});

const LOG = [venue('v1', 'Aria'), venue('v2', "Mike's basement"), venue('v3', 'Bellagio')];

describe('the key two spellings of one room share', () => {
  it('ignores case', () => {
    expect(venueNameKey('Aria')).toBe(venueNameKey('aria'));
    expect(venueNameKey('ARIA')).toBe(venueNameKey('Aria'));
  });

  it('ignores space around the edges, which a phone keyboard adds', () => {
    expect(venueNameKey(' Aria ')).toBe(venueNameKey('Aria'));
  });

  it('and nothing else', () => {
    // Space in the middle is part of the name: "Bay 101" is not "Bay101".
    expect(venueNameKey('Bay 101')).not.toBe(venueNameKey('Bay101'));
  });
});

describe('finding the room already in the log', () => {
  it('matches a different casing of one', () => {
    expect(findVenueNamed(LOG, 'aria')?.id).toBe('v1');
    expect(findVenueNamed(LOG, '  ARIA')?.id).toBe('v1');
  });

  it('matches the exact name too, which is the common case', () => {
    expect(findVenueNamed(LOG, 'Bellagio')?.id).toBe('v3');
  });

  it('does not match a name that merely starts the same way', () => {
    // Two real rooms, and "Aria High Limit" is not "Aria". A merge is the
    // player's call to make in Settings, where it asks first.
    expect(findVenueNamed(LOG, 'Aria High Limit')).toBeNull();
    expect(findVenueNamed(LOG, 'Bellagio Poker Room')).toBeNull();
  });

  it('answers null for a room that is not there', () => {
    expect(findVenueNamed(LOG, 'Commerce')).toBeNull();
    expect(findVenueNamed([], 'Aria')).toBeNull();
  });
});
