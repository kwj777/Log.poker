/**
 * What an import is about to do, worked out before anything is written.
 *
 * This is the seam between a parsed file and the repository: which rows are new,
 * which venues have to exist first, and how many rows were already in the log.
 * It lives here rather than in the store because it is the part with rules in it
 * -- matching venue names, skipping what is already stored -- and rules that only
 * exist inside a Zustand action are rules nothing can test.
 */

import { venueNameKey } from '../venues';
import type { ImportedSession } from './sessionImport';

/**
 * Venues match on a trimmed, case-folded name. A file writing "pokerstars" and a
 * venue already called "PokerStars" are one room; importing into a second venue
 * that differs only in case would split a bankroll across two rows of the
 * dashboard and look like a bug in the totals, which it would be.
 *
 * Re-exported rather than defined here now that the venue picker folds names
 * too: the rule is the same rule, and two copies of it would be two rules the
 * day somebody changed one. It lives in `domain/venues`.
 */
export { venueNameKey };

export interface ImportPlan {
  /** Rows to write, in file order. */
  writes: ImportedSession[];
  /** Rows already in the log, skipped rather than written twice. */
  duplicates: number;
  /** Venue names that do not exist yet, in the order and casing the file used. */
  venuesToCreate: string[];
}

export const planImport = (
  sessions: readonly ImportedSession[],
  storedKeys: ReadonlySet<string>,
  existingVenueNames: readonly string[],
): ImportPlan => {
  const writes = sessions.filter((session) => !storedKeys.has(session.importKey));

  const known = new Set(existingVenueNames.map(venueNameKey));
  const venuesToCreate: string[] = [];
  for (const session of writes) {
    const key = venueNameKey(session.venueName);
    if (known.has(key)) continue;
    known.add(key);
    venuesToCreate.push(session.venueName.trim());
  }

  return { writes, duplicates: sessions.length - writes.length, venuesToCreate };
};
