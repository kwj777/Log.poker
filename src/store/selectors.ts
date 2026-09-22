/**
 * Pure reads over loaded state.
 *
 * Deliberately in their own module, importing nothing from the data layer: they
 * are the part of the store worth unit testing, and keeping them free of the
 * repository (and therefore of expo-sqlite) means the tests can run in plain Node.
 */

import type { SessionFilter } from '../data/repository';
import type { Hand, MoodEntry, SessionWithChildren, Venue } from '../domain/types';

export const selectHandsForSession = (hands: readonly Hand[], sessionId: string): Hand[] =>
  hands.filter((hand) => hand.sessionId === sessionId);

export const selectMoodForSession = (
  entries: readonly MoodEntry[],
  sessionId: string,
): MoodEntry[] => entries.filter((entry) => entry.sessionId === sessionId);

export const selectVenueById = (venues: readonly Venue[], id: string): Venue | null =>
  venues.find((venue) => venue.id === id) ?? null;

export const selectSessionById = (
  sessions: readonly SessionWithChildren[],
  id: string,
): SessionWithChildren | null => sessions.find((session) => session.id === id) ?? null;

/**
 * In-memory equivalent of `Repository.listSessions(filter)`, for the history
 * screen -- same semantics, including `from` inclusive and `to` exclusive, so the
 * two never disagree about which sessions a date range contains.
 *
 * `format` was in `SessionFilter` and honored by both repositories and not by
 * this, so the two did disagree about exactly one field: a filter that said
 * cash games got every tournament as well here, and silently, because an
 * ignored filter draws no error.
 *
 * `limit` was the same thing a second time and went unnoticed because no
 * caller passes one yet. It is honored now, with the engines' own clamp, and
 * the field set is pinned rather than described: `selectors.test.ts` walks
 * `SessionFilter`'s keys and asks each one to change an answer.
 *
 * Taking the first N works because the array handed in is the one the store
 * holds, which came from `listSessions()` in `started_at DESC, id DESC` order
 * -- the order the engines apply their own `LIMIT` in. A caller that re-sorts
 * before filtering would get a different N sessions, and so would the
 * repository.
 */
export const filterSessions = (
  sessions: readonly SessionWithChildren[],
  filter: SessionFilter,
): SessionWithChildren[] => {
  const capped = cappedAt(filter.limit);
  const matching = matches(sessions, filter);
  return capped === null ? matching : matching.slice(0, capped);
};

const matches = (
  sessions: readonly SessionWithChildren[],
  filter: SessionFilter,
): SessionWithChildren[] =>
  sessions.filter((session) => {
    if (filter.venueId !== undefined && session.venueId !== filter.venueId) return false;
    if (filter.gameType !== undefined && session.gameType !== filter.gameType) return false;
    if (filter.format !== undefined && session.format !== filter.format) return false;
    if (filter.from !== undefined && session.startedAt < filter.from) return false;
    if (filter.to !== undefined && session.startedAt >= filter.to) return false;
    if (filter.status === 'active' && session.endedAt !== null) return false;
    if (filter.status === 'completed' && session.endedAt === null) return false;
    return true;
  });

/**
 * The engines' clamp, to the letter, so the three cannot disagree on a limit
 * that is negative, fractional or not a number. `Math.floor(NaN)` is NaN, and
 * a limit that is not a number is no limit -- which is what a missing one
 * already means.
 */
const cappedAt = (limit: number | undefined): number | null =>
  Number.isFinite(limit as number) ? Math.max(0, Math.floor(limit as number)) : null;
