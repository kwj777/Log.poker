/**
 * Shared record construction. Both repositories build rows through these
 * helpers so a venue created on iOS is byte-identical to one created on web —
 * which matters now for the shared test suite, and later for sync.
 */

import type {
  Hand,
  MoodEntry,
  NewHand,
  NewMoodEntry,
  NewRebuy,
  NewSession,
  NewVenue,
  Rebuy,
  Session,
  Timestamp,
  Venue,
} from '../domain/types';

/** Injected so tests can pin ids and timestamps and still exercise real code. */
export interface Clock {
  now(): Timestamp;
}

export interface IdGenerator {
  next(): string;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * URL-safe random id. `crypto.randomUUID` exists on modern web, Hermes and Node,
 * but not on every RN engine build, so there is a fallback that draws from
 * `crypto.getRandomValues` and finally from `Math.random`.
 */
export const randomId = (): string => {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
};

export const systemIds: IdGenerator = { next: randomId };

export interface RepositoryContext {
  clock: Clock;
  ids: IdGenerator;
}

export const defaultContext = (): RepositoryContext => ({
  clock: systemClock,
  ids: systemIds,
});

export const buildVenue = (input: NewVenue, ctx: RepositoryContext): Venue => {
  const now = ctx.clock.now();
  return {
    id: ctx.ids.next(),
    name: input.name.trim(),
    isHomeGame: input.isHomeGame,
    sessionCount: 0,
    createdAt: now,
    updatedAt: now,
  };
};

export const buildSession = (input: NewSession, ctx: RepositoryContext): Session => {
  const now = ctx.clock.now();
  return {
    id: ctx.ids.next(),
    venueId: input.venueId,
    gameType: input.gameType,
    stakes: { ...input.stakes },
    buyIn: input.buyIn,
    cashOut: input.cashOut ?? null,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
};

export const buildRebuy = (input: NewRebuy, ctx: RepositoryContext): Rebuy => {
  const now = ctx.clock.now();
  return {
    id: ctx.ids.next(),
    sessionId: input.sessionId,
    amount: input.amount,
    at: input.at,
    createdAt: now,
    updatedAt: now,
  };
};

export const buildHand = (input: NewHand, ctx: RepositoryContext): Hand => {
  const now = ctx.clock.now();
  return {
    id: ctx.ids.next(),
    sessionId: input.sessionId,
    holeCards: input.holeCards ?? null,
    position: input.position ?? null,
    note: input.note ?? null,
    tags: input.tags ? [...input.tags] : [],
    amount: input.amount ?? null,
    at: input.at,
    createdAt: now,
    updatedAt: now,
  };
};

export const buildMoodEntry = (input: NewMoodEntry, ctx: RepositoryContext): MoodEntry => {
  const now = ctx.clock.now();
  return {
    id: ctx.ids.next(),
    sessionId: input.sessionId,
    phase: input.phase,
    score: input.score,
    at: input.at,
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Apply a patch, dropping keys explicitly set to `undefined` so that
 * `{ notes: undefined }` means "leave it alone" and `{ notes: null }` means
 * "clear it". Without this, spreading a patch would blank untouched columns.
 */
export const applyPatch = <T extends object>(record: T, patch: Partial<T>): T => {
  const next = { ...record };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
};

/** Newest first — the order every list in the app wants. */
export const byRecencyDesc = <T extends { at: Timestamp }>(a: T, b: T): number => b.at - a.at;
