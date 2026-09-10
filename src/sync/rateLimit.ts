/**
 * How often one person may ask, and what happens when they ask more.
 *
 * ## Where the count lives, and why it is not its own record
 *
 * In the bundle, which every POST already reads and every served POST already
 * writes. So checking costs nothing that was not being spent, and **refusing
 * costs less than answering**: a refused request pays the read it had already
 * paid and skips the merge and the write.
 *
 * A counter of its own in its own blob was the obvious shape and is the worse
 * one. It would put a second read in front of every request that is fine in
 * order to make the rare request that is not slightly cheaper, which is paying
 * the common case to subsidize the exception.
 *
 * ## What this protects, and what it does not
 *
 * It protects the store from a client in a loop -- a bug, a retry that lost its
 * backoff, a device whose clock makes it think the wait is over every time.
 * That is the realistic failure here, and it is somebody's own bucket being
 * hammered by their own app.
 *
 * **It does not make an unauthenticated flood cheaper**, and cannot. A request
 * with no usable token is refused by `checkToken` before the store is opened at
 * all, so it already costs an HMAC and nothing else; what it still costs is the
 * function invocation, and no counter kept behind that function can change
 * that. Only something in front of it -- a platform rule at the edge -- would,
 * and this endpoint deliberately does not depend on one being configured.
 *
 * ## Per person, not per device
 *
 * The bucket is what is being protected and a bucket is one subject, so three
 * devices share the budget. That is the right shape even though it means a busy
 * household is nearer the line than a single phone: the line is drawn far
 * enough out that neither is near it.
 *
 * ## A fixed window, and the burst it allows
 *
 * The window starts when the first request in it arrives and runs for a minute.
 * Two full budgets can therefore land in quick succession either side of a
 * boundary, which is the known cost of the simplest correct thing. It does not
 * matter here: the limit is an order of magnitude above what a legitimate
 * client does, so twice it is still an order of magnitude below a loop.
 */

import type { Timestamp } from '../domain/types';

/**
 * Requests per window, per person.
 *
 * A device pushes after a write and pulls on coming to the front, throttled to
 * once every thirty seconds. The busiest honest minute is a first sync draining
 * a backlog, which is bounded by `MAX_PUSH_CHARS` at half a megabyte a request
 * -- single figures for five years of a heavy live player, not hundreds. Twenty
 * a minute would be a lot; a hundred and twenty is a line only a loop crosses.
 */
export const RATE_LIMIT = 120;

/** How long a window lasts. */
export const RATE_WINDOW_MS = 60_000;

export interface RateWindow {
  /** When this window opened, on the server's clock. */
  since: Timestamp;
  /** How many requests have been served in it. */
  count: number;
}

export const freshWindow = (): RateWindow => ({ since: 0, count: 0 });

export interface RateDecision {
  allowed: boolean;
  /** The window to store, when the request is served. */
  next: RateWindow;
  /** Whole seconds until the window reopens. Zero when allowed. */
  retryAfter: number;
}

/**
 * Read a window off a stored bundle, believing nothing about its shape.
 *
 * Anything unreadable is a fresh window rather than a refusal. The alternative
 * is a corrupt field locking somebody out of their own sync, which is a far
 * worse failure than one minute of unmetered requests.
 */
export const readWindow = (stored: unknown): RateWindow => {
  if (typeof stored !== 'object' || stored === null) return freshWindow();
  const { since, count } = stored as { since?: unknown; count?: unknown };
  if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) return freshWindow();
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return freshWindow();
  return { since, count: Math.floor(count) };
};

/**
 * Whether this request is inside the budget, and what to store if it is served.
 *
 * A clock that has gone backwards opens a new window rather than sitting out
 * the size of the jump. Functions run on many machines whose clocks agree to
 * within milliseconds rather than exactly, and the failure to avoid is somebody
 * locked out for an hour because one machine was an hour fast; counting a few
 * requests twice is nothing by comparison.
 */
export const rateCheck = (
  window: RateWindow,
  now: Timestamp,
  limit: number = RATE_LIMIT,
): RateDecision => {
  const age = now - window.since;
  const expired = age >= RATE_WINDOW_MS || age < 0;

  if (expired) {
    return { allowed: true, next: { since: now, count: 1 }, retryAfter: 0 };
  }
  if (window.count >= limit) {
    return {
      allowed: false,
      next: window,
      // At least a second, because `Retry-After: 0` reads as "now" and would
      // send a client that honors it straight back into the same refusal.
      retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - age) / 1000)),
    };
  }
  return { allowed: true, next: { since: window.since, count: window.count + 1 }, retryAfter: 0 };
};
