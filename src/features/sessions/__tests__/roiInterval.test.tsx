/**
 * How often the ROI bootstrap actually runs.
 *
 * It resamples the whole entry list a couple of thousand times and it does it
 * on the JavaScript thread: 500 entries measured at 685ms on a desktop, and a
 * phone is several times that. Both screens that wanted it had it in a
 * `useMemo` keyed on `sessions`, which the store replaces on every write and
 * every sync -- so a rebuy, a cash-out, a hand and an arriving sync all paid
 * for a number none of them can change.
 *
 * These tests are about that and not about the interval, which
 * `domain/__tests__/tournaments.test.ts` covers.
 *
 * They assert on **reference identity**, not on values. `bootstrapRoi` builds
 * a fresh object every call, so the same object coming back out is proof that
 * it was not called again, and a spy on the module would only prove that Babel
 * bound the import the way the spy wanted.
 */

import { renderHook } from '@testing-library/react-native';

import { session } from '../../../__tests__/support/sessions';
import { useEntryResults, useRoiInterval } from '../useRoiInterval';
import type { SessionWithChildren } from '../../../domain/types';

/** A finished tournament entry, which is the only thing the bootstrap reads. */
const entry = (id: string, cashOut: number): SessionWithChildren =>
  session(id, { format: 'tournament', stakes: null, buyIn: 10_000, fee: 1_000, cashOut });

/** Enough entries to clear `MIN_ENTRIES_FOR_INTERVAL`. */
const twelve = (): SessionWithChildren[] =>
  Array.from({ length: 12 }, (_, i) => entry(`t${i}`, i % 4 === 0 ? 40_000 : 0));

describe('the interval the dashboard and the variance screen share', () => {
  /**
   * Every value the hook returned, in order, including the ones React threw
   * away.
   *
   * `renderHook` writes `result.current` from an effect, so it only ever holds
   * committed renders -- which is the one thing the last test in this file
   * needs to see past. See there.
   */
  let returned: (ReturnType<typeof useRoiInterval>)[] = [];

  const render = (initial: SessionWithChildren[]) => {
    returned = [];
    return renderHook(
      ({ sessions }: { sessions: SessionWithChildren[] }) => {
        // Exactly what a screen does, both hooks together.
        const results = useEntryResults(sessions);
        const interval = useRoiInterval(results);
        returned.push(interval);
        return interval;
      },
      { initialProps: { sessions: initial } },
    );
  };

  it('is an interval at all, so the rest of these mean something', async () => {
    const view = await render(twelve());
    expect(view.result.current?.entries).toBe(12);
  });

  it('is not recomputed when the store merely hands out a new array', async () => {
    // The case that made this expensive. `sessions` is replaced wholesale by
    // every `refresh`, so the array is new and the tournaments in it are not.
    const view = await render(twelve());
    const first = view.result.current;

    await view.rerender({ sessions: twelve() });
    await view.rerender({ sessions: twelve() });
    expect(view.result.current).toBe(first);
  });

  it('and not when a cash session is logged beside them', async () => {
    // A cash game is not an entry, so it cannot move a tournament ROI. This is
    // the rebuy-during-a-cash-game case, which used to cost the full run.
    const view = await render(twelve());
    const first = view.result.current;

    await view.rerender({ sessions: [...twelve(), session('cash-1'), session('cash-2')] });
    expect(view.result.current).toBe(first);
  });

  it('but is recomputed when a tournament result changes', async () => {
    const view = await render(twelve());
    const first = view.result.current;

    await view.rerender({ sessions: [...twelve(), entry('t99', 250_000)] });
    expect(view.result.current).not.toBe(first);
    expect(view.result.current?.entries).toBe(13);
  });

  it('and the new answer is there in that render, not the one after it', async () => {
    // The cache is state adjusted during render, so there is a re-render in
    // here. Showing the previous interval for a frame while the new one lands
    // would be its own bug, and it is invisible to `result.current`:
    // `renderHook` assigns that from an effect, so it holds only committed
    // renders and reads the same either way. This asserted on it, which made
    // it a weaker restatement of the test above rather than a check on the
    // `return next.value` in the hook.
    //
    // So: every value the hook handed back across the rerender, the discarded
    // render included. Returning `cache.value` there puts the old interval in
    // that list.
    const view = await render(twelve());
    const before = view.result.current;

    returned.length = 0;
    await view.rerender({ sessions: [...twelve(), entry('t99', 250_000)] });

    expect(returned.length).toBeGreaterThan(0);
    expect(returned).not.toContain(before);
  });
});
