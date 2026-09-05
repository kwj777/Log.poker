/**
 * Cross-device history: POST and DELETE /api/sync
 *
 * The thin part. Everything with a rule in it is in `src/sync`, which is pure
 * TypeScript with a test suite; this reads a token, reads a blob, calls the
 * merge, and writes the blob back. The same split `SqlRepository` has from
 * `expoSqliteDriver`, for the same reason: the interesting half should be
 * testable without standing up the platform it runs on.
 *
 * TypeScript rather than the `.mjs` the scan counter is written in, precisely
 * so it can import that merge. Two implementations of a merge is two merges
 * that disagree in a year.
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
 *   Full access.            The paid line. A free tier gets 403 and keeps
 *                           exactly the local-only app it had. Last, and only
 *                           for a write: erasing is not consuming the feature.
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
 *
 * The bucket is an HMAC of the subject, so the store never holds a customer id.
 * What is in there is somebody's whole poker history, which is the most
 * personal thing this app touches.
 *
 * ## Same origin, so no CORS
 *
 * The web app is served from `log.poker/app` and this answers on `log.poker`,
 * which is one origin. Native sends no `Origin` at all. So unlike the family
 * sign-in over in Untilt, there is nothing here to allowlist and no preflight
 * to answer, and that is worth keeping: the way to make this cross-origin later
 * is to think about it, not to notice it already works.
 *
 * Environment (Netlify UI -> Site configuration -> Environment):
 *   GATE_SECRET   required. The same key Untilt signs tokens with.
 *
 * Unset, this refuses every request, which is the state to leave it in until
 * there is something to sync.
 */

import { getStore } from '@netlify/blobs';

import { mergeIntoBundle } from '../../src/sync/bundle';
import { BUNDLE_VERSION } from '../../src/sync/protocol';
import { bearerFrom, bucketFor, hasOwnBucket, maySync, verifyToken } from '../../src/sync/verify';

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
 * carry the same tag. A store that hands back no tag at all leaves nothing to
 * be conditional on, and the honest thing then is the plain write this used to
 * do unconditionally, rather than a condition that quietly is not one.
 */
const guardFor = (stored: { etag?: string } | null) => {
  if (stored === null) return { onlyIfNew: true } as const;
  return stored.etag === undefined ? {} : ({ onlyIfMatch: stored.etag } as const);
};

const json = (body: unknown, status: number): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
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

export default async (request: Request): Promise<Response> => {
  const secret = process.env.GATE_SECRET || '';
  if (!secret) {
    // Names only, never values, and in the deploy log rather than the answer.
    console.error('sync: refusing every request; unset: GATE_SECRET');
    return json({ error: 'off' }, 503);
  }

  const now = Date.now();
  const claim = await verifyToken(secret, bearerFrom(request.headers.get('authorization')), now);
  if (claim === null) return json({ error: 'unauthorized' }, 401);
  // 403 rather than 401: the token is fine, the subject is not, and telling
  // them apart is the difference between "sign in again" and "not you".
  if (!hasOwnBucket(claim)) return json({ error: 'forbidden' }, 403);

  let store;
  try {
    store = getStore('log-sync');
  } catch {
    console.error('sync: no blob store configured');
    return json({ error: 'off' }, 503);
  }

  const bucket = await bucketFor(secret, claim.subject);

  if (request.method === 'DELETE') {
    // Erasure, behind one check fewer than a write and now actually so: what
    // the tier buys is the syncing, and deleting is the opposite of consuming
    // it. A purchase that was refunded does not make the history behind it less
    // theirs to remove. The same argument Untilt's sync already makes, and it
    // sat above a tier check that contradicted it until the check moved below.
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

  // The paid line, and only writes are behind it.
  if (!maySync(claim)) return json({ error: 'forbidden' }, 403);

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

    let written: { modified: boolean };
    try {
      written = await store.setJSON(bucket, merged.bundle, guardFor(stored));
    } catch {
      console.error('sync: bucket write failed');
      return json({ error: 'unreachable' }, 503);
    }

    // Somebody wrote between this read and this write, so the answer computed
    // above is about a bundle that no longer exists. Around again against what
    // is there now: re-merging the same push is a no-op by construction.
    if (!written.modified) continue;

    return json(
      {
        cursor: merged.cursor,
        changes: merged.changes,
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

export const config = { path: '/api/sync' };
