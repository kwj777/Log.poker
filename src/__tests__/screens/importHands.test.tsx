/**
 * The import screen, given hand histories instead of a spreadsheet.
 *
 * Same door, other reader: the screen has to notice what kind of file it
 * holds, show where every sitting is going, let the player send one
 * somewhere else, and hand exactly those choices to the store.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session, venue } from '../support/sessions';
import ImportScreen from '../../../app/import';
import { useLogStore } from '../../store/useLogStore';
import {
  ACR_SET,
  STARS_PLAY_MONEY,
  STARS_PLAY_MONEY_SMALL,
} from '../../domain/import/handHistory/__tests__/fixtures';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() } }));

jest.mock('../../features/import/pickCsvFile', () => ({
  pickCsvFile: async () => null,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const FIRST_HAND = Date.UTC(2026, 8, 23, 12, 2, 11);
const importHands = jest.fn();

const paste = async (text: string) => {
  await renderScreen(<ImportScreen />);
  await userEvent.paste(screen.getByLabelText('Session summary rows or hand histories'), text);
};

beforeEach(() => {
  importHands.mockReset();
  importHands.mockResolvedValue({
    imported: 2,
    duplicates: 0,
    sessionsCreated: 0,
    venuesCreated: [],
  });
  useLogStore.setState({
    status: 'ready',
    sessions: [
      session('live', {
        startedAt: FIRST_HAND - 30 * 60_000,
        endedAt: null,
        cashOut: null,
        venue: venue('v1', 'PokerStars'),
      }),
    ],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    importHands,
  });
});

describe('a file of hand histories', () => {
  it('is read as hands, not as a spreadsheet that failed', async () => {
    await paste(`${STARS_PLAY_MONEY}\n\n${STARS_PLAY_MONEY_SMALL}`);

    expect(screen.getByText('2 hands')).toBeTruthy();
    expect(screen.getByText('Where they go')).toBeTruthy();
    expect(screen.queryByText(/Nothing in that file could be read/)).toBeNull();
    expect(screen.getByText('PokerStars · NLHE 25/50 play money')).toBeTruthy();
  });

  it('sends the hands to the session still running, and says so before anything is written', async () => {
    await paste(`${STARS_PLAY_MONEY}\n\n${STARS_PLAY_MONEY_SMALL}`);

    const running = screen.getByRole('button', { name: /Running now · PokerStars/ });
    expect(running.props.accessibilityState).toMatchObject({ selected: true });

    await userEvent.press(screen.getByText('Every hand (2)'));
    await userEvent.press(screen.getByText('Import 2 hands'));

    expect(importHands).toHaveBeenCalledTimes(1);
    const [sittings, destinations, every] = importHands.mock.calls[0];
    expect(sittings).toHaveLength(1);
    expect(destinations.get(sittings[0].key)).toEqual({ kind: 'session', sessionId: 'live' });
    expect(every).toBe(true);
    expect(await screen.findByText('Imported 2 hands.')).toBeTruthy();
  });

  it('lets the player leave a sitting out instead', async () => {
    await paste(STARS_PLAY_MONEY);
    await userEvent.press(screen.getByText('Leave out'));

    expect(screen.getByText('Nothing to import')).toBeTruthy();
  });

  it('offers a new session for real money with none to go into', async () => {
    useLogStore.setState({ sessions: [] });
    await paste(ACR_SET);

    const fresh = screen.getByRole('button', { name: 'New session' });
    expect(fresh.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('+$8.60')).toBeTruthy();
  });
});
