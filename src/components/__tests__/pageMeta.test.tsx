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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('and is the only thing setting one, so the router carries no titles', () => {
    // `_layout.tsx` carried eleven `title:` options under a comment saying
    // expo-router writes them to `document.title` on the web. It does not:
    // `ExpoRoot` passes `documentTitle: { enabled: false }` and the fork's
    // `useDocumentTitle` returns before either write. Confirmed in the
    // shipped bundle, where that object is emitted as `{enabled:!1}`.
    //
    // They cost nothing and were never read, which is why one had already
    // drifted: the layout said "Log a hand · Log" where `session/hand.tsx`
    // emits "Edit hand · Log" on the edit path. A second copy of a string
    // nobody reads is a second copy that can disagree.
    const layout = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/\btitle:/);
    expect(layout).toContain('<PageMeta');
  });
});
