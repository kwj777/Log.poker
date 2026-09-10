/**
 * What a render throwing looks like now.
 *
 * Expo Router ships an `ErrorBoundary` and does not apply it: a route is
 * wrapped only if it exports one, and nothing did. So a throw anywhere in the
 * tree unmounted the tree, and on web that is a white page with nothing to do
 * next.
 *
 * The wiring is what these test, through the real `Try` the router wraps a
 * route in -- not a stand-in for it -- because a boundary that is written and
 * not reached is the same as no boundary at all.
 */

import { render, screen, userEvent } from '@testing-library/react-native';
import { Try } from 'expo-router/build/views/Try';

import { ErrorBoundary } from '../../../app/_layout';
import { ErrorScreen } from '../../components/ErrorScreen';

jest.mock('expo-router', () => ({
  Stack: () => null,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

/**
 * Throws while the test says to, which is not the same as throwing once.
 *
 * Deciding inside the render and mutating a counter as it goes does not
 * survive React's development double-invoke: the first call throws, the second
 * finds the counter already spent and renders happily, and the boundary never
 * sees anything. The switch is flipped from the test instead.
 */
const broken = { yes: true, message: 'the bankroll curve fell over' };

const Flaky = () => {
  if (broken.yes) throw new Error(broken.message);
  return <ErrorScreen title="Recovered" detail="all better" onRetry={() => undefined} />;
};

/** React logs a caught error, which is noise here rather than information. */
let quiet: jest.SpyInstance;
beforeEach(() => {
  broken.yes = true;
  broken.message = 'the bankroll curve fell over';
  quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  quiet.mockRestore();
});

describe('a screen that throws', () => {
  it('is caught rather than taking the tree with it', async () => {
    await render(
      <Try catch={ErrorBoundary}>
        <Flaky />
      </Try>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('says what went wrong, because "it broke" is not a bug report', async () => {
    await render(
      <Try catch={ErrorBoundary}>
        <Flaky />
      </Try>,
    );
    expect(screen.getByText('the bankroll curve fell over')).toBeTruthy();
  });

  it('offers a way back, and the way back works', async () => {
    await render(
      <Try catch={ErrorBoundary}>
        <Flaky />
      </Try>,
    );

    // Whatever it was is over now, which is the case retry exists for.
    broken.yes = false;
    await userEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Recovered')).toBeTruthy();
  });

  it('still says something when the error carries no message', async () => {
    broken.message = '';
    await render(
      <Try catch={ErrorBoundary}>
        <Flaky />
      </Try>,
    );
    expect(screen.getByText('This screen stopped working.')).toBeTruthy();
  });
});

describe('the error screen itself', () => {
  it('does not need a safe-area provider above it', async () => {
    // The tree it replaces is the tree that would have provided one: the
    // boundary catches the root layout throwing, and the root layout is what
    // renders `SafeAreaProvider`. Rendered bare here on purpose.
    await render(<ErrorScreen title="Gone" detail="wrong" onRetry={() => undefined} />);
    expect(screen.getByText('Gone')).toBeTruthy();
  });
});
