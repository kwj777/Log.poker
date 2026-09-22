/**
 * Writing the log out, from the screen that offers it.
 *
 * The file itself is tested in `src/domain/export`, against the real importer.
 * What is left to get wrong is here: reading the whole log rather than the
 * part the store happens to hold, offering a file there is nothing to put in,
 * and saying something afterwards that is true.
 *
 * ## This file runs Settings as a shipped build
 *
 * `ALLOW_DEMO_SEED` is `IS_DEV`, and `jest-expo` defines `__DEV__` as true, so
 * without the mock below every test here renders a developer card no installed
 * app has ever shown. That is not a detail: the screen's only render of its
 * result message used to live inside that card, so an export said nothing, a
 * failed export said nothing and clearing the whole log said nothing -- while
 * a green test on this very line asserted the opposite. Forcing the flag off
 * is what makes these assertions about the app rather than about the harness.
 */

import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import SettingsScreen from '../../../app/(tabs)/settings';
import { useLogStore } from '../../store/useLogStore';

const mockSaved: { name: string; text: string }[] = [];
/** False for the one device that has nowhere to send a file. */
const mockShareable = { yes: true };

jest.mock('../../features/export/saveCsv', () => ({
  saveCsv: async (name: string, text: string) => {
    if (!mockShareable.yes) return { saved: false };
    mockSaved.push({ name, text });
    return { saved: true };
  },
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  ALLOW_DEMO_SEED: false,
}));

// Neither is what this file is about, and the sign-in card reaches the whole
// auth stack -- a token store, a session manager, a clock -- to render a button.
jest.mock('../../features/account/SignInCard', () => ({ SignInCard: () => null }));
jest.mock('../../features/family/FamilyCrossPromo', () => ({ FamilyCrossPromo: () => null }));

const mockRepository = {
  listSessions: jest.fn(),
  listHands: jest.fn(),
  listMoodEntries: jest.fn(),
  listVenues: jest.fn(),
  deleteVenue: jest.fn(),
  clearAll: jest.fn(),
};

jest.mock('../../data', () => ({
  getRepository: async () => mockRepository,
  onSyncApplied: () => () => undefined,
  // No syncing repository, so this device is signed out and the reset copy
  // says the log does not come back.
  getSyncingRepository: async () => null,
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
  mockShareable.yes = true;
  jest.clearAllMocks();
  mockRepository.listSessions.mockImplementation(async () => [session('s1'), session('s2')]);
  mockRepository.listHands.mockImplementation(async () => [
    { id: 'h1', sessionId: 's1', holeCards: 'AsKd', board: '7c2sKh', position: 'BTN', note: null, tags: [], amount: null, at: 1, createdAt: 1, updatedAt: 1 },
  ]);
  mockRepository.listMoodEntries.mockImplementation(async () => [
    { id: 'm1', sessionId: 's1', phase: 'start', score: 4, at: 1, createdAt: 1, updatedAt: 1 },
    { id: 'm2', sessionId: 's1', phase: 'end', score: 2, at: 2, createdAt: 1, updatedAt: 1 },
  ]);
  mockRepository.listVenues.mockImplementation(async () => []);
  mockRepository.deleteVenue.mockImplementation(async () => undefined);
  mockRepository.clearAll.mockImplementation(async () => undefined);
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

  it('says so when there is nowhere on the device to send it', async () => {
    // The one thing `saved: false` reports. It used to be read as somebody
    // backing out of the share sheet, which `shareAsync` cannot tell anyone
    // about, so the branch that exists for a device with no way to share a
    // file gave it the same silence as success: a button that did nothing, on
    // the card whose whole promise is that the log is the player's to take
    // away.
    mockShareable.yes = false;
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));

    expect(
      await screen.findByText(
        'This device has nowhere to send a file. Open Log in a browser to download one.',
      ),
    ).toBeTruthy();
    expect(mockSaved).toHaveLength(0);
  });

  it('and does not also say it exported anything', async () => {
    mockShareable.yes = false;
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));

    await waitFor(() => expect(screen.queryByText(/nowhere to send/)).toBeTruthy());
    expect(screen.queryByText(/^Exported /)).toBeNull();
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

/**
 * How somebody felt, which the export did not carry until now.
 *
 * Log asks for a score at the start of a session, two hours in and at
 * cash-out, and the mood cost on the Variance tab is built on the answers.
 * None of it was in either file, so somebody who exported, cleared the app and
 * re-imported got their sessions back and lost every mood they had logged
 * without being told.
 */
describe('exporting how the sessions felt', () => {
  it('writes a dated file of them', async () => {
    load({ moodEntries: [{ id: 'm1', sessionId: 's1', phase: 'start', score: 4, at: 1, createdAt: 1, updatedAt: 1 }] });
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Moods'));

    await waitFor(() => expect(mockSaved).toHaveLength(1));
    expect(mockSaved[0].name).toMatch(/^log-moods-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mockSaved[0].text).toContain('Phase');
  });

  it('reads the whole log rather than what the store holds, like the other two', async () => {
    load({ moodEntries: [{ id: 'm1', sessionId: 's1', phase: 'start', score: 4, at: 1, createdAt: 1, updatedAt: 1 }] });
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Moods'));

    await waitFor(() => expect(mockSaved).toHaveLength(1));
    expect(mockRepository.listMoodEntries).toHaveBeenCalled();
    // A header and the two the database holds, not the one in the store.
    expect(mockSaved[0].text.trim().split('\r\n')).toHaveLength(3);
  });

  it('carries the score and which part of the session it is about', async () => {
    load({ moodEntries: [{ id: 'm1', sessionId: 's1', phase: 'start', score: 4, at: 1, createdAt: 1, updatedAt: 1 }] });
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Moods'));

    await waitFor(() => expect(mockSaved).toHaveLength(1));
    expect(mockSaved[0].text).toContain('start');
    expect(mockSaved[0].text).toContain('end');
  });

  it('and is not offered to somebody who has never answered one', async () => {
    load({ moodEntries: [] });
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText('Moods')).toBeDisabled();
  });
});

/**
 * Saying what just happened, in the build people actually install.
 *
 * Every assertion here failed before the screen stopped keeping its one
 * message inside the developer card. They are written against four separate
 * actions rather than one, because the card each result belongs to is the part
 * that was wrong -- a single assertion would pass again the moment somebody
 * moved the render somewhere convenient and dev-only.
 */
describe('a shipped build saying what it did', () => {
  it('has no developer card to hide a message in', async () => {
    await renderScreen(<SettingsScreen />);
    expect(screen.queryByText('Load demo data')).toBeNull();
  });

  it('confirms an export under the export card', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));
    expect(await screen.findByText('Exported 2 sessions.')).toBeTruthy();
  });

  it('says an export failed', async () => {
    mockRepository.listSessions.mockImplementation(async () => {
      throw new Error('the database is gone');
    });
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Sessions'));
    expect(await screen.findByText('the database is gone')).toBeTruthy();
  });

  it('confirms that everything was cleared, which is the one worth being sure of', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Clear all data'));
    await userEvent.press(screen.getByText('Delete everything'));
    expect(await screen.findByText('All data cleared.')).toBeTruthy();
  });

  it('says when removing a venue did not work, rather than leaving the row there', async () => {
    mockRepository.deleteVenue.mockImplementation(async () => {
      throw new Error('venue is in use');
    });
    load({
      venues: [
        {
          id: 'v1',
          name: 'Aria',
          isHomeGame: false,
          sessionCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await renderScreen(<SettingsScreen />);
    // Remove lives in the row's editor now, beside rename and merge.
    await userEvent.press(screen.getByLabelText('Edit Aria'));
    await userEvent.press(screen.getByText('Remove'));
    expect(await screen.findByText('venue is in use')).toBeTruthy();
  });
});
