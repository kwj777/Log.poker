/**
 * Collecting what the sign-in store has stopped reading.
 *
 * `/api/signin` writes one small record per address it has ever mailed and one
 * per caller it has ever counted, and until now it wrote them forever. Neither
 * grows: a second mail to the same address overwrites the first record, so the
 * store's size is the number of addresses ever typed into the form rather than
 * the number of times they were. That is the good case. The bad one is the
 * reason this exists at all, because the form mails anybody: a script pointed
 * at the free door for a week leaves a record for every address it invented,
 * and none of them is ever coming back.
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
 * This is the tombstone lesson from `SYNC.md` in miniature, and it needs less
 * margin than that one did: there is no second party holding state that has to
 * hear about the collection, so the horizon is exactly the last moment either
 * path here would look, with nothing added for a device that has been in a
 * drawer. What it shares is the shape of the failure. Collecting too early
 * does not break anything today; it quietly loosens a bound, months later, in
 * a place nobody is watching.
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

/** What this needs from a blob store, and nothing more. It never writes. */
export interface SweepStore {
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

export interface Surroundings {
  store: () => SweepStore | null;
  now: () => number;
}

/**
 * How long a run gives itself, against a platform limit of thirty seconds.
 *
 * The ten seconds left over are for the listing, which happens inside the
 * budget, and for the last batch to finish after the clock is checked. A run
 * that is cut off by the platform instead reports nothing at all, and a sweep
 * nobody can read the results of is most of the way to no sweep.
 */
export const SWEEP_BUDGET_MS = 20 * 1000;

/**
 * Records looked at together.
 *
 * Every decision needs a `get`, because a listing carries keys and etags and
 * no values, so a serial sweep is one round trip per record and gets through a
 * few hundred before the budget is gone. Twenty at a time is not a tuned
 * number; it is the difference between a sweep that finishes and one that
 * never reaches the end of the store.
 */
export const SWEEP_BATCH = 20;

export interface SweepReport {
  /** Keys the listing returned, across both prefixes. */
  found: number;
  /** Of those, the ones this run got to before the budget ran out. */
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
 * The listing is in key order and a truncated run always stops at the same
 * end of it, so a store larger than one run can examine would sweep its head
 * repeatedly and never reach its tail. That is a real defect and not yet a
 * real problem: the head shrinks as it is collected, and getting there needs
 * more addresses than this app has had visitors. The fix when it arrives is a
 * stored cursor to start the next run from, which is why `finished` is
 * reported rather than inferred.
 */
export const sweepSignIn = async ({ store: open, now }: Surroundings): Promise<SweepReport> => {
  const report: SweepReport = { found: 0, examined: 0, collected: 0, failed: 0, finished: true };

  const store = open();
  if (store === null) {
    console.error('signin-sweep: no blob store configured');
    return report;
  }

  const deadline = now() + SWEEP_BUDGET_MS;
  const keys: string[] = [];
  try {
    for (const prefix of [CODE_PREFIX, CALLER_PREFIX]) {
      const listing = await store.list({ prefix });
      for (const blob of listing.blobs) keys.push(blob.key);
    }
  } catch {
    console.error('signin-sweep: could not list the store');
    report.finished = false;
    return report;
  }
  report.found = keys.length;

  for (let at = 0; at < keys.length; at += SWEEP_BATCH) {
    if (now() >= deadline) {
      report.finished = false;
      console.error(
        `signin-sweep: out of time with ${keys.length - report.examined} records unexamined`,
      );
      break;
    }

    const batch = keys.slice(at, at + SWEEP_BATCH);
    const verdicts = await Promise.all(
      batch.map(async (key): Promise<'collected' | 'kept' | 'failed'> => {
        try {
          const value = await store.get(key, { type: 'json' });
          // Gone between the listing and now. Nothing to do and nothing wrong:
          // the other way a record leaves is being redeemed.
          if (value === null || value === undefined) return 'kept';
          if (!collectable(key, value, now())) return 'kept';
          await store.delete(key);
          return 'collected';
        } catch {
          return 'failed';
        }
      }),
    );

    report.examined += batch.length;
    for (const verdict of verdicts) {
      if (verdict === 'collected') report.collected += 1;
      if (verdict === 'failed') report.failed += 1;
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
