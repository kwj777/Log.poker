/**
 * Shared record construction. Both repositories build rows through these
 * helpers so a venue created on iOS is byte-identical to one created on web --
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
  Stakes,
  Timestamp,
  Venue,
} from '../domain/types';
import { DEFAULT_CURRENCY } from '../domain/money';
import { ConstraintError, type Change } from './repository';

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

/**
 * Copied field by field rather than spread.
 *
 * SQLite writes named columns and drops anything else; IndexedDB stores whatever
 * object it is handed. A caller passing stakes with a stray property on it would
 * make the two engines hold different rows for the same session, which is the
 * exact divergence this module exists to prevent.
 */
const normalizeStakes = (stakes: Stakes | null | undefined): Stakes | null => {
  if (!stakes) return null;
  return {
    smallBlind: stakes.smallBlind,
    bigBlind: stakes.bigBlind,
    ...(stakes.ante == null ? {} : { ante: stakes.ante }),
  };
};

/**
 * The format decides which fields a session is allowed to carry, and it is
 * enforced here rather than trusted from the caller.
 *
 * A tournament has no blinds and a cash game has no entry fee, no field and no
 * finishing position. Letting either keep the other's fields would put them in
 * the database, where some later screen would eventually read one and show it --
 * a `$1/$2` tournament, or a cash game that finished 14th.
 */
export const buildSession = (input: NewSession, ctx: RepositoryContext): Session => {
  const now = ctx.clock.now();
  const format = input.format ?? 'cash';
  const tournament = format === 'tournament';
  return {
    id: ctx.ids.next(),
    venueId: input.venueId,
    format,
    gameType: input.gameType,
    stakes: tournament ? null : normalizeStakes(input.stakes),
    currency: input.currency ?? DEFAULT_CURRENCY,
    buyIn: input.buyIn,
    fee: tournament ? (input.fee ?? null) : null,
    cashOut: input.cashOut ?? null,
    entrants: tournament ? (input.entrants ?? null) : null,
    finishPosition: tournament ? (input.finishPosition ?? null) : null,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    notes: input.notes ?? null,
    importKey: input.importKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Reject a batch of sessions that would duplicate something already imported,
 * or duplicate each other.
 *
 * Both repositories call this before writing rather than leaning on the unique
 * index underneath, so the two engines fail the same way with the same message.
 * The index stays as the guarantee; this is the readable error.
 */
export const assertImportKeysAvailable = (
  inputs: readonly NewSession[],
  existing: ReadonlySet<string>,
): void => {
  const batch = new Set<string>();
  for (const input of inputs) {
    const key = input.importKey;
    if (key === undefined || key === null) continue;
    if (batch.has(key)) {
      throw new ConstraintError(`The same session appears twice in one import (${key})`);
    }
    if (existing.has(key)) {
      throw new ConstraintError(`That session has already been imported (${key})`);
    }
    batch.add(key);
  }
};

/**
 * Which arriving session keeps each import key, where more than one claims it.
 *
 * The key is unique in both engines, so two arriving rows carrying the same one
 * cannot both be stored. What makes that worth deciding here rather than
 * leaving to the index is where the failure lands: the write that discovers it
 * throws in the middle of a transaction, so one inconsistent row rolls back the
 * whole answer, and the next sync is handed the same answer and fails the same
 * way, for as long as the two rows both exist. `applyChanges` promises the
 * opposite, and keeps that promise for every other kind of inconsistency by
 * skipping the row rather than the sync.
 *
 * The winner is the one the server's own collision rule picks: earliest
 * `createdAt`, then lowest id. Same rule, same winner, so the provenance ends
 * up on the same row here as it does there, and the next answer confirms what
 * is already stored instead of moving it again.
 *
 * Ahead of both, a live row beats a tombstoned one. A tombstone has no
 * provenance left to lose, and one holding a unique key blocks the next honest
 * import of that row, which is why `deleteSession` clears the key on the way
 * out.
 *
 * Only contested keys appear. A loser is stored with no key and loses nothing
 * else: its id, its fields and its children all stay, and it keeps the stamp it
 * arrived with, so this reconciles with a decision the server is already in the
 * middle of making rather than becoming an edit to push back.
 */
export const importKeyOwners = (arriving: readonly Change<Session>[]): Map<string, string> => {
  const byKey = new Map<string, Change<Session>[]>();
  for (const change of arriving) {
    const key = change.record.importKey;
    // The same test the index makes, and the same one the server's rule makes:
    // a record can reach here with no key at all, and an empty one is not a
    // claim on anything.
    if (typeof key !== 'string' || key === '') continue;
    const group = byKey.get(key);
    if (group) group.push(change);
    else byKey.set(key, [change]);
  }

  const owners = new Map<string, string>();
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const [keep] = [...group].sort(
      (a, b) =>
        Number(a.deletedAt !== null) - Number(b.deletedAt !== null) ||
        a.record.createdAt - b.record.createdAt ||
        (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0),
    );
    owners.set(key, keep.record.id);
  }
  return owners;
};

/**
 * The key an arriving session is actually stored with: its own, or none.
 *
 * Paired with `importKeyOwners` so both engines answer the question the same
 * way in both of the places they ask it, the release and the write.
 */
export const importKeyFor = (
  record: Session,
  owners: ReadonlyMap<string, string>,
): string | null => {
  const key = record.importKey;
  if (typeof key !== 'string' || key === '') return null;
  const owner = owners.get(key);
  return owner === undefined || owner === record.id ? key : null;
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
    board: input.board ?? null,
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
