/**
 * Collecting what the sign-in store has stopped reading.
 *
 * `/api/signin` writes one small record per address it has ever mailed and one
 * per caller it has ever counted, and until this existed it wrote them
 * forever. Neither grows: a second mail to the same address overwrites the
 * first record, so the store's size is the number of addresses ever typed into
 * the form rather than the number of times they were. That is the good case.
 * The bad one is the reason this exists at all, because the form mails anybody:
 * a script pointed at the free door for a week leaves a record for every
 * address it invented, and none of them is ever coming back.
 *
 * ## The rule, in one sentence
 *
 * **A record is collectable exactly when neither request path would read
 * anything from it.** That is the whole design, and it is worth stating that
 * way rather than as two arithmetic conditions, because it is the version that
 * stays true when somebody changes the conditions. Every predicate below is
 * imported from `signinEndpoint.ts` rather than restated here, so the two
 * files cannot drift into disagreeing about what a live record is.
 *
 * For an address that means both of:
 *
 *   Its window has rolled.   `windowRolled`. The record carries `sent` and
 *                            `windowStartedAt`, which are what hold an address
 *                            to five mails a day. **Collecting one inside its
 *                            window hands that budget straight back**, and
 *                            somebody who wanted more than five mails sent to
 *                            a stranger would only have to wait for the sweep.
 *   Its code has expired.    Not implied by the first, and this is the case
 *                            that makes the rule two conditions instead of
 *                            one: a code asked for at twenty-three hours and
 *                            fifty-nine minutes into a window is live for
 *                            fifteen minutes *past* the roll. Collecting on
 *                            the window alone would kill a code somebody was
 *                            at that moment reading off their phone, rarely,
 *                            and silently.
 *
 * For a caller it means the hour has run out, which is the same rule with only
 * one clock in it.
 *
 * ## The rule is not enough on its own, and the first version thought it was
 *
 * Deciding correctly about a record you are not actually looking at is not
 * deciding correctly. Two things nearly made that happen, both found by an
 * audit of this file after it had already shipped, and both the same shape as
 * defects `SYNC.md` records next door.
 *
 * **The read is strongly consistent.** Netlify Blobs reads eventually by
 * default, from a cache that can lag by up to a minute. So a sweep firing at
 * midnight could be handed a copy of a record from a minute earlier, judge
 * *that* collectable, and delete the record that had replaced it in the
 * meantime: a live code, and a mail budget reset to zero, from one stale read.
 * `src/sync/endpoint.ts` already learned this and says so in its header; this
 * had to learn it too.
 *
 * **And a record is collected only if it has not changed since the listing.**
 * The listing hands back an etag with every key, so the read can check that
 * what it is about to delete is what it was told about. Anything rewritten in
 * between is left for tomorrow. This matters because the platform has no
 * conditional delete: `Store.delete` takes a key and nothing else, so the last
 * hop cannot be guarded and the honest thing is to shrink what reaches it. A
 * read with no etag at all is refused for the same reason `guardFor` refuses
 * one in the sync endpoint: an unverifiable write is the blind overwrite the
 * check exists to avoid, wearing a check's clothes.
 *
 * What is left after those two is a race between this read and this delete,
 * measured in the milliseconds of one round trip, which the platform gives no
 * way to close. Losing it costs one person one retry of a sign-in they were
 * already making. That is the residue, and it is named here rather than
 * implied.
 *
 * ## Why this is a scheduled function and not part of a request
 *
 * The tempting version sweeps a little on every sign-in, which needs no
 * schedule and no extra deploy. It also puts a list of the whole store in
 * front of somebody waiting for a code, and it does the most work exactly when
 * the endpoint is busiest, which is during the abuse it exists to clean up
 * after. Once a day, off to one side, is the cheaper end of that trade.
 */

import {
  CALLER_PREFIX,
  CODE_PREFIX,
  isCaller,
  isPending,
  windowRolled,
} from './signinEndpoint';

/**
 * What this needs from a blob store, and nothing more. It never writes.
 *
 * The read is `getWithMetadata` rather than `get` for the etag, which is half
 * of what makes the delete safe, and it is asked for strongly because the
 * other half is looking at the record that is actually there. See the header.
 */
export interface SweepStore {
  getWithMetadata(
    key: string,
    options: { type: 'json'; consistency: 'strong' },
  ): Promise<{ data: unknown; etag?: string } | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ blobs: { key: string; etag: string }[] }>;
}

export interface Surroundings {
  store: () => SweepStore | null;
  now: () => number;
}

/**
 * How long a run gives itself, against a platform limit of thirty seconds.
 *
 * The ten seconds left over are for the last operation to finish after the
 * clock has been checked. That slack used to be a hope rather than a bound:
 * the blobs client retries a 429 or a 5xx five times with five seconds between
 * attempts, so one unlucky key could sleep for twenty-five seconds inside a
 * batch nothing was watching, and the run was killed at thirty with the
 * truncation line it exists to print still unwritten. Every operation is now
 * raced against the time actually left, so no single record can outlive the
 * budget and the report always gets written.
 */
export const SWEEP_BUDGET_MS = 20 * 1000;

/**
 * Records looked at together.
 *
 * Every decision needs a read, because a listing carries keys and etags and no
 * values, so a serial sweep is one round trip per record and gets through a
 * few hundred before the budget is gone. Twenty at a time is not a tuned
 * number; it is the difference between a sweep that finishes and one that
 * never reaches the end of the store.
 */
export const SWEEP_BATCH = 20;

export interface SweepReport {
  /** Keys the listing returned, across both prefixes. */
  found: number;
  /** Of those, the ones this run reached a decision about. */
  examined: number;
  collected: number;
  /** Reads or deletes that threw. A record left behind is next run's. */
  failed: number;
  /** False when the budget ended the run early. See the header on starving. */
  finished: boolean;
}

/**
 * Whether nothing would read this record any more.
 *
 * A key under neither prefix is left alone. Nothing writes one today, and
 * "delete what you do not recognize" is the wrong instinct for the one store
 * in this repository that holds anything security relevant.
 */
const collectable = (key: string, value: unknown, now: number): boolean => {
  if (key.startsWith(CODE_PREFIX)) {
    // Not a record this file understands, which means it is not one
    // `signinEndpoint.ts` understands either: both sides ask `isPending`, and
    // that path treats a no as absent and overwrites it. So it is collectable
    // for the same reason it is unreadable. **If the record shape changes,
    // `isPending` has to change with it**, or this line eats the new one.
    if (!isPending(value)) return true;
    return windowRolled(value, now) && value.expiresAt <= now;
  }
  if (key.startsWith(CALLER_PREFIX)) {
    if (!isCaller(value)) return true;
    return value.resetAt <= now;
  }
  return false;
};

type Verdict = 'collected' | 'kept' | 'failed' | 'expired';

/**
 * The work, or a giving-up, whichever comes first.
 *
 * `work` never rejects, so the only thing the timer has to beat is a request
 * the platform is still retrying underneath us. Abandoning it does not cancel
 * it, which is fine: nothing has been decided, so nothing is half done.
 */
const within = (work: Promise<Verdict>, ms: number): Promise<Verdict> => {
  if (ms <= 0) return Promise.resolve('expired');
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<Verdict>((resolve) => {
      timer = setTimeout(() => resolve('expired'), ms);
    }),
  ]);
};

/**
 * One pass over the store.
 *
 * Returns what it did rather than logging it and returning nothing, so a test
 * can assert on the numbers. The one line it does log is the truncation,
 * because a sweep that silently stopped halfway looks exactly like a sweep
 * with nothing left to do.
 *
 * ## What truncation costs, and when it starts to matter
 *
 * A truncated run always stops at the same end of the key order, so a store
 * larger than one run can examine would sweep its head repeatedly and never
 * reach its tail. That is a real defect and not yet a real problem: the head
 * shrinks as it is collected, and getting there needs more addresses than this
 * app has had visitors. The fix when it arrives is a stored cursor to start
 * the next run from, which is why `finished` is reported rather than inferred.
 *
 * **The two prefixes are interleaved rather than concatenated**, which is the
 * one part of that not worth deferring. Listing the addresses and then the
 * callers put every caller record behind every address record, so the first
 * store big enough to truncate would have stopped collecting caller records
 * entirely rather than proportionally. Round-robin costs nothing and makes
 * truncation hit both kinds alike.
 */
export const sweepSignIn = async ({ store: open, now }: Surroundings): Promise<SweepReport> => {
  const report: SweepReport = { found: 0, examined: 0, collected: 0, failed: 0, finished: true };

  const store = open();
  if (store === null) {
    console.error('signin-sweep: no blob store configured');
    return report;
  }

  const deadline = now() + SWEEP_BUDGET_MS;
  const listings: { key: string; etag: string }[][] = [];
  try {
    for (const prefix of [CODE_PREFIX, CALLER_PREFIX]) {
      listings.push((await store.list({ prefix })).blobs);
    }
  } catch {
    console.error('signin-sweep: could not list the store');
    report.finished = false;
    return report;
  }

  const keys: { key: string; etag: string }[] = [];
  for (let i = 0; i < Math.max(...listings.map((one) => one.length), 0); i += 1) {
    for (const listing of listings) if (i < listing.length) keys.push(listing[i]);
  }
  report.found = keys.length;

  /** One record, from the listing's word for it to gone or left alone. */
  const examine = async (blob: { key: string; etag: string }): Promise<Verdict> => {
    try {
      const held = await store.getWithMetadata(blob.key, { type: 'json', consistency: 'strong' });
      // Gone between the listing and now. Nothing to do and nothing wrong: the
      // other way a record leaves is being redeemed.
      if (held === null) return 'kept';
      // Rewritten since the listing, or a read with no etag to check. Either
      // way this is not the record the listing described, and the delete below
      // cannot be made conditional, so the only safe answer is tomorrow.
      if (held.etag === undefined || held.etag !== blob.etag) return 'kept';
      if (!collectable(blob.key, held.data, now())) return 'kept';
      await store.delete(blob.key);
      return 'collected';
    } catch {
      return 'failed';
    }
  };

  const ranOut = () => {
    report.finished = false;
    console.error(
      `signin-sweep: out of time with ${keys.length - report.examined} records unexamined`,
    );
  };

  for (let at = 0; at < keys.length; at += SWEEP_BATCH) {
    if (now() >= deadline) {
      ranOut();
      break;
    }

    const verdicts = await Promise.all(
      keys.slice(at, at + SWEEP_BATCH).map((blob) => within(examine(blob), deadline - now())),
    );

    for (const verdict of verdicts) {
      if (verdict === 'expired') continue;
      report.examined += 1;
      if (verdict === 'collected') report.collected += 1;
      if (verdict === 'failed') report.failed += 1;
    }

    if (verdicts.includes('expired')) {
      ranOut();
      break;
    }
  }

  if (report.failed > 0) {
    console.error(`signin-sweep: ${report.failed} records could not be read or deleted`);
  }
  console.log(
    `signin-sweep: ${report.collected} collected of ${report.examined} examined, ${report.found} found`,
  );
  return report;
};
