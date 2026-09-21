/**
 * The ROI interval, computed when the answer can have changed and not before.
 *
 * ## The problem this exists for
 *
 * `bootstrapRoi` resamples the whole entry list a couple of thousand times,
 * synchronously, and both the dashboard and the variance screen wanted it.
 * Each held it in a `useMemo` keyed on `sessions` -- which the store replaces
 * on every write and every sync, so the bootstrap re-ran after a rebuy, after
 * a cash-out, after a pull landed, and on hydrate before the dashboard had
 * drawn anything. Measured on a desktop, 500 entries cost 685ms of blocked
 * JavaScript; a phone is several times that.
 *
 * None of those events changes a tournament result. So the key is the results
 * themselves, via `entriesSignature`, and the work happens on the one thing
 * that can move the number: a tournament being entered, or cashed out, or
 * edited, or arriving from another device.
 *
 * ## Why state adjusted during render, rather than a `useMemo`
 *
 * The honest dependency is the signature, and the value it guards is derived
 * from the array: a `useMemo` keyed on the array recomputes on the array, and
 * one keyed on the signature alone is a lie about its own inputs. So this is
 * React's own "adjusting state when a prop changes" pattern -- the same one
 * the session screen uses to re-seed its notes draft -- which says what is
 * actually happening: one cached answer, replaced when the signature it came
 * from no longer matches. A ref would do the same thing and is not allowed to
 * be read during render.
 *
 * The cache is per mounting rather than module-wide. Two screens mounted at
 * once compute it twice, which is the price of not holding a player's entry
 * list alive in a module for the life of the app; and the second screen is the
 * variance tab, which is not on screen at the same time as the dashboard.
 */

import { useMemo, useState } from 'react';

import {
  bootstrapRoi,
  entriesSignature,
  toEntryResults,
  type EntryResult,
  type RoiInterval,
} from '../../domain/tournaments';
import type { SessionWithChildren } from '../../domain/types';

/** The entries a bootstrap would run over, rebuilt only when the sessions move. */
export const useEntryResults = (
  sessions: readonly SessionWithChildren[],
): EntryResult[] => useMemo(() => toEntryResults(sessions), [sessions]);

/**
 * The interval over those entries, recomputed only when they differ.
 *
 * At the default confidence level, which is the only one either caller asks
 * for: the 70/90/95 switch on the variance screen belongs to the stretch band,
 * which is closed-form arithmetic and costs nothing to redo. If a caller ever
 * needs to vary it here, the level goes in the key beside the signature.
 */
export const useRoiInterval = (results: readonly EntryResult[]): RoiInterval | null => {
  const key = useMemo(() => entriesSignature(results), [results]);
  const [cache, setCache] = useState<{ key: string; value: RoiInterval | null }>(() => ({
    key,
    value: bootstrapRoi(results),
  }));

  if (cache.key !== key) {
    const next = { key, value: bootstrapRoi(results) };
    setCache(next);
    // Returned rather than waiting for the re-render this schedules: React
    // restarts the render immediately, but the interval belongs to the entries
    // this render was given and there is no reason to show the previous one
    // for a frame.
    return next.value;
  }
  return cache.value;
};
