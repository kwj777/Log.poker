/**
 * How big the thing this endpoint just handled was.
 *
 * There is one open question about the bundle -- whether it needs a size cap --
 * and it cannot be answered from here. What a synthetic twenty-year log weighs
 * is known; whether anybody's real log is anywhere near it is not, and no
 * amount of reasoning will produce that number. So the endpoint says how big
 * each bundle was and the question gets settled by observation.
 *
 * ## Records, not bytes
 *
 * Measuring bytes means `JSON.stringify` on the whole bundle, and `setJSON` is
 * already going to do exactly that: the measurement would double the most
 * expensive thing in the request. On a twenty-year bundle that is 23ms of
 * serializing to find out how much serializing costs.
 *
 * Counting records is 2ms for the same bundle, and it is a faithful proxy --
 * across bundles from one year to twenty, measured against the real merge, a
 * record is almost exactly 300 bytes and the relationship is linear with no
 * knee. So the count is what is logged and the size is an estimate derived from
 * it, which is the honest way round: one number measured, one plainly labeled
 * as arithmetic.
 *
 * ## It names nobody
 *
 * The bucket is an HMAC of the subject precisely so the store never holds a
 * customer id. Putting that bucket in a log line would undo it -- a stable
 * per-person handle, in the deploy log, next to how much poker they play. So a
 * line carries sizes and durations and nothing that identifies whose they are.
 * The distribution is what the decision needs; who is in it is not.
 *
 * ## Only the tail
 *
 * A line for every sync would bury the deploy log under the ordinary, and the
 * ordinary is not what is being asked about. Nothing is said below
 * `NOTABLE_RECORDS`, which is roughly a year of heavy play.
 *
 * The cost of that is worth naming: **silence means "nobody is large" only once
 * you know the path runs at all**, and an empty log looks identical to a broken
 * one. The tests below are what tells those apart; lower the floor for an hour
 * if a deploy ever needs to prove it to itself.
 */

import type { Bundle } from './protocol';

/**
 * Measured, not assumed: bundles built a year at a time through the real
 * `mergeIntoBundle` come out at 0.29MB for 1,012 records and 5.89MB for
 * 20,012, which is 300 bytes a record either end.
 */
export const BYTES_PER_RECORD = 300;

/** Below this, nothing is said. About a year of heavy play. */
export const NOTABLE_RECORDS = 1_000;

/** The 2MB in the design note, in the unit actually counted. */
export const WATCH_RECORDS = 6_800;

/** And the other threshold from it, which is measured directly. */
export const WATCH_MERGE_MS = 50;

export interface Observation {
  records: number;
  /** Arithmetic from the count, never a second serialization. */
  estimatedBytes: number;
  mergeMs: number;
  /** How many goes at the write race this request took. */
  rounds: number;
  /** Crossed one of the lines the design note says to watch. */
  watch: boolean;
}

/** Cheap: five key lists rather than one whole serialization. */
export const countRecords = (bundle: Bundle): number =>
  Object.values(bundle.records).reduce((total, table) => total + Object.keys(table).length, 0);

/**
 * What to say about this request, or nothing.
 *
 * Null rather than a quiet observation, so the caller cannot log by accident:
 * there is no line to write unless this returns one.
 */
export const observe = (
  records: number,
  mergeMs: number,
  rounds: number,
): Observation | null => {
  const watch = records >= WATCH_RECORDS || mergeMs >= WATCH_MERGE_MS || rounds > 1;
  if (!watch && records < NOTABLE_RECORDS) return null;

  return {
    records,
    estimatedBytes: records * BYTES_PER_RECORD,
    mergeMs: Math.round(mergeMs),
    rounds,
    watch,
  };
};

/** One line, and nothing in it says whose bundle this was. */
export const describe = (seen: Observation): string => {
  const mb = (seen.estimatedBytes / 1_048_576).toFixed(2);
  const crossed = [
    seen.records >= WATCH_RECORDS ? `records>=${WATCH_RECORDS}` : null,
    seen.mergeMs >= WATCH_MERGE_MS ? `merge>=${WATCH_MERGE_MS}ms` : null,
    seen.rounds > 1 ? 'contended' : null,
  ].filter((one): one is string => one !== null);

  return (
    `sync: bundle ${seen.records} records (~${mb}MB est), ` +
    `merged in ${seen.mergeMs}ms, ${seen.rounds} round${seen.rounds === 1 ? '' : 's'}` +
    (crossed.length > 0 ? ` -- watch: ${crossed.join(', ')}` : '')
  );
};
