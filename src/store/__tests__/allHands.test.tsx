/**
 * Who pays for a read of the whole journal, and when.
 *
 * `useAllHands` goes to the repository rather than holding every hand in the
 * store, and its docstring says the cost is paid "while it is open". That was
 * true of the screen it was written for, which is pushed and popped. The other
 * caller is the Variance tab, and a bottom tab is mounted on first focus and
 * kept mounted: the hook stayed subscribed for the rest of the session, so
 * every hand written at the table paid for the most expensive read in the app
 * on a screen nobody was looking at, at the one moment it should be doing
 * least.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { Repository } from '../../data/repository';

const mockListHands = jest.fn(async () => [] as never[]);

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: mockListHands }) as unknown as Repository,
  onSyncApplied: () => () => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAllHands, useLogStore } = require('../useLogStore') as typeof import('../useLogStore');

beforeEach(() => {
  mockListHands.mockClear();
  useLogStore.setState({ handsVersion: 0 });
});

describe('a caller that can be off screen', () => {
  it('reads nothing while it says it is away', async () => {
    const { rerender } = await renderHook(({ on }: { on: boolean }) => useAllHands(on), {
      initialProps: { on: false },
    });
    expect(mockListHands).not.toHaveBeenCalled();

    // A hand is logged while the tab is behind another one.
    await act(async () => {
      useLogStore.setState((state) => ({ handsVersion: state.handsVersion + 1 }));
    });
    expect(mockListHands).not.toHaveBeenCalled();

    // And catches up in one read when it comes back, rather than not at all.
    await act(async () => {
      rerender({ on: true });
    });
    expect(mockListHands).toHaveBeenCalledTimes(1);
  });

  it('and a caller that says nothing is read for, as it always was', async () => {
    await renderHook(() => useAllHands());
    expect(mockListHands).toHaveBeenCalledTimes(1);

    await act(async () => {
      useLogStore.setState((state) => ({ handsVersion: state.handsVersion + 1 }));
    });
    expect(mockListHands).toHaveBeenCalledTimes(2);
  });
});
