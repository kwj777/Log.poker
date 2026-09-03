/**
 * Talking to the sync endpoint.
 *
 * One round trip: send what changed and what we last saw, apply what comes
 * back. There is nothing for this side to resolve, because the server merges
 * and this applies. That is a smaller job than it sounds, and deliberately so:
 * a device that has been in a drawer for a month has a month-old view of the
 * world and possibly a wrong clock, and the fewer decisions it makes the fewer
 * ways two devices have of disagreeing forever.
 *
 * Every failure collapses into one of three, for the reason the sign-in client
 * collapses its own: a screen has one sentence to spend, and a player can do
 * nothing different about DNS than about a socket closing.
 */

import type { ChangeSet } from '../data/repository';
import type { Timestamp } from '../domain/types';
import { emptyChangeSet, type SyncFailure, type SyncRequest, type SyncResponse } from './protocol';

/** Where the endpoint answers. Same origin on web; absolute for native. */
export const SYNC_URL = 'https://log.poker/api/sync';

/** Long enough for a cold start and a first sync, short enough to give up. */
export const REQUEST_TIMEOUT_MS = 30_000;

export type Fetch = typeof globalThis.fetch;

export type SyncOutcome =
  | { ok: true; response: SyncResponse }
  | { ok: false; reason: SyncFailure };

export interface SyncOptions {
  fetch?: Fetch;
  url?: string;
  timeoutMs?: number;
}

const shapedLikeAChangeSet = (value: unknown): value is ChangeSet => {
  if (typeof value !== 'object' || value === null) return false;
  const held = value as Record<string, unknown>;
  return (['venues', 'sessions', 'rebuys', 'hands', 'moodEntries'] as const).every((table) =>
    Array.isArray(held[table]),
  );
};

/**
 * Push and pull in one call.
 *
 * A non-answer is `unreachable` rather than an exception, because the caller is
 * a background loop and there is no useful difference between a server that is
 * down and a card room with no signal. The one answer worth telling apart is
 * `unauthorized`, which means stop trying until somebody signs in again.
 */
export const sync = async (
  request: SyncRequest,
  token: string,
  { fetch = globalThis.fetch, url = SYNC_URL, timeoutMs = REQUEST_TIMEOUT_MS }: SyncOptions = {},
): Promise<SyncOutcome> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'unauthorized' };
  }
  if (!response.ok) {
    // 4xx is this device's fault and retrying unchanged will not fix it; 5xx
    // might fix itself. The loop treats them differently, so they are told
    // apart here rather than at the call site.
    return { ok: false, reason: response.status < 500 ? 'refused' : 'unreachable' };
  }

  try {
    const body: unknown = await response.json();
    const { cursor, changes } = (body ?? {}) as { cursor?: unknown; changes?: unknown };
    if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
      return { ok: false, reason: 'unreachable' };
    }
    return {
      ok: true,
      response: {
        cursor,
        changes: shapedLikeAChangeSet(changes) ? changes : emptyChangeSet(),
      },
    };
  } catch {
    // A 200 that is not the shape promised is a server that changed under us,
    // and reading it as unreachable is safer than acting on half of it.
    return { ok: false, reason: 'unreachable' };
  }
};

/** Erase everything the server holds. Not a sign-out, and not a local wipe. */
export const eraseRemote = async (
  token: string,
  { fetch = globalThis.fetch, url = SYNC_URL, timeoutMs = REQUEST_TIMEOUT_MS }: SyncOptions = {},
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * How long to wait before trying again, after `attempt` consecutive failures.
 *
 * Doubling from ten seconds to five minutes. A phone in a card room has no
 * signal for hours, and a loop that retried every ten seconds through that
 * would spend a battery to learn the same thing four hundred times.
 */
export const backoffMs = (attempt: number): number =>
  Math.min(10_000 * 2 ** Math.max(0, attempt - 1), 300_000);

export type { Timestamp };
