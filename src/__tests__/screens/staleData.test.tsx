/**
 * A read that failed after the app was already open.
 *
 * `refresh` catches every read failure, records it on the store and leaves
 * `status` at `ready`. The root layout was the only reader of that field and
 * drew it inside the `status === 'error'` branch -- which only `hydrate` can
 * enter. So once the app was up, the catch wrote a value nothing could read
 * back: the rows on screen quietly stopped matching the database, and the
 * write that triggered the re-read still reported success.
 *
 * Three store actions carry a comment saying "a failed read here is the local
 * database being unavailable, which the root layout already reports". This is
 * what makes that sentence true.
 *
 * `StaleDataNote` on its own rather than the layout around it, the same way
 * `errorBoundary.test.tsx` takes `ErrorBoundary`: the layout hydrates in an
 * effect and brings its own `SafeAreaProvider`, and a test of this would spend
 * all of itself on neither.
 */

import { render, screen } from '@testing-library/react-native';

import { StaleDataNote } from '../../../app/_layout';
import { useLogStore } from '../../store/useLogStore';

// Only so importing the layout does not pull the real router in; nothing here
// renders a `Stack`.
jest.mock('expo-router', () => ({ Stack: () => null }));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
  syncOnResume: () => undefined,
}));

const at = (status: 'idle' | 'loading' | 'ready' | 'error', error: string | null) =>
  useLogStore.setState({ status, error });

describe('a read that did not land', () => {
  it('is drawn where somebody can see it, with the reason', async () => {
    at('ready', 'The database connection is closing');
    await render(<StaleDataNote />);

    expect(screen.getByText(/may be out of date/)).toBeTruthy();
    // The reason as well as the fact: a bug report that says "it broke" and
    // one that quotes a line are different reports.
    expect(screen.getByText(/The database connection is closing/)).toBeTruthy();
  });

  it('is announced rather than only drawn, because it appears under no tap', async () => {
    at('ready', 'The database connection is closing');
    const view = await render(<StaleDataNote />);
    expect(JSON.stringify(view.toJSON())).toContain('"accessibilityRole":"alert"');
  });

  it('says nothing at all while the reads are landing', async () => {
    at('ready', null);
    await render(<StaleDataNote />);
    expect(screen.toJSON()).toBeNull();
  });

  it('and nothing over the screen that is already about the database', async () => {
    // `status === 'error'` is `hydrate` failing, which takes the whole screen
    // because there is nothing to show behind it. Two notices about one
    // problem is worse than one.
    at('error', 'The local database could not be opened.');
    await render(<StaleDataNote />);
    expect(screen.toJSON()).toBeNull();
  });

  it('nor before the app has finished opening', async () => {
    at('loading', 'something from a previous run');
    await render(<StaleDataNote />);
    expect(screen.toJSON()).toBeNull();
  });
});
