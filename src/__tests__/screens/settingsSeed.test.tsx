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
  CAN_SAVE_FILE: true,
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
