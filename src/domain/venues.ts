/**
 * Which rooms are the same room.
 *
 * A venue is free text somebody types once, at a table, usually one-handed.
 * "Aria", "aria" and "Aria " are one room and would otherwise be three rows on
 * the dashboard breakdown, three chips on the picker, and a bankroll split
 * across them -- which looks like a bug in the totals, because it is one.
 *
 * The importer worked this out first and has folded names since it shipped.
 * The in-app path did not, so the one place a venue is actually created by a
 * person was the one place that would happily create a second of it. This
 * module is that rule, moved somewhere both callers can reach rather than left
 * inside `domain/import`, where a session screen reaching for it would have
 * read as a session screen importing something.
 *
 * Folding is deliberately only case and surrounding space. "Aria" and "Aria
 * High Limit" are two rooms, "Bellagio" and "Bellagio Poker Room" might be one
 * and might not, and a matcher that guessed would merge somebody's log on a
 * hunch. The player can merge those themselves, in Settings, where the app
 * asks first.
 */

import type { Venue } from './types';

/** The key two spellings of one room share. */
export const venueNameKey = (name: string): string => name.trim().toLowerCase();

/** The venue already in the log under this name, if there is one. */
export const findVenueNamed = (
  venues: readonly Venue[],
  name: string,
): Venue | null => {
  const key = venueNameKey(name);
  return venues.find((venue) => venueNameKey(venue.name) === key) ?? null;
};
