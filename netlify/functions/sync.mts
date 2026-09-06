/**
 * Cross-device history: POST and DELETE /api/sync.
 *
 * The thin part, and now actually thin. It reads the key out of the
 * environment, opens the store, and hands both to `handleSync` in
 * `src/sync/endpoint.ts`, which holds every rule and has a test suite that runs
 * it. The same split `SqlRepository` has from `expoSqliteDriver`, for the same
 * reason: the interesting half should be testable without standing up the
 * platform it runs on.
 *
 * It has to stay this size. A `.mts` module is an ES module as far as the test
 * runner is concerned, and it will not put one through its transform, so
 * anything that moves back into this file is untested again.
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

import { handleSync, type BlobStore } from '../../src/sync/endpoint';

export default async (request: Request): Promise<Response> =>
  handleSync(request, {
    secret: process.env.GATE_SECRET || '',
    store: () => getStore('log-sync') as unknown as BlobStore,
    now: Date.now,
  });

export const config = { path: '/api/sync' };
