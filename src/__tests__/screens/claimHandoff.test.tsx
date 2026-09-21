/**
 * What a hand-off link is allowed to do without being asked.
 *
 * The screen already stops and asks when the device is signed in as somebody
 * else, for a reason it states: on this side a change of subject is a change
 * of bucket. A device signed in as nobody has the same problem pointing the
 * other way, and it was not being asked.
 *
 * `settle` answers a first sign-in with `pushed: 0`, meaning send everything
 * from the beginning. That is the point of signing in, when the account is
 * yours. When the link came from somebody else it means every session on this
 * device lands in their bucket, and nothing on this side can take that back.
 */

import { Platform } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import ClaimScreen from '../../../app/claim';

const mockSignIn = jest.fn(async (_token: string) => ({ subject: 'them', tier: 'free' }));
const mockGetSession = jest.fn(async (): Promise<unknown> => null);
const mockClaim = jest.fn(async (_code: string) => ({ ok: true, token: 'a.b.c.d' }));
const mockListSessions = jest.fn(async () => [] as unknown[]);
const mockRecompose = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

jest.mock('../../auth', () => ({
  getSession: () => mockGetSession(),
  signIn: (token: string) => mockSignIn(token),
}));

jest.mock('../../auth/handoff', () => ({
  claimHandoff: (code: string) => mockClaim(code),
  codeFromFragment: () => 'dkbiLReh_P_zqqLzPxrHqSpOx_netFX_FoLM9Od52xg',
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listSessions: mockListSessions }),
  recomposeRepository: () => mockRecompose(),
  onSyncApplied: () => () => undefined,
}));

/**
 * This screen is web only, and the ui project runs as native.
 *
 * `/app/claim` is a URL somebody follows in a browser; on a phone it says so
 * and stops. So the platform and the window it reads the fragment out of are
 * both stood up here, which is the only way to exercise the path that matters.
 */
const realOS = Platform.OS;
beforeAll(() => {
  (Platform as { OS: string }).OS = 'web';
  (globalThis as { window?: unknown }).window = {
    location: { hash: '#code=dkbiLReh_P_zqqLzPxrHqSpOx_netFX_FoLM9Od52xg', pathname: '/app/claim', search: '' },
    history: { replaceState: () => undefined },
  };
});
afterAll(() => {
  (Platform as { OS: string }).OS = realOS;
  delete (globalThis as { window?: unknown }).window;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockImplementation(async () => null);
  mockListSessions.mockImplementation(async () => []);
});

describe('a link that arrives at a device with a log on it', () => {
  it('asks before it signs that log in to somebody else', async () => {
    mockListSessions.mockImplementation(async () => [session('s1')]);
    await renderScreen(<ClaimScreen />);

    expect(await screen.findByText(/sessions already on this device/i)).toBeTruthy();
    // Nothing has been kept, and nothing has been recomposed to sync with.
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockRecompose).not.toHaveBeenCalled();
  });

  it('and does nothing at all when the answer is no', async () => {
    mockListSessions.mockImplementation(async () => [session('s1')]);
    await renderScreen(<ClaimScreen />);
    await screen.findByText(/sessions already on this device/i);

    await userEvent.press(screen.getByText('Leave this device as it is'));

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockRecompose).not.toHaveBeenCalled();
  });

  it('and signs in when the answer is yes', async () => {
    mockListSessions.mockImplementation(async () => [session('s1')]);
    await renderScreen(<ClaimScreen />);
    await screen.findByText(/sessions already on this device/i);

    await userEvent.press(screen.getByText('Sign in to that account'));

    expect(mockSignIn).toHaveBeenCalledWith('a.b.c.d');
    expect(mockRecompose).toHaveBeenCalled();
  });
});

describe('a link that arrives at an empty device', () => {
  it('takes it without asking, because there is nothing to lose', async () => {
    // The ordinary way in, and the whole point of this screen: install Log,
    // follow the link from the app you already have, and be signed in.
    await renderScreen(<ClaimScreen />);

    await screen.findByText(/Done\./i);
    expect(mockSignIn).toHaveBeenCalledWith('a.b.c.d');
    expect(screen.queryByText(/sessions already on this device/i)).toBeNull();
  });
});
