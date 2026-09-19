/**
 * The running-session clock, across the one event it used to sleep through.
 *
 * `useElapsed` ticks once a minute, which is the right rate for a display with
 * minute resolution and the wrong one for a phone that has been in a pocket.
 * iOS suspends JS timers the moment the app leaves the front, so the `now` the
 * hook is holding stops at the moment of the suspend and the interval does not
 * fire again for up to a full minute after the app comes back. For that minute
 * the live session screen shows an elapsed time that is short by however long
 * the phone was away, which is the one number somebody reopens this app to
 * read.
 *
 * A `.tsx` file because `AppState` comes from React Native and this suite is
 * the one with a React Native environment in it, not because anything renders.
 *
 * `renderHook` and `act` are awaited throughout: both are asynchronous in
 * `@testing-library/react-native` 14, and a forgotten await here does not fail
 * loudly, it hands back an undefined result.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useElapsed } from '../LiveTimer';

/** The listeners the hook registers, so a test can be the operating system. */
let listeners: ((state: AppStateStatus) => void)[] = [];
let removed = 0;

const START = 1_700_000_000_000;

beforeEach(() => {
  listeners = [];
  removed = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    listeners.push(handler as (state: AppStateStatus) => void);
    return {
      remove: () => {
        removed += 1;
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** What the operating system sends on the way to and from the front. */
const announce = async (state: AppStateStatus) => {
  await act(async () => {
    for (const listener of listeners) listener(state);
  });
};

/**
 * Let time pass.
 *
 * `advanceTimersByTime` moves the faked `Date.now()` along with the timer
 * wheel, so setting the system time as well here would double every interval:
 * the first draft did, and one minute of it read as two.
 */
const pass = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

describe('the elapsed clock', () => {
  it('counts from the start time it was given', async () => {
    jest.setSystemTime(START + 90 * 60_000);
    const { result } = await renderHook(() => useElapsed(START));
    expect(result.current).toBe(90 * 60_000);
  });

  it('is zero, rather than the time since the epoch, when there is no session', async () => {
    const { result } = await renderHook(() => useElapsed(null));
    expect(result.current).toBe(0);
  });

  it('never runs backwards, whatever the clock says', async () => {
    // A start time in the future is what a device whose clock was corrected
    // mid-session looks like. A negative duration formats as nonsense; zero is
    // merely early.
    const { result } = await renderHook(() => useElapsed(START + 60_000));
    expect(result.current).toBe(0);
  });

  it('advances on its own once a minute', async () => {
    const { result } = await renderHook(() => useElapsed(START));
    expect(result.current).toBe(0);
    await pass(60_000);
    expect(result.current).toBe(60_000);
  });

  it('and not once a second, because the display has no second to show', async () => {
    // 60x fewer wake-ups for no visible change, on a phone that is going to be
    // holding this screen for six hours.
    const { result } = await renderHook(() => useElapsed(START));
    await pass(59_000);
    expect(result.current).toBe(0);
  });
});

describe('coming back to the front', () => {
  it('reads the clock at once, rather than waiting out the rest of the minute', async () => {
    // This is the regression. Four hours away, no timer fired while suspended,
    // and the first frame back has to already be right.
    const { result } = await renderHook(() => useElapsed(START));
    expect(result.current).toBe(0);

    jest.setSystemTime(START + 4 * 60 * 60_000);
    await announce('active');

    expect(result.current).toBe(4 * 60 * 60_000);
  });

  it('listens for that, rather than trusting a timer to have survived', async () => {
    await renderHook(() => useElapsed(START));
    expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('ignores the states that are not the app being on screen', async () => {
    const { result } = await renderHook(() => useElapsed(START));
    jest.setSystemTime(START + 60 * 60_000);
    await announce('background');
    await announce('inactive');
    // Going away is not a reason to re-read the clock. Coming back is, and
    // re-reading on the way out would hide a broken resume behind a value that
    // happened to be right.
    expect(result.current).toBe(0);
  });

  it('and lets go of both subscriptions when the screen does', async () => {
    // Both, because they are one effect. An interval that outlives the screen
    // wakes the thread forever; a listener that does calls `setState` on
    // something unmounted every time the app is opened.
    //
    // Asserted against the interval this hook created rather than against
    // `jest.getTimerCount()`, which counts React's own scheduler timers too
    // and so never reaches zero.
    const started = jest.spyOn(global, 'setInterval');
    const cleared = jest.spyOn(global, 'clearInterval');

    const { unmount } = await renderHook(() => useElapsed(START));
    const id = started.mock.results.at(-1)?.value as unknown;
    expect(id).toBeDefined();

    await unmount();
    expect(cleared).toHaveBeenCalledWith(id);
    expect(removed).toBe(1);
  });
});
