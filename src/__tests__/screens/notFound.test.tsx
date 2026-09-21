/**
 * The link that names nothing.
 *
 * `app.json` has declared `"scheme": "logpoker"` since the first build, so the
 * operating system hands this app any `logpoker://...` URL somebody taps, and
 * the web build answers every path under `/app`. Neither checks first that the
 * path is one of ours, and nothing in the app caught the ones that are not:
 * they fell through to the framework's own unmatched screen, which is a
 * debugging aid in the framework's default styling, saying "Unmatched Route"
 * to somebody who tapped a link a friend sent them.
 *
 * The screen is small, so what is worth pinning is small: that it names the
 * link, because that is the only thing anybody can act on, and that it has the
 * way back on it.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import NotFoundScreen from '../../../app/+not-found';

const pathname = { value: '/sesion/s1' };

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  usePathname: () => pathname.value,
  Stack: { Screen: () => null },
}));

const replace = jest.requireMock('expo-router').router.replace as jest.Mock;

beforeEach(() => {
  pathname.value = '/sesion/s1';
  replace.mockClear();
});

describe('a link that goes nowhere', () => {
  it('says so in the app’s own words rather than the framework’s', async () => {
    await renderScreen(<NotFoundScreen />);
    expect(screen.getByText('That link goes nowhere')).toBeTruthy();
    expect(screen.queryByText(/Unmatched Route/)).toBeNull();
  });

  it('names the link, which is the one thing anybody can act on', async () => {
    // Somebody reporting a link that does not work can say which link, and
    // somebody who typed it can see where the letter went missing.
    await renderScreen(<NotFoundScreen />);
    expect(screen.getByText(/\/sesion\/s1/)).toBeTruthy();
  });

  it('and offers the way back, which is the whole job after that', async () => {
    await renderScreen(<NotFoundScreen />);
    await userEvent.press(screen.getByText('Open your log'));
    expect(replace).toHaveBeenCalledWith('/');
  });
});
