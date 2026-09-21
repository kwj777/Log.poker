/**
 * Logging a night that was played before it was logged.
 *
 * A session could only ever begin now. The store has taken a `startedAt` since
 * it was written and no screen ever sent one, so a player who forgot to start
 * the timer -- or whose phone died, or who played the weekend before
 * installing Log -- had the CSV importer or nothing. The rates and the
 * variance this app exists to quote are computed over what is in the log, and
 * the nights that get forgotten are not a random half of them.
 *
 * Three things are worth pinning. That the form will not save a session that
 * is missing a start, a length or a result, since a half-entered past session
 * is worse than none. That what it does save is one finished record in one
 * write. And that it does not nag before it has been given anything.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session, venue } from '../support/sessions';
import PastSessionScreen from '../../../app/session/past';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const back = jest.requireMock('expo-router').router.back as jest.Mock;

const HOUR = 3_600_000;
const logged: Record<string, unknown>[] = [];

const load = (over: Parameters<typeof session>[1] = {}) => {
  logged.length = 0;
  back.mockClear();
  useLogStore.setState({
    status: 'ready',
    activeSession: null,
    // One session, so the form opens on the player's usual room and stakes.
    sessions: [session('s1', { buyIn: 30_000, ...over })],
    venues: [venue('v1', 'Aria')],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    logPastSession: (async (input: Record<string, unknown>) => {
      logged.push(input);
      return { id: 'new' };
    }) as never,
  });
};

/** Fill in the three things only a past session can be asked for. */
const enterWhenAndResult = async (
  date: string,
  time: string,
  hours: string,
  cashOut: string,
) => {
  await userEvent.clear(screen.getByLabelText('Start date'));
  await userEvent.type(screen.getByLabelText('Start date'), date);
  await userEvent.type(screen.getByLabelText('Start time'), time);
  await userEvent.type(screen.getByLabelText('Hours played'), hours);
  await userEvent.type(screen.getByLabelText('Cash-out amount'), cashOut);
};

describe('the form before it has been given anything', () => {
  it('opens on the room and the stakes the player last used', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    expect(screen.getByText('Aria')).toBeTruthy();
    expect(screen.getByDisplayValue('300')).toBeTruthy();
  });

  it('does not complain about the fields it has not been given yet', async () => {
    // A form that opens in an error state reads as broken before it has been
    // touched, and everything below the fold is what it is complaining about.
    load();
    await renderScreen(<PastSessionScreen />);
    expect(screen.queryByText(/That is not a date and a time/)).toBeNull();
    expect(screen.queryByText(/How long did you play/)).toBeNull();
  });

  it('but says so once a time is typed that is not one', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await userEvent.type(screen.getByLabelText('Start time'), '25:99');
    expect(screen.getByText(/That is not a date and a time/)).toBeTruthy();
  });
});

describe('what it refuses to save', () => {
  const pressSave = async () => {
    await userEvent.press(screen.getByText(/^Add session/));
  };

  it('a session with no start time, because the hour is half the record', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await userEvent.type(screen.getByLabelText('Hours played'), '4');
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await pressSave();
    expect(logged).toHaveLength(0);
  });

  it('a session with no length, which would divide into every rate as zero', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await userEvent.type(screen.getByLabelText('Start time'), '19:00');
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await pressSave();
    expect(logged).toHaveLength(0);
  });

  it('and a session with no result, which is what it is here to record', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await userEvent.type(screen.getByLabelText('Start time'), '19:00');
    await userEvent.type(screen.getByLabelText('Hours played'), '4');
    await pressSave();
    expect(logged).toHaveLength(0);
  });

  it('but a losing night is a result, and zero is a number', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await enterWhenAndResult('2026-09-19', '19:00', '4', '0');
    await pressSave();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ cashOut: 0 });
  });
});

describe('what it saves', () => {
  it('is one finished session, start and end already on it', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await enterWhenAndResult('2026-09-19', '19:00', '4', '450');
    await userEvent.press(screen.getByText(/^Add session/));

    expect(logged).toHaveLength(1);
    const startedAt = new Date(2026, 8, 19, 19, 0).getTime();
    expect(logged[0]).toMatchObject({
      venueId: 'v1',
      format: 'cash',
      buyIn: 30_000,
      cashOut: 45_000,
      startedAt,
      endedAt: startedAt + 4 * HOUR,
    });
  });

  it('carries the minutes as well as the hours', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await enterWhenAndResult('2026-09-19', '19:00', '3', '450');
    await userEvent.type(screen.getByLabelText('Minutes played'), '45');
    await userEvent.press(screen.getByText(/^Add session/));

    const startedAt = new Date(2026, 8, 19, 19, 0).getTime();
    expect(logged[0]).toMatchObject({ endedAt: startedAt + 3 * HOUR + 45 * 60_000 });
  });

  it('and leaves the screen once it has landed', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await enterWhenAndResult('2026-09-19', '19:00', '4', '450');
    await userEvent.press(screen.getByText(/^Add session/));
    expect(back).toHaveBeenCalled();
  });
});

describe('the result on the button', () => {
  it("is the profit that night, so it is read before it is tapped", async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await enterWhenAndResult('2026-09-19', '19:00', '4', '450');
    expect(screen.getByText('Add session · +$150')).toBeTruthy();
  });

  it('and a loss reads as a loss', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await enterWhenAndResult('2026-09-19', '19:00', '4', '100');
    expect(screen.getByText('Add session · -$200')).toBeTruthy();
  });
});

describe('a tournament played last week', () => {
  it('asks for a fee and a finish rather than blinds', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await userEvent.press(screen.getByText('Tournament'));

    expect(screen.getByLabelText('Tournament entry fee')).toBeTruthy();
    expect(screen.getByLabelText('Finishing position')).toBeTruthy();
    expect(screen.queryByLabelText('Cash-out amount')).toBeNull();
  });

  it('and saves the bust with the field it busted out of', async () => {
    load();
    await renderScreen(<PastSessionScreen />);
    await userEvent.press(screen.getByText('Tournament'));
    await userEvent.clear(screen.getByLabelText('Start date'));
    await userEvent.type(screen.getByLabelText('Start date'), '2026-09-19');
    await userEvent.type(screen.getByLabelText('Start time'), '12:00');
    await userEvent.type(screen.getByLabelText('Hours played'), '6');
    await userEvent.type(screen.getByLabelText('Prize won'), '0');
    await userEvent.type(screen.getByLabelText('Finishing position'), '40');
    await userEvent.type(screen.getByLabelText('Number of entrants'), '312');
    await userEvent.press(screen.getByText(/^Add session/));

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      format: 'tournament',
      stakes: null,
      cashOut: 0,
      finishPosition: 40,
      entrants: 312,
    });
  });
});
