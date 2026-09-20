/**
 * The rules behind POST and DELETE /api/sync.
 *
 * Lifted out of `netlify/functions/sync.mts` so it can be run. That file is a
 * `.mts` module, which the test runner treats as an ES module and will not put
 * through its transform, so the one piece of this feature that talks to a store
 * and a token had no executed test at all: the suite beside it could only read
 * the file and grep the text. Everything with a rule attached is here, and what
 * is left there is the environment and the store handle, which is the split
 * `SqlRepository` already has from `expoSqliteDriver` and for the same reason.
 *
 * ## What has to be true before a byte is stored
 *
 *   A token that verifies.  Signed with the key Untilt mints under. This
 *                           endpoint has no user table and no session store:
 *                           the token is the whole of the claim.
 *   A subject of their own.  Passcode holders share one subject, so giving them
 *                           a bucket would pour every preview visitor's log
 *                           into one. Refused by name.
 *   Somewhere to put it.    No store configured, no sync, and it says so
 *                           rather than pretending.
 *
 * **And a fourth, in front of the two that move data.** A write and a read sit
 * behind the pass, which `FAMILY-PRICING.md` rules Log's sync into. It is off:
 * `paidForSync` answers yes to everybody while `SYNC_NEEDS_PASS` is false, and
 * that is false because this app cannot yet find out who has bought. See
 * `token.ts` for why, which is its own door minting the free tier for every
 * sign-in it makes.
 *
 * **Erasure is not behind it**, and that is the one asymmetry here worth
 * defending. A person must always be able to empty their own bucket, whatever
 * they have or have not paid, or a refusal leaves them a copy of their whole
 * poker history they can neither read nor remove.
 *
 * The bucket is an HMAC of the subject, so the store never holds a customer id.
 * What is in there is somebody's whole poker history, which is the most
 * personal thing this app touches.
 *
 * ## Nobody loses a write to anybody else
 *
 * A merge is a read, a decision and a write, and two devices syncing seconds
 * apart run two of them at once. Read eventually and the second one can merge
 * into a bundle that predates the first, and write it back: the first device's
 * push is gone and it was told it succeeded. So the read is strongly consistent
 * and the write is conditional on the bundle not having moved underneath it. A
 * lost race is retried against what is there now, which is safe because the
 * merge is idempotent and commutative by construction.
 */

import { mergeIntoBundle } from './bundle';
import { countRecords, describe, observe } from './observe';
import { rateCheck, readWindow } from './rateLimit';
import { BUNDLE_VERSION } from './protocol';
import { paidForSync } from '../auth/token';
import { bearerFrom, bucketFor, checkToken, hasOwnBucket } from './verify';

/** What this needs from a blob store, and nothing more. */
export interface BlobStore {
  getWithMetadata(
    key: string,
    options: { type: 'json'; consistency: 'strong' },
  ): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(
    key: string,
    value: unknown,
    options: { onlyIfNew: true } | { onlyIfMatch: string },
  ): Promise<{ modified: boolean; etag?: string }>;
  delete(key: string): Promise<void>;
}

/**
 * Everything outside the rules: the key, the store and the clock.
 *
 * `store` throws or returns null when there is nowhere to put anything, which
 * is a deployment fact rather than a rule and so belongs to the caller.
 */
export interface Surroundings {
  secret: string;
  store: () => BlobStore | null;
  now: () => number;
}

/**
 * Comfortably larger than any delta and far smaller than a whole history.
 *
 * A device sends what changed since it last synced, so an ordinary request is
 * a few kilobytes. The one that is not is a device syncing for the first time
 * with years already on it, which is why this is not tighter.
 */
const MAX_BODY = 2 * 1024 * 1024;

/** How many times to lose the bundle to another device before giving up. */
const ROUNDS = 4;

/**
 * What makes the write conditional on the bundle not having moved.
 *
 * A bucket that was empty must still be empty; one that was there must still
 * carry the same tag.
 *
 * A read that came back with no tag is the case worth naming. The client treats
 * an empty `onlyIfMatch` as no condition at all, so passing one through would
 * turn this into the blind overwrite the whole loop exists to avoid, silently,
 * and the first thing it would overwrite is another device's push. Refusing is
 * the loud version of the same answer.
 */
const guardFor = (stored: { etag?: string } | null): { onlyIfNew: true } | { onlyIfMatch: string } | null => {
  if (stored === null) return { onlyIfNew: true };
  return stored.etag ? { onlyIfMatch: stored.etag } : null;
};

const json = (body: unknown, status: number, extra: Record<string, string> = {}): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...extra,
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      // Per person, and never cached by anything in between.
      'Cache-Control': 'private, no-store, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Authorization',
    },
  });

/**
 * The body, or null, without believing the declared length.
 *
 * Read off the stream and dropped the moment it passes the cap, so an oversized
 * request costs the bytes already in hand and nothing more. `content-length` is
 * a number the caller chose.
 */
const bodyOf = async (request: Request): Promise<unknown | null> => {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

export const handleSync = async (
  request: Request,
  { secret, store: open, now: clock }: Surroundings,
): Promise<Response> => {
  if (!secret) {
    // Names only, never values, and in the deploy log rather than the answer.
    console.error('sync: refusing every request; unset: GATE_SECRET');
    return json({ error: 'off' }, 503);
  }

  const now = clock();
  const checked = await checkToken(
    secret,
    bearerFrom(request.headers.get('authorization')),
    now,
  );
  if ('refused' in checked) {
    // The reason goes to the deploy log and never into the answer, which stays
    // the same 401 it was: which half of a token is wrong is as useful to
    // somebody guessing as it is to us.
    //
    // Everything but `absent`, which is not a diagnosis. A request with no
    // bearer header at all is a scanner, and this is a public URL.
    if (checked.refused !== 'absent') {
      console.error(`sync: refusing a token: ${checked.refused}`);
    }
    return json({ error: 'unauthorized' }, 401);
  }
  const claim = checked.claim;
  // 403 rather than 401: the token is fine, the subject is not, and telling
  // them apart is the difference between "sign in again" and "not you".
  if (!hasOwnBucket(claim)) return json({ error: 'forbidden' }, 403);

  let store: BlobStore | null;
  try {
    store = open();
  } catch {
    store = null;
  }
  if (store === null) {
    console.error('sync: no blob store configured');
    return json({ error: 'off' }, 503);
  }

  const bucket = await bucketFor(secret, claim.subject);

  if (request.method === 'DELETE') {
    // Erasure, behind exactly what a write is behind, which took two goes to
    // arrive at. It was once one check fewer, on the argument that a refunded
    // purchase does not make the history behind it less theirs to remove; that
    // argument is retired rather than won, because there is no purchase in
    // front of any of this any more.
    //
    // Unmetered, deliberately. The rate counter lives inside the bundle, so
    // checking it here means a strong read in front of every erase -- the round
    // trip this branch is shaped to avoid -- and it would buy very little: the
    // counter goes with the bundle on the first delete, so every repeat after
    // it is unmetered anyway, and a repeat is a delete of a key that is already
    // gone. See `endpoint.test.ts`.
    //
    // Guarded, because 204 on an erasure is a promise: this said it whether or
    // not the store had answered, and erasure is the one thing a person is
    // entitled to be told the truth about.
    try {
      await store.delete(bucket);
    } catch {
      console.error('sync: bucket erase failed');
      return json({ error: 'unreachable' }, 503);
    }
    return json(null, 204);
  }

  /**
   * The pass, and only in front of the halves that move data.
   *
   * Below the erasure above it, deliberately. That exemption existed once and
   * was retired when the tier check went away, on the note that it was "retired
   * rather than won": the argument was that a purchase which has lapsed does not
   * make the history behind it less theirs to remove, and it was never beaten,
   * only made moot. It is not moot again. Gating DELETE would leave somebody a
   * bucket they can neither read nor empty, which is the one shape of refusal
   * this endpoint should never take.
   *
   * 402 rather than 403, and its own error rather than `forbidden`, because
   * "not you" and "not bought" are different sentences to the person reading
   * them and only one of them is mended by signing in again.
   *
   * Nothing reaches this today: `paidForSync` answers true for everybody while
   * `SYNC_NEEDS_PASS` is false, and it is false because this app cannot yet
   * find out who has paid. See `token.ts`.
   */
  if (!paidForSync(claim)) return json({ error: 'unpaid' }, 402);

  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  const body = await bodyOf(request);
  if (body === null || typeof body !== 'object') return json({ error: 'refused' }, 400);

  const { since, changes, device } = body as {
    since?: unknown;
    changes?: unknown;
    device?: unknown;
  };
  // A cursor that is not a number reads as a device that has never synced,
  // which costs one full answer and cannot corrupt anything.
  const from = typeof since === 'number' && Number.isFinite(since) && since > 0 ? since : 0;

  // Enough to get past an ordinary collision and few enough that a bucket
  // somebody is hammering fails rather than holds a function open.
  for (let round = 0; round < ROUNDS; round += 1) {
    let stored: { data: unknown; etag?: string } | null;
    try {
      // Strongly, because this is a read-modify-write. The eventual read is the
      // faster one and it can hand back a bundle from before the last push,
      // which this would then merge into and write back over the top.
      stored = await store.getWithMetadata(bucket, { type: 'json', consistency: 'strong' });
    } catch {
      // A read that failed is not an empty bucket, and treating it as one would
      // hand this device a merge that silently drops everything already stored.
      console.error('sync: bucket read failed');
      return json({ error: 'unreachable' }, 503);
    }

    // Asked too often, and refused before the expensive half.
    //
    // Here rather than before the read because the count is in the bundle: the
    // read had to happen either way, and stopping now skips the merge and the
    // write, so a refused request costs strictly less than a served one. See
    // `src/sync/rateLimit.ts` for why the counter does not have a record of its
    // own.
    //
    // Decided again on each round rather than once, because a round that loses
    // the write race re-reads a bundle another device may have moved. Every
    // request adds one to whatever it read and only the winning write persists,
    // so a request is counted once however many rounds it takes.
    // `readWindow` rather than a whole `readBundle`: the count is one small
    // field and parsing a year of records to reach it would undo the point.
    const stamped = stored === null ? null : (stored.data as { rate?: unknown } | null);
    const rate = rateCheck(readWindow(stamped?.rate), now);
    if (!rate.allowed) {
      // Nothing in the answer about who or how much: it is the same 429 to a
      // client in a loop and to somebody probing with a token they should not
      // have.
      console.error('sync: refusing a request over the rate limit');
      return json({ error: 'refused' }, 429, { 'Retry-After': String(rate.retryAfter) });
    }

    // A device that names itself is recorded, so its tombstones are not
    // collected out from under it. One that does not is served without being
    // counted, which is strictly safer: an unnamed device holds nothing up and
    // is protected by the retention window alone.
    //
    // Wrapped, because everything below the merge is guarded and the merge
    // itself was not. It is pure and well tested and it still runs over a body
    // somebody else composed and a bundle that has been through this endpoint
    // however many versions ago; an uncaught throw here is a 500 on every
    // request this person's devices ever make again, with nothing in the answer
    // to say why.
    let merged;
    // Timed because how long a merge takes is one of the two numbers that would
    // say the bundle has outgrown being one object. See `observe`.
    const started = performance.now();
    try {
      merged = mergeIntoBundle(
        stored === null ? null : stored.data,
        changes,
        from,
        now,
        typeof device === 'string' ? device : null,
      );
    } catch {
      console.error('sync: merge threw');
      return json({ error: 'refused' }, 400);
    }

    // Onto the bundle that is about to be written, so the count is stored by
    // the same conditional write everything else is. A lost race stores
    // nothing, which is right: that round did not serve anybody.
    merged.bundle.rate = rate.next;

    const guard = guardFor(stored);
    if (guard === null) {
      console.error('sync: bucket read carried no tag to write against');
      return json({ error: 'unreachable' }, 503);
    }

    let written: { modified: boolean; etag?: string };
    try {
      written = await store.setJSON(bucket, merged.bundle, guard);
    } catch {
      console.error('sync: bucket write failed');
      return json({ error: 'unreachable' }, 503);
    }

    // Somebody wrote between this read and this write, so the answer computed
    // above is about a bundle that no longer exists. Around again against what
    // is there now: re-merging the same push is a no-op by construction.
    if (!written.modified) continue;

    // And `modified` is not enough on its own, which is the part worth being
    // careful about. On a conditional write the client reports `modified: true`
    // for every status except 412 -- a 429 or a 500, after its own five
    // retries, comes back indistinguishable from a write that landed, and it
    // does not throw. Answering 200 there tells the device its records are
    // stored and moves both its cursors past them, and they are nowhere.
    //
    // A write that really happened carries the new tag. One that did not has
    // nothing to carry, so an empty tag is read as a failure. If a store ever
    // omits the tag on a real write, this costs a retry against a bundle that
    // already holds the push, which the merge treats as a no-op.
    if (!written.etag) {
      console.error('sync: bucket write reported no tag, treating as not written');
      return json({ error: 'unreachable' }, 503);
    }

    // Said after the write, so a line only ever describes a bundle that is
    // really stored. Nothing here identifies whose it is; see `observe`.
    const seen = observe(countRecords(merged.bundle), performance.now() - started, round + 1);
    if (seen) console.warn(describe(seen));

    return json(
      {
        cursor: merged.cursor,
        changes: merged.changes,
        more: merged.more,
        collectedThrough: merged.collectedThrough,
        version: BUNDLE_VERSION,
      },
      200,
    );
  }

  // Lost every round. `unreachable` rather than `refused`, because the device
  // should back off and try again rather than conclude its push was bad.
  console.error('sync: gave up after losing every write race');
  return json({ error: 'unreachable' }, 503);
};

