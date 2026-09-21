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
 */
export const filterSessions = (
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
