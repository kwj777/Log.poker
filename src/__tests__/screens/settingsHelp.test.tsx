/**
 * The two things an app store looks for in Settings, and one a bug report
 * needs.
 *
 * None of this is a feature anybody asked for. A privacy policy URL is a field
 * App Store Connect will not accept a build without, a way to reach a person
 * is what a reviewer looks for once the rest of the screen is about deleting
 * things, and a build number is the first thing anybody asks about a bug and
 * the last thing anybody can find out.
 *
 * Rendered rather than read as source, because the failure worth catching is a
 * section that exists in the file and never reaches the screen.
 */

import { Linking } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import SettingsScreen from '../../../app/(tabs)/settings';
import { PRIVACY_POLICY, SUPPORT_EMAIL } from '../../config';
import { useLogStore } from '../../store/useLogStore';
import { releaseLabel } from '../../version';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// Neither is what this file is about, and the sign-in card reaches the whole
// auth stack to render a button.
jest.mock('../../features/account/SignInCard', () => ({ SignInCard: () => null }));
jest.mock('../../features/family/FamilyCrossPromo', () => ({ FamilyCrossPromo: () => null }));

jest.mock('../../features/export/saveCsv', () => ({
  CAN_SAVE_FILE: true,
  saveCsv: async () => ({ saved: true }),
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listSessions: async () => [], listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
  STORAGE_ENGINE: 'SQLite',
}));

/**
 * The config `releaseLabel` reads, supplied rather than inherited.
 *
 * `jest-expo` hands back a null `expoConfig`, so the real fallback fires and
 * the caption reads "Log" with no number in it. That is the right thing for it
 * to do in a test environment and the wrong thing to assert against, because a
 * caption that had genuinely lost its version would pass. The numbers here are
 * arbitrary on purpose: `src/__tests__/release.test.ts` is what holds app.json
 * to a real version, and this holds the label to a shape.
 */
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '9.8.7', ios: { buildNumber: '42' } } },
}));

let opened: string[] = [];

beforeEach(() => {
  opened = [];
  jest.spyOn(Linking, 'openURL').mockImplementation(async (url: string) => {
    opened.push(url);
    return true;
  });
  useLogStore.setState({
    status: 'ready',
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('help and legal', () => {
  it('is a section somebody can see, not a constant somebody can grep', async () => {
    // The whole failure this guards: `PRIVACY_POLICY` exported, referenced,
    // type-checked, and nowhere on the screen.
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText('Help and legal')).toBeTruthy();
  });

  it('opens the privacy policy at the address the config names', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Privacy policy'));
    expect(opened).toEqual([PRIVACY_POLICY]);
  });

  it('opens a mail window rather than a page nobody can write on', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Contact support'));
    expect(opened).toEqual([`mailto:${SUPPORT_EMAIL}`]);
  });

  it('and prints the address as well, for the phone that has no mail app set up', async () => {
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy();
  });

  it('survives that phone refusing the link, rather than rejecting into nothing', async () => {
    // `openURL` rejects when nothing handles the scheme, which is exactly the
    // phone the test above is written for. Both buttons called it bare, so the
    // rejection had nowhere to go: a red box in development and silence in a
    // shipped build. Jest fails this test on an unhandled rejection, which is
    // what makes it a tripwire rather than a wish.
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await renderScreen(<SettingsScreen />);

    await userEvent.press(screen.getByText('Contact support'));
    await userEvent.press(screen.getByText('Privacy policy'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy();
  });
});

describe('the build this is', () => {
  it('names the version and the build on the screen', async () => {
    await renderScreen(<SettingsScreen />);
    // The shape is what matters rather than the number: a caption that has
    // quietly become "Log undefined" is worse than no caption.
    expect(screen.getByText('Log 9.8.7 (42)')).toBeTruthy();
  });

  it('and the label itself is built from the config rather than typed', () => {
    expect(releaseLabel()).toBe('Log 9.8.7 (42)');
  });
});
