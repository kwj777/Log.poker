/**
 * Opening a file on a phone.
 *
 * The import screen had no file button on iOS or Android for the life of the
 * project, and the reason written in `pickCsvFile.ts` was that nobody keeps a
 * tracker export on their phone. The app's own export disproves it: it writes a
 * CSV and hands it to the share sheet, whose first suggestion is Files, and
 * then the import screen would not open what it had just written.
 *
 * These tests go through the real `pickCsvFile` with `expo-file-system` mocked
 * underneath, rather than mocking `pickCsvFile` itself the way the other import
 * screen test does. What is worth holding here is the wiring between the two --
 * which type filter goes down, and which of the picker's three answers comes
 * back up -- and mocking the seam would test neither.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import ImportScreen from '../../../app/import';
import { useLogStore } from '../../store/useLogStore';

const mockPickFileAsync = jest.fn();

jest.mock('expo-file-system', () => ({
  File: { pickFileAsync: (...args: unknown[]) => mockPickFileAsync(...args) },
}));

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() } }));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const CSV = 'Date,Buy-in,Cash-out\n2026-01-02,100,250\n';

/** What the picker hands back when someone chooses a file. */
const chose = (name: string, text: string) => ({
  canceled: false,
  result: { name, text: async () => text },
});

const open = async () => {
  await renderScreen(<ImportScreen />);
  await userEvent.press(screen.getByText('Choose a file…'));
};

beforeEach(() => {
  mockPickFileAsync.mockReset();
  useLogStore.setState({
    status: 'ready',
    sessions: [],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
});

describe('the import screen on a phone', () => {
  it('offers a file at all, which for most of this project it did not', async () => {
    mockPickFileAsync.mockResolvedValue(chose('log.csv', CSV));
    await open();

    expect(screen.getByText('log.csv')).toBeTruthy();
    // Read, parsed and on screen: the button is wired to the preview, not just
    // to a picker that opens and closes.
    expect(screen.getAllByText(/1 session/).length).toBeGreaterThan(0);
  });

  it('asks the system for text of any kind, not for a list of three spellings', async () => {
    // A narrow filter fails by graying the file out inside the system picker,
    // where this app cannot say a word about it. Nothing in a rendered screen
    // shows that, so the filter is held here or it is held nowhere.
    mockPickFileAsync.mockResolvedValue(chose('log.csv', CSV));
    await open();

    const [options] = mockPickFileAsync.mock.calls[0] as [{ mimeTypes: string }];
    expect(options.mimeTypes).toContain('*');
  });

  it('says so when the file cannot be read, rather than absorbing the tap', async () => {
    mockPickFileAsync.mockRejectedValue(new Error('That file could not be opened.'));
    await open();

    expect(screen.getByText('That file could not be opened.')).toBeTruthy();
  });

  it('and leaves the screen alone when the player backs out', async () => {
    mockPickFileAsync.mockResolvedValue({ canceled: true, result: null });
    await renderScreen(<ImportScreen />);
    await userEvent.paste(screen.getByLabelText('Session summary rows or hand histories'), CSV);
    await userEvent.press(screen.getByText('Choose a file…'));

    // Backing out of the picker is not a request to throw away what is already
    // in the box, which is the one thing a cancel must not do.
    expect(screen.getAllByText(/1 session/).length).toBeGreaterThan(0);
  });
});
