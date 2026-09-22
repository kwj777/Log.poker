/**
 * Where the starting balance is entered.
 *
 * The dashboard said "Bankroll" over cumulative profit from zero, and there
 * was nowhere in the app to put the number that would have made the word true.
 * This is that field, and what is worth pinning about it is the two states it
 * has to keep apart: never asked, and answered with zero. Collapsing them
 * would quietly answer a question nobody had been asked.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import SettingsScreen from '../../../app/(tabs)/settings';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

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
  // No syncing repository, so this device is signed out and the reset copy
  // says the log does not come back.
  getSyncingRepository: async () => null,
  STORAGE_ENGINE: 'SQLite',
}));

const mockSet: ({ cents: number; currency: string } | null)[] = [];

const load = (startingBalance: { cents: number; currency: string } | null = null) =>
  useLogStore.setState({
    status: 'ready',
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    startingBalance,
    handCount: 0,
    handsVersion: 0,
    setStartingBalance: (async (balance: { cents: number } | null) => {
      mockSet.push(balance as never);
    }) as never,
  });

beforeEach(() => {
  mockSet.length = 0;
  load();
});

describe('entering a starting balance', () => {
  it('stores it in cents, in the money the log is in', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.type(screen.getByLabelText('Starting balance'), '5000');
    await userEvent.press(screen.getByText('Save'));

    expect(mockSet).toEqual([{ cents: 500_000, currency: 'USD' }]);
  });

  it('confirms it, under the card it was typed into', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.type(screen.getByLabelText('Starting balance'), '5000');
    await userEvent.press(screen.getByText('Save'));

    expect(await screen.findByText('Starting balance set to $5,000.')).toBeTruthy();
  });

  it('takes zero, which is a player who started from nothing', async () => {
    await renderScreen(<SettingsScreen />);
    await userEvent.type(screen.getByLabelText('Starting balance'), '0');
    await userEvent.press(screen.getByText('Save'));

    // Not the same as never having been asked, which is what null means.
    expect(mockSet).toEqual([{ cents: 0, currency: 'USD' }]);
  });

  it('will not save an empty field, which is not an answer', async () => {
    await renderScreen(<SettingsScreen />);
    expect(screen.getByText('Save')).toBeDisabled();
  });
});

describe('a balance that is already set', () => {
  it('is in the field when the screen opens', async () => {
    load({ cents: 500_000, currency: 'USD' });
    await renderScreen(<SettingsScreen />);
    expect(screen.getByLabelText('Starting balance').props.value).toBe('5000');
  });

  it('can be cleared, which puts the dashboard back to showing profit', async () => {
    load({ cents: 500_000, currency: 'USD' });
    await renderScreen(<SettingsScreen />);
    await userEvent.press(screen.getByText('Clear'));

    expect(mockSet).toEqual([null]);
    expect(await screen.findByText('Cleared. The dashboard shows your profit again.')).toBeTruthy();
  });

  it('offers nothing to clear when there is none', async () => {
    await renderScreen(<SettingsScreen />);
    expect(screen.queryByText('Clear')).toBeNull();
  });
});
