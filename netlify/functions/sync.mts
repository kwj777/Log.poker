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
 *   Full access.            The paid line. A free tier gets 403 and keeps
 *                           exactly the local-only app it had.
 *   A subject of their own.  Passcode holders share one subject, so syncing
 *                           them would pour every preview visitor's log into
 *                           one bucket. Refused by name.
 *   Somewhere to put it.    No store configured, no sync, and it says so
 *                           rather than pretending.
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
import { bearerFrom, bucketFor, maySync, verifyToken } from '../../src/sync/verify';

/**
 * Comfortably larger than any delta and far smaller than a whole history.
 *
 * A device sends what changed since it last synced, so an ordinary request is
 * a few kilobytes. The one that is not is a device syncing for the first time
 * with years already on it, which is why this is not tighter.
 */
const MAX_BODY = 2 * 1024 * 1024;

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
  // 403 rather than 401: the token is fine, the entitlement is not, and telling
  // them apart is the difference between "sign in again" and "this is paid".
  if (!maySync(claim)) return json({ error: 'forbidden' }, 403);

  let store;
  try {
    store = getStore('log-sync');
  } catch {
    console.error('sync: no blob store configured');
    return json({ error: 'off' }, 503);
  }

  const bucket = await bucketFor(secret, claim.subject);

  if (request.method === 'DELETE') {
    // Erasure, behind one check fewer than a write on purpose: what the tier
    // buys is the syncing, and deleting is the opposite of consuming it. A
    // purchase that was refunded does not make the history behind it less
    // theirs to remove. The same argument Untilt's sync already makes.
    await store.delete(bucket);
    return json(null, 204);
  }

  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  const body = await bodyOf(request);
  if (body === null || typeof body !== 'object') return json({ error: 'refused' }, 400);

  const { since, changes } = body as { since?: unknown; changes?: unknown };
  // A cursor that is not a number reads as a device that has never synced,
  // which costs one full answer and cannot corrupt anything.
  const from = typeof since === 'number' && Number.isFinite(since) && since > 0 ? since : 0;

  let stored: unknown = null;
  try {
    stored = await store.get(bucket, { type: 'json' });
  } catch {
    // A read that failed is not an empty bucket, and treating it as one would
    // hand this device a merge that silently drops everything already stored.
    console.error('sync: bucket read failed');
    return json({ error: 'unreachable' }, 503);
  }

  const merged = mergeIntoBundle(stored, changes, from, now);

  try {
    await store.setJSON(bucket, merged.bundle);
  } catch {
    console.error('sync: bucket write failed');
    return json({ error: 'unreachable' }, 503);
  }

  return json({ cursor: merged.cursor, changes: merged.changes, version: BUNDLE_VERSION }, 200);
};

export const config = { path: '/api/sync' };
