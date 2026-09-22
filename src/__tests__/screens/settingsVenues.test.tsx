/**
 * Fixing a venue, which was the one record with no way to be fixed.
 *
 * `renameVenue` has been in the store since venues have, and until now its
 * only callers anywhere were two lines of its own unit test. Settings offered
 * Remove, and only for a venue with nothing logged against it -- correct, and
 * it meant a misspelled room with a single session behind it stayed on the
 * dashboard forever.
 *
 * Merge is the other half, and the half that needs asking first: it moves
 * every session off a venue and deletes it, and nothing in this app undoes
 * anything.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import SettingsScreen from '../../../app/(tabs)/settings';
import type { Venue } from '../../domain/types';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/** Null when this device does not sync, which decides what a reset means. */
const mockSyncing: { repository: object | null } = { repository: null };

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  ALLOW_DEMO_SEED: false,
}));

jest.mock('../../features/account/SignInCard', () => ({ SignInCard: () => null }));
jest.mock('../../features/family/FamilyCrossPromo', () => ({ FamilyCrossPromo: () => null }));
jest.mock('../../features/export/saveCsv', () => ({
  saveCsv: async () => ({ saved: true }),
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
  getSyncingRepository: async () => mockSyncing.repository,
  STORAGE_ENGINE: 'SQLite',
}));

const mockRenamed: { id: string; name: string }[] = [];
const mockMerged: { from: string; into: string }[] = [];

const venue = (id: string, name: string, sessionCount: number): Venue => ({
  id,
  name,
  isHomeGame: false,
  sessionCount,
  createdAt: 1,
  updatedAt: 1,
});

const load = (venues: Venue[]) =>
  useLogStore.setState({
    status: 'ready',
    sessions: [session('s1')],
    venues,
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    renameVenue: (async (id: string, name: string) => {
      mockRenamed.push({ id, name });
    }) as never,
    mergeVenues: (async (from: string, into: string) => {
      mockMerged.push({ from, into });
      return 4;
    }) as never,
  });

beforeEach(() => {
  mockRenamed.length = 0;
  mockMerged.length = 0;
  load([venue('v1', 'Aria High Limt', 4), venue('v2', 'Bellagio', 9)]);
});

const openEditor = async (name: string) => {
  await renderScreen(<SettingsScreen />);
  await userEvent.press(screen.getByLabelText(`Edit ${name}`));
};

/**
 * By role, because a venue's name is on screen twice while an editor is open:
 * once as the other venue's own row, and once as the chip that would fold this
 * one into it. Only the second is pressable.
 */
const mergeChip = (name: string) => screen.getByRole('button', { name });

describe('renaming a venue', () => {
  it('writes the new name, which nothing in the app could do before', async () => {
    await openEditor('Aria High Limt');
    const field = screen.getByLabelText('Name for Aria High Limt');
    await userEvent.clear(field);
    await userEvent.type(field, 'Aria High Limit');
    await userEvent.press(screen.getByLabelText('Save the name for Aria High Limt'));

    expect(mockRenamed).toEqual([{ id: 'v1', name: 'Aria High Limit' }]);
  });

  it('confirms it, under the venues card rather than in a developer build', async () => {
    await openEditor('Aria High Limt');
    const field = screen.getByLabelText('Name for Aria High Limt');
    await userEvent.clear(field);
    await userEvent.type(field, 'Aria High Limit');
    await userEvent.press(screen.getByLabelText('Save the name for Aria High Limt'));

    expect(await screen.findByText('Renamed to Aria High Limit.')).toBeTruthy();
  });

  it('will not save a name another venue already has', async () => {
    await openEditor('Aria High Limt');
    const field = screen.getByLabelText('Name for Aria High Limt');
    await userEvent.clear(field);
    await userEvent.type(field, 'bellagio');

    // Two rows cannot become one row by being called the same thing. What the
    // player meant is offered instead.
    expect(screen.queryByLabelText('Save the name for Aria High Limt')).toBeNull();
    expect(screen.getByText('Merge into Bellagio')).toBeTruthy();
    expect(mockRenamed).toEqual([]);
  });
});

describe('merging one venue into another', () => {
  it('asks first, with the number that says whether this is the right row', async () => {
    await openEditor('Aria High Limt');
    await userEvent.press(mergeChip('Bellagio'));

    expect(screen.getByText('Move 4 sessions to Bellagio?')).toBeTruthy();
    expect(mockMerged).toEqual([]);
  });

  it('and does it once the question is answered', async () => {
    await openEditor('Aria High Limt');
    await userEvent.press(mergeChip('Bellagio'));
    await userEvent.press(screen.getByText('Merge'));

    expect(mockMerged).toEqual([{ from: 'v1', into: 'v2' }]);
    expect(await screen.findByText('Moved 4 sessions to Bellagio.')).toBeTruthy();
  });

  it('does nothing when the question is answered with no', async () => {
    await openEditor('Aria High Limt');
    await userEvent.press(mergeChip('Bellagio'));
    await userEvent.press(screen.getByText('Cancel'));

    expect(mockMerged).toEqual([]);
    // Back to the editor, not out of it: the question is gone and the field is not.
    expect(screen.queryByText('Move 4 sessions to Bellagio?')).toBeNull();
    expect(screen.getByLabelText('Name for Aria High Limt')).toBeTruthy();
  });

  it('is not offered to a log with one venue in it', async () => {
    load([venue('v1', 'Aria', 4)]);
    await openEditor('Aria');
    expect(screen.queryByText('Or fold this room into another one:')).toBeNull();
  });
});

/**
 * What a reset says it does, which is not the same on both kinds of device.
 *
 * "This cannot be undone" was said either way, and on a signed-in device it is
 * undone immediately and by the app itself: `SyncingRepository.clearAll`
 * rewinds the cursors and starts a push of its own, so the log is back within a
 * round. That is deliberate -- reset means this device, not every device -- and
 * the sentence in front of it said the opposite.
 *
 * The starting balance is the half both wordings left out, and it is the one
 * thing a reset really does destroy for good: preferences are not in
 * `SYNC_TABLES`, so nothing anywhere holds a copy to send back.
 */
describe('what clearing this device says it clears', () => {
  beforeEach(() => {
    mockSyncing.repository = null;
  });

  it('on a device that does not sync, says it cannot be undone, and names the balance', async () => {
    load([]);
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Clear all data'));

    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByText(/starting balance/)).toBeTruthy();
  });

  it('and on one that does, says the log comes back and only the balance does not', async () => {
    mockSyncing.repository = {};
    load([]);
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Clear all data'));

    expect(screen.getByText(/come back from the server/)).toBeTruthy();
    expect(screen.getByText(/starting balance does not sync/)).toBeTruthy();
    // The claim that was false on this device.
    expect(screen.queryByText(/cannot be undone/)).toBeNull();
  });
});
