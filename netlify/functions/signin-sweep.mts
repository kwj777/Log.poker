/**
 * The daily collection of spent sign-in records.
 *
 * The thin part, and the same split as `signin.mts` and `sync.mts` for the
 * same reason: a `.mts` module is an ES module as far as the test runner is
 * concerned and will not go through its transform, so every rule lives in
 * `src/auth/signinSweep.ts` where a test can run it. What is left here is the
 * store handle and the schedule.
 *
 * ## What it collects
 *
 * Records `/api/signin` has stopped reading: an address whose day of mail
 * counting has rolled *and* whose code has expired, and a caller whose hour
 * has run out. Both conditions for an address, which is the point of the file
 * next door. It never writes and it holds no key, because there is nothing
 * here to sign or verify; the records are already keyed by an HMAC and this
 * only ever asks whether one is spent.
 *
 * ## Two things about scheduled functions worth knowing before debugging one
 *
 * **They only run on published deploys.** A deploy preview will build this,
 * list it and never fire it, so a sweep that appears not to work on a branch
 * is working exactly as designed. To see it run before merging, invoke it by
 * hand from the Netlify UI.
 *
 * **They get thirty seconds**, which is why the sweep budgets twenty and says
 * in its log when it ran out of them. Nothing here is urgent: a record it did
 * not reach today is a record it reaches tomorrow, and one it never reaches is
 * a few hundred bytes.
 *
 * There is no environment to set. `GATE_SECRET` is deliberately absent: this
 * function cannot mint, cannot verify, and cannot tell whose record is whose,
 * which is the least it can be trusted with and therefore the right amount.
 */

import { getStore } from '@netlify/blobs';

import { sweepSignIn, type SweepStore } from '../../src/auth/signinSweep';

/**
 * The store, or nothing, rather than the store or an exception.
 *
 * `getStore` throws when the Blobs context is not injected, so a bare call
 * here would take out the whole run with a stack trace and leave the sweep's
 * own "no blob store configured" line, and the empty report beside it, as
 * unreachable code. The same guard is on the two request functions.
 */
const store = (): SweepStore | null => {
  try {
    return getStore('log-signin') as unknown as SweepStore;
  } catch {
    return null;
  }
};

export default async (): Promise<void> => {
  await sweepSignIn({ store, now: Date.now });
};

export const config = { schedule: '@daily' };
