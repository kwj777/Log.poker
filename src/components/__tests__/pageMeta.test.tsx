/**
 * That the document head stays off the phone.
 *
 * `expo-router/head` is react-helmet on the web and an NSUserActivity
 * registrar on iOS, and the native half alerts the player about a missing
 * handoff origin from inside a render. Rendering the real thing here would
 * prove nothing either way: Jest loads no native module, so the import falls
 * back to a shim that renders null whether or not this component guards
 * against it. The stand-in below records that it ran, which is what makes the
 * guard visible.
 */

import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PageMeta } from '../PageMeta';

const mockHeadRendered = jest.fn();

jest.mock('expo-router/head', () => ({
  __esModule: true,
  default: () => {
    mockHeadRendered();
    return null;
  },
}));

beforeEach(() => {
  mockHeadRendered.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('page metadata', () => {
  it('renders nothing on a phone, where the head would alert about its origin', async () => {
    // Jest renders as iOS, which is the platform the alert comes from.
    expect(Platform.OS).toBe('ios');

    const view = await render(<PageMeta title="Sessions · Log" description="anything" />);

    expect(mockHeadRendered).not.toHaveBeenCalled();
    expect(view.toJSON()).toBeNull();
  });

  it('still renders on the web, which is the only place a tab title means anything', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');

    await render(<PageMeta title="Sessions · Log" description="anything" />);

    expect(mockHeadRendered).toHaveBeenCalled();
  });
});
