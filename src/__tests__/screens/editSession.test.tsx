/**
 * Correcting a session that was logged wrong.
 *
 * Nothing a session records could be changed. The detail screen edited its
 * notes and nothing else, so a cash-out typed as 1800 instead of 180 had one
 * remedy -- delete the night, and its hands and its mood entries with it --
 * while the wrong figure sat in the bankroll, the hourly rate, the win rate
 * and the variance estimate.
 *
 * Two cases carry most of the value and are what these cover. A mistyped
 * amount, which is the obvious one. And a session left running: the phone went
 * in a pocket, the timer ran to the next afternoon, and the hours it invented
 * divide straight into every rate the app quotes.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import EditSessionScreen from '../../../app/session/edit';
import { useLogStore } from '../../store/useLogStore';
import type { SessionWithChildren } from '../../domain/types';

const params: { id: string } = { id: 's1' };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => params,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const back = jest.requireMock('expo-router').router.back as jest.Mock;

const HOUR = 3_600_000;
/** A Saturday evening, in local time, so the fields read as a wall clock. */
const START = new Date(2026, 8, 19, 19, 0).getTime();

const edits: { id: string; patch: Record<string, unknown> }[] = [];

const load = (over: Partial<SessionWithChildren> = {}) => {
  params.id = 's1';
  back.mockClear();
  edits.length = 0;
  useLogStore.setState({
    status: 'ready',
    activeSession: null,
    sessions: [
      session('s1', {
        startedAt: START,
        endedAt: START + 4 * HOUR,
        buyIn: 30_000,
        cashOut: 45_000,
        ...over,
      }),
    ],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    editSession: (async (id: string, patch: Record<string, unknown>) => {
      edits.push({ id, patch });
    }) as never,
  });
};

describe('opening a session to correct it', () => {
  it('shows what is stored, rather than an empty form', async () => {
    load();
    await renderScreen(<EditSessionScreen />);

    expect(screen.getByDisplayValue('2026-09-19')).toBeTruthy();
    expect(screen.getByDisplayValue('19:00')).toBeTruthy();
    expect(screen.getByDisplayValue('450')).toBeTruthy();
    expect(screen.getByDisplayValue('300')).toBeTruthy();
  });

  it('asks for the length rather than the end time', async () => {
    // What a player knows is "about four hours", not when the app stopped
    // counting -- especially in the case this exists for.
    load();
    await renderScreen(<EditSessionScreen />);

    expect(screen.getByLabelText('Hours played')).toHaveDisplayValue('4');
    expect(screen.getByLabelText('Minutes played')).toHaveDisplayValue('0');
  });

  it('and shows what that length works out to, so the arithmetic is visible', async () => {
    load();
    await renderScreen(<EditSessionScreen />);
    expect(screen.getByText(/Finishing .* at 11:00/)).toBeTruthy();
  });

  it('says so when the session is not there', async () => {
    load();
    params.id = 'gone';
    await renderScreen(<EditSessionScreen />);
    expect(screen.getByText('Session not found')).toBeTruthy();
  });
});

describe('a cash-out typed wrong', () => {
  it('is written back as the number the player meant', async () => {
    load({ cashOut: 180_000 });
    await renderScreen(<EditSessionScreen />);

    const field = screen.getByLabelText('Cash-out amount');
    await userEvent.clear(field);
    await userEvent.type(field, '180');
    await userEvent.press(screen.getByText('Save changes'));

    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe('s1');
    expect(edits[0].patch.cashOut).toBe(18_000);
  });

  it('and clearing it puts the session back to running', async () => {
    load();
    await renderScreen(<EditSessionScreen />);

    await userEvent.clear(screen.getByLabelText('Cash-out amount'));
    await userEvent.press(screen.getByText('Save changes'));

    expect(edits[0].patch.cashOut).toBeNull();
  });

  it('leaves every field nobody touched exactly as it was', async () => {
    load();
    await renderScreen(<EditSessionScreen />);

    await userEvent.press(screen.getByText('Save changes'));

    expect(edits[0].patch).toMatchObject({
      buyIn: 30_000,
      cashOut: 45_000,
      currency: 'USD',
      gameType: 'NLHE',
      startedAt: START,
      endedAt: START + 4 * HOUR,
    });
  });
});

describe('a session left running overnight', () => {
  it('is corrected by saying how long it actually was', async () => {
    // Eleven hours the player did not play. `durationMs` feeds `hourlyRate`
    // and `estimatePlayer`, both of which divide by hours.
    load({ endedAt: START + 15 * HOUR });
    await renderScreen(<EditSessionScreen />);
    expect(screen.getByLabelText('Hours played')).toHaveDisplayValue('15');

    const hours = screen.getByLabelText('Hours played');
    await userEvent.clear(hours);
    await userEvent.type(hours, '4');
    await userEvent.press(screen.getByText('Save changes'));

    expect(edits[0].patch.endedAt).toBe(START + 4 * HOUR);
    // The start was not the thing that was wrong and must not move.
    expect(edits[0].patch.startedAt).toBe(START);
  });

  it('and moving the start moves the end with it, since the length is what is held', async () => {
    load();
    await renderScreen(<EditSessionScreen />);

    const time = screen.getByLabelText('Start time');
    await userEvent.clear(time);
    await userEvent.type(time, '21:30');
    await userEvent.press(screen.getByText('Save changes'));

    const expected = new Date(2026, 8, 19, 21, 30).getTime();
    expect(edits[0].patch.startedAt).toBe(expected);
    expect(edits[0].patch.endedAt).toBe(expected + 4 * HOUR);
  });
});

describe('what the form refuses to write', () => {
  it('holds the save on a date that is not one', async () => {
    load();
    await renderScreen(<EditSessionScreen />);

    const date = screen.getByLabelText('Start date');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-02-31');
    await userEvent.press(screen.getByText('Save changes'));

    expect(edits).toHaveLength(0);
    expect(screen.getByText('That is not a date and a time. Use 2026-09-21 and 19:45.')).toBeTruthy();
  });

  it('and on a length it cannot read', async () => {
    load();
    await renderScreen(<EditSessionScreen />);

    const hours = screen.getByLabelText('Hours played');
    await userEvent.clear(hours);
    const minutes = screen.getByLabelText('Minutes played');
    await userEvent.clear(minutes);
    await userEvent.press(screen.getByText('Save changes'));

    expect(edits).toHaveLength(0);
  });

  it('and says so when the write itself fails', async () => {
    load();
    useLogStore.setState({
      editSession: (async () => {
        throw new Error('The database is full.');
      }) as never,
    });
    await renderScreen(<EditSessionScreen />);

    await userEvent.press(screen.getByText('Save changes'));
    expect(await screen.findByText('The database is full.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

describe('a session that is still running', () => {
  it('offers its start and not its length, which is not a fact yet', async () => {
    load({ endedAt: null, cashOut: null });
    await renderScreen(<EditSessionScreen />);

    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.queryByLabelText('Hours played')).toBeNull();
    expect(screen.queryByLabelText('Cash-out amount')).toBeNull();
  });

  it('and leaves its open end open when the start is fixed', async () => {
    load({ endedAt: null, cashOut: null });
    await renderScreen(<EditSessionScreen />);

    const time = screen.getByLabelText('Start time');
    await userEvent.clear(time);
    await userEvent.type(time, '20:15');
    await userEvent.press(screen.getByText('Save changes'));

    expect(edits[0].patch.startedAt).toBe(new Date(2026, 8, 19, 20, 15).getTime());
    expect(edits[0].patch).not.toHaveProperty('endedAt');
  });
});
