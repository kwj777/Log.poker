/**
 * Writing the log out, from the screen that offers it.
 *
 * The file itself is tested in `src/domain/export`, against the real importer.
 * What is left to get wrong is here: reading the whole log rather than the
 * part the store happens to hold, offering a file there is nothing to put in,
 * and saying something afterwards that is true.
 */

import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import SettingsScreen from '../../../app/(tabs)/settings';
import { useLogStore } from '../../store/useLogStore';

const mockSaved: { name: string; text: string }[] = [];

jest.mock('../../features/export/saveCsv', () => ({
  CAN_SAVE_FILE: true,
  saveCsv: async (name: string, text: string) => {
    mockSaved.push({ name, text });
    return { saved: true };
  },
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// Neither is what this file is about, and the sign-in card reaches the whole
// auth stack -- a token store, a session manager, a clock -- to render a button.
jest.mock('../../features/account/SignInCard', () => ({ SignInCard: () => null }));
jest.mock('../../features/family/FamilyCrossPromo', () => ({ FamilyCrossPromo: () => null }));

const mockRepository = {
  listSessions: jest.fn(),
  listHands: jest.fn(),
};

jest.mock('../../data', () => ({
  getRepository: async () => mockRepository,
  onSyncApplied: () => () => undefined,
  STORAGE_ENGINE: 'SQLite',
}));

const load = (over: Partial<ReturnType<typeof useLogStore.getState>> = {}) =>
  useLogStore.setState({
    status: 'ready',
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 2,
    handsVersion: 0,
    ...over,
  });

beforeEach(() => {
  mockSaved.length = 0;
  jest.clearAllMocks();
  mockRepository.listSessions.mockImplementation(async () => [session('s1'), session('s2')]);
  mockRepository.listHands.mockImplementation(async () => [
    { id: 'h1', sessionId: 's1', holeCards: 'AsKd', board: '7c2sKh', position: 'BTN', note: null, tags: [], amount: null, at: 1, createdAt: 1, updatedAt: 1 },
  ]);
  load();
});

describe('exporting the log', () => {
  it('writes a dated file of sessions', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));

    await waitFor(() => expect(mockSaved).toHaveLength(1));
    expect(mockSaved[0].name).toMatch(/^log-sessions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mockSaved[0].text).toContain('Started');
  });

  it('reads the whole log rather than what the store happens to hold', async () => {
    // The store has one session. The database has two, and the file is the
    // database's answer. Since the hands stopped being kept in memory this is
    // the only way to export all of them.
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));

    await waitFor(() => expect(mockSaved).toHaveLength(1));
    expect(mockRepository.listSessions).toHaveBeenCalled();
    expect(mockSaved[0].text.trim().split('\r\n')).toHaveLength(3);
  });

  it('says how much it wrote', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));
    expect(await screen.findByText('Exported 2 sessions.')).toBeTruthy();
  });

  it('writes the hands as their own file', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Hands'));

    await waitFor(() => expect(mockSaved).toHaveLength(1));
    expect(mockSaved[0].name).toMatch(/^log-hands-/);
    expect(mockSaved[0].text).toContain('Cards');
    expect(mockSaved[0].text).toContain('Board');
  });

  it('does not offer a file there is nothing to put in', async () => {
    load({ sessions: [], handCount: 0 });
    await renderScreen(<SettingsScreen />);

    expect(screen.getByText('Sessions').parent).toBeTruthy();
    await userEvent.press(screen.getByText('Sessions'));
    await userEvent.press(screen.getByText('Hands'));
    // Both refused: a header row with nothing under it is a file this app's
    // own importer rejects.
    expect(mockSaved).toHaveLength(0);
  });

  it('says so when the save fails rather than looking like it worked', async () => {
    mockRepository.listSessions.mockImplementation(async () => {
      throw new Error('the database is gone');
    });
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));
    expect(await screen.findByText('the database is gone')).toBeTruthy();
  });
});
