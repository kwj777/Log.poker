/**
 * What the player sees when a write does not work.
 *
 * Three screens used to say nothing. Logging a hand and starting a session each
 * caught the throw and stopped their spinner; the rebuy and the cash-out had no
 * catch at all, so a throw was an unhandled rejection. In every case the screen
 * did not move, which from a foot away is what success looks like -- so a write
 * that failed read as a write that worked.
 *
 * The failures are not exotic. IndexedDB has a quota, a phone runs out of disk,
 * and a constraint can be violated. The one that matters most is the cash-out,
 * because that is the moment the result is written.
 *
 * Session detail was missed when this suite was written, and had the same two
 * holes in a quieter place: the notes were fired at the store on blur and
 * forgotten, and the delete navigated to History before knowing whether the
 * session had gone. Neither said anything, and the notes one is the worse of
 * the two -- what you typed stays on screen looking saved.
 */

import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import LogHandScreen from '../../../app/session/hand';
import ActiveSessionScreen from '../../../app/session/active';
import SessionDetailScreen from '../../../app/session/[id]';
import { useLogStore } from '../../store/useLogStore';

/**
 * Two screens in this file read the route, and they read different things out
 * of it: session detail wants the session's id, and the hand screen treats an
 * `id` as a hand to edit. One fixed object would put the hand screen into edit
 * mode on a session id, so the params are set per test instead.
 */
const params: { id?: string } = {};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => params,
}));

const replace = jest.requireMock('expo-router').router.replace as jest.Mock;

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

const full = () => new Error('The database is full.');

const ready = (over: Partial<ReturnType<typeof useLogStore.getState>> = {}) => {
  replace.mockClear();
  delete params.id;
  return useLogStore.setState({
    status: 'ready',
    activeSession: session('s1'),
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    ...over,
  });
};

describe('a hand that will not save', () => {
  it('says so rather than just stopping', async () => {
    ready({ logHand: (async () => { throw full(); }) as never });
    await renderScreen(<LogHandScreen />);

    await userEvent.press(screen.getByLabelText('Rank A'));
    await userEvent.press(screen.getByLabelText('A of spades'));
    await userEvent.press(screen.getByText('Save hand'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
  });

  it('and leaves the player on the screen, with what they typed', async () => {
    // Sending them back would throw away the hand as well as lose it.
    ready({ logHand: (async () => { throw full(); }) as never });
    await renderScreen(<LogHandScreen />);

    await userEvent.press(screen.getByLabelText('Rank A'));
    await userEvent.press(screen.getByLabelText('A of spades'));
    await userEvent.press(screen.getByText('Save hand'));

    await screen.findByText('The database is full.');
    expect(screen.getByText('Save hand')).toBeTruthy();
  });

  it('falls back to plain words when the failure has none', async () => {
    ready({ logHand: (async () => { throw new Error(''); }) as never });
    await renderScreen(<LogHandScreen />);

    await userEvent.press(screen.getByLabelText('Rank A'));
    await userEvent.press(screen.getByLabelText('A of spades'));
    await userEvent.press(screen.getByText('Save hand'));

    expect(await screen.findByText('That hand could not be saved.')).toBeTruthy();
  });
});

describe('a rebuy that will not save', () => {
  it('says so inside the sheet the player is looking at', async () => {
    ready({ addRebuy: (async () => { throw full(); }) as never });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Rebuy'));
    await userEvent.press(screen.getByText('Add rebuy'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
  });
});

describe('a cash-out that will not save', () => {
  it('says so, because this is the moment the result is written', async () => {
    // The one there was no catch for at all.
    ready({ endSession: (async () => { throw full(); }) as never });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    // The button stays disabled until there is a number to write.
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await userEvent.press(screen.getByText('End session'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
  });

  it('and keeps the sheet open, so the number is not retyped from memory', async () => {
    ready({ endSession: (async () => { throw full(); }) as never });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    // The button stays disabled until there is a number to write.
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await userEvent.press(screen.getByText('End session'));

    await screen.findByText('The database is full.');
    expect(screen.getByText('End session')).toBeTruthy();
  });
});

describe('a cash-out whose night closed and whose extras did not', () => {
  it('still says so, on the screen the player is actually looking at', async () => {
    // `endSession` writes the cash-out first and the tournament result and the
    // end mood after it, and re-reads the log on both paths so the store
    // cannot go on drawing a session the database has finished. That means a
    // throw from one of the later writes arrives with `activeSession` already
    // gone, and this screen has re-rendered through its "No session running"
    // branch before the catch sets anything: the message went into state that
    // branch did not draw, so the player was left on an empty screen with the
    // result written and nothing said.
    ready({
      endSession: (async () => {
        useLogStore.setState({ activeSession: null });
        throw full();
      }) as never,
    });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await userEvent.press(screen.getByText('End session'));

    expect(await screen.findByText('No session running')).toBeTruthy();
    expect(screen.getByText('The database is full.')).toBeTruthy();
  });
});

describe('re-entering a tournament', () => {
  const TOURNAMENT = session('t1', {
    format: 'tournament',
    stakes: null,
    buyIn: 10_000,
    fee: 1_000,
    cashOut: null,
    endedAt: null,
  });

  it('offers what an entry actually costs, fee and all', async () => {
    // The presets were the cash-game three off the buy-in alone, so the middle
    // one, the one that matches a re-entry, was short by exactly the fee, and
    // the other two were amounts no tournament sells. `totalInvested` counts
    // the fee and the Variance tab gives it a tile labeled "never coming
    // back"; the sheet that spends it did not.
    ready({ activeSession: TOURNAMENT, sessions: [TOURNAMENT] });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Re-enter'));

    // The field opens on one entry rather than on the bare buy-in.
    expect(screen.getByLabelText('Re-entry amount').props.value).toBe('110');
    // Two entries is a chip; twice the buy-in alone is not, and neither is
    // half an entry, which is a cash-game top-up rather than anything a
    // tournament sells.
    expect(screen.getByText('$220')).toBeTruthy();
    expect(screen.queryByText('$200')).toBeNull();
    expect(screen.queryByText('$50')).toBeNull();
  });

  it('and a cash game keeps the three it had', async () => {
    ready();
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Rebuy'));

    expect(screen.getByLabelText('Rebuy amount').props.value).toBe('300');
    expect(screen.getByText('$150')).toBeTruthy();
    expect(screen.getByText('$600')).toBeTruthy();
  });
});

describe('a note about one action, inside another', () => {
  it('does not follow the player into the cash-out sheet', async () => {
    // One `failed` string drives three notes on this screen: the rebuys card,
    // the rebuy sheet and the cash-out sheet. Nothing cleared it when a sheet
    // opened, only when an action was attempted, so a rebuy that would not
    // save presented itself again as a cash-out failure before the cash-out
    // had been tried.
    ready({ addRebuy: (async () => { throw full(); }) as never });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Rebuy'));
    await userEvent.press(screen.getByText('Add rebuy'));
    await screen.findByText('The database is full.');
    await userEvent.press(screen.getByLabelText('Close'));

    await userEvent.press(screen.getByText('Cash out & end session'));
    expect(screen.queryByText('The database is full.')).toBeNull();
  });
});

describe('session notes that will not save', () => {
  it('says so, rather than leaving the text on screen looking saved', async () => {
    ready({ updateSessionNotes: (async () => { throw full(); }) as never });
    params.id = 's1';
    await renderScreen(<SessionDetailScreen />);

    const notes = screen.getByLabelText('Session notes');
    await userEvent.type(notes, 'Ran terrible.');
    // Typing saves nothing; the write happens on blur, which is where the
    // throw went unnoticed. Inside `act` because the write is awaited and the
    // note it puts on screen lands a microtask later.
    await act(async () => {
      fireEvent(notes, 'blur');
    });

    expect(await screen.findByText('The database is full.')).toBeTruthy();
  });

  it('and keeps what was typed, so it can be copied out', async () => {
    ready({ updateSessionNotes: (async () => { throw full(); }) as never });
    params.id = 's1';
    await renderScreen(<SessionDetailScreen />);

    const notes = screen.getByLabelText('Session notes');
    await userEvent.type(notes, 'Ran terrible.');
    await act(async () => {
      fireEvent(notes, 'blur');
    });

    await screen.findByText('The database is full.');
    expect(screen.getByDisplayValue('Ran terrible.')).toBeTruthy();
  });
});

describe('a session that will not delete', () => {
  it('says so rather than sending the player to History', async () => {
    ready({ deleteSession: (async () => { throw full(); }) as never });
    params.id = 's1';
    await renderScreen(<SessionDetailScreen />);

    await userEvent.press(screen.getByText('Delete session'));
    await userEvent.press(screen.getByText('Delete'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
    // The navigation used to happen regardless, which put the player in
    // History with the session still sitting in it.
    expect(replace).not.toHaveBeenCalled();
  });

  it('and goes to History when it does delete', async () => {
    ready({ deleteSession: (async () => undefined) as never });
    params.id = 's1';
    await renderScreen(<SessionDetailScreen />);

    await userEvent.press(screen.getByText('Delete session'));
    await userEvent.press(screen.getByText('Delete'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/history'));
  });
});

describe('a rebuy taken back out', () => {
  it('asks before removing it', async () => {
    // A rebuy is part of `totalInvested`, so a mistyped one moves the result of
    // the session. Until this existed the only way out was deleting the night.
    const withRebuy = session('s1', {
      rebuys: [
        { id: 'r1', sessionId: 's1', amount: 20_000, at: 0, createdAt: 0, updatedAt: 0 },
      ],
    });
    const removed: string[] = [];
    ready({
      activeSession: withRebuy,
      sessions: [withRebuy],
      removeRebuy: (async (id: string) => {
        removed.push(id);
      }) as never,
    });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByLabelText('Remove rebuy 1, $200'));
    expect(removed).toHaveLength(0);

    await userEvent.press(screen.getByText('Remove'));
    expect(removed).toEqual(['r1']);
  });

  it('and says so when it will not go', async () => {
    const withRebuy = session('s1', {
      rebuys: [
        { id: 'r1', sessionId: 's1', amount: 20_000, at: 0, createdAt: 0, updatedAt: 0 },
      ],
    });
    ready({
      activeSession: withRebuy,
      sessions: [withRebuy],
      removeRebuy: (async () => { throw full(); }) as never,
    });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByLabelText('Remove rebuy 1, $200'));
    await userEvent.press(screen.getByText('Remove'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
  });
});

describe('cashing out a session that was left running', () => {
  const HOUR = 3_600_000;
  /** Started last night, still running this afternoon: the pocket case. */
  const overnight = () =>
    session('s1', { startedAt: Date.now() - 16 * HOUR, endedAt: null, cashOut: null });

  it('asks how long it actually was, rather than believing the clock', async () => {
    ready({ activeSession: overnight(), sessions: [overnight()] });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    expect(screen.getByLabelText('Hours played')).toBeTruthy();
  });

  it('and stamps the end from what was said, not from now', async () => {
    // Sixteen hours the player did not play. `durationMs` feeds `hourlyRate`
    // and `estimatePlayer`, and both divide by hours.
    const running = overnight();
    const ended: unknown[] = [];
    ready({
      activeSession: running,
      sessions: [running],
      endSession: (async (...args: unknown[]) => {
        ended.push(args);
      }) as never,
    });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await userEvent.type(screen.getByLabelText('Hours played'), '5');
    await userEvent.press(screen.getByText('End session'));

    const [, , , result] = ended[0] as [string, number, unknown, { endedAt?: number }];
    expect(result.endedAt).toBe(running.startedAt + 5 * HOUR);
  });

  it('but leaves the clock alone when the field is left empty', async () => {
    const running = overnight();
    const ended: unknown[] = [];
    ready({
      activeSession: running,
      sessions: [running],
      endSession: (async (...args: unknown[]) => {
        ended.push(args);
      }) as never,
    });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    await userEvent.type(screen.getByLabelText('Cash-out amount'), '450');
    await userEvent.press(screen.getByText('End session'));

    const [, , , result] = ended[0] as [string, number, unknown, { endedAt?: number }];
    expect(result.endedAt).toBeUndefined();
  });

  it('and never asks at all on a session of ordinary length', async () => {
    // The whole point of the threshold: the common cash-out stays one number
    // and a tap. Started three hours ago, which is a live session rather than
    // the fixture's fixed date, so the clock reads as something believable.
    const tonight = session('s1', { startedAt: Date.now() - 3 * HOUR, endedAt: null });
    ready({ activeSession: tonight, sessions: [tonight] });
    await renderScreen(<ActiveSessionScreen />);

    await userEvent.press(screen.getByText('Cash out & end session'));
    expect(screen.queryByLabelText('Hours played')).toBeNull();
    expect(screen.queryByText('Still playing?')).toBeNull();
  });
});

describe('when nothing has gone wrong', () => {
  it('there is no note on the screen at all', async () => {
    ready({ logHand: (async () => ({ id: 'h1' })) as never });
    await renderScreen(<LogHandScreen />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
