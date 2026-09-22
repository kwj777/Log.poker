/**
 * The demo set, and the one device it must not be written onto.
 *
 * `seedDemoData` opens with `clearAll`, which on a repository that syncs is
 * not a wipe: it rewinds the cursors so the real log is pulled straight back
 * down, and every fabricated session then goes up through `touched` into the
 * account's own bucket and out to every other device. Undoing that is row by
 * row.
 *
 * The card is developer-only, so the person it costs is a developer signed
 * into their own account while testing sync -- which is precisely who reaches
 * for it.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import SettingsScreen from '../../../app/(tabs)/settings';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('../../features/account/SignInCard', () => ({ SignInCard: () => null }));
jest.mock('../../features/family/FamilyCrossPromo', () => ({ FamilyCrossPromo: () => null }));
jest.mock('../../features/export/saveCsv', () => ({
  saveCsv: async () => ({ saved: true }),
}));

/** Null when this device does not sync. */
const mockSyncing: { repository: object | null } = { repository: null };
const mockSeeded = { calls: 0 };

jest.mock('../../data', () => ({
  getRepository: async () => ({ listVenues: async () => [] }),
  getSyncingRepository: async () => mockSyncing.repository,
  onSyncApplied: () => () => undefined,
  STORAGE_ENGINE: 'SQLite',
}));

jest.mock('../../data/seed', () => ({
  DEMO_SESSION_COUNT: 32,
  seedDemoData: async () => {
    mockSeeded.calls += 1;
    return { venues: 4, sessions: 32, hands: 40, moodEntries: 12 };
  },
}));

beforeEach(() => {
  mockSyncing.repository = null;
  mockSeeded.calls = 0;
  useLogStore.setState({
    status: 'ready',
    sessions: [],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
});

describe('loading the demo set', () => {
  it('writes it onto a device that has nothing to sync', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Load demo data'));

    expect(mockSeeded.calls).toBe(1);
    expect(await screen.findByText(/Seeded 32 sessions/)).toBeTruthy();
  });

  it('and refuses a device that does, rather than merging it into a real account', async () => {
    mockSyncing.repository = {};
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Load demo data'));

    expect(mockSeeded.calls).toBe(0);
    expect(await screen.findByText(/Not onto a device that syncs/)).toBeTruthy();
  });

  it('and says why, rather than only that it did not', async () => {
    mockSyncing.repository = {};
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Load demo data'));

    expect(await screen.findByText(/pulls your real log back/)).toBeTruthy();
    expect(screen.getByText(/Sign out first/)).toBeTruthy();
  });
});

describe('what the reset warning says about getting it back', () => {
  /**
   * Open the confirmation and read the sentence above the two buttons.
   *
   * Which of the two it is turns on whether this device syncs, and that is the
   * whole of what these tests are about: the answer used to be captured in a
   * `useEffect(..., [])` at mount.
   */
  const warningAfterSigningInOrOut = async (at: 'mount' | 'press') => {
    mockSyncing.repository = at === 'mount' ? {} : null;
    await renderScreen(<SettingsScreen />);
    // The mount effect has settled by now; this is the flip `SignInCard` makes
    // a few hundred pixels up the same screen, without leaving it.
    mockSyncing.repository = at === 'mount' ? null : {};
    await userEvent.press(screen.getByText('Clear all data'));
    return screen.getByText(/Delete every session/);
  };

  it('promises nothing comes back once the account is gone', async () => {
    // The dangerous direction. Signed in at mount, signed out before the
    // press: the copy went on saying the log "comes back from the server the
    // next time this device syncs", about a device with no account behind it.
    // Somebody deletes their whole log believing it is recoverable.
    expect(await warningAfterSigningInOrOut('mount')).toHaveTextContent(/cannot be undone/);
  });

  it('and says it does come back once there is an account', async () => {
    // The other way round, and the reason the two sentences exist: on a
    // syncing device `clearAll` rewinds the cursors and pulls the real log
    // straight back, so "This cannot be undone" is false and the instruction
    // the player needs -- sign out first -- is missing.
    expect(await warningAfterSigningInOrOut('press')).toHaveTextContent(/come back from the server/);
  });

  it('and agrees with the card that already asks at press time', async () => {
    // `seed()` re-reads `getSyncingRepository()` when it is pressed and
    // refuses correctly. The two cards are in one render and disagreed.
    mockSyncing.repository = null;
    await renderScreen(<SettingsScreen />);
    mockSyncing.repository = {};

    await userEvent.press(screen.getByText('Load demo data'));
    expect(await screen.findByText(/Not onto a device that syncs/)).toBeTruthy();

    await userEvent.press(screen.getByText('Clear all data'));
    expect(screen.getByText(/Delete every session/)).toHaveTextContent(/come back from the server/);
  });
});

