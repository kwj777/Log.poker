/**
 * Adding a hand to a session that is not running.
 *
 * Everything else about a hand had a way to be fixed -- edit it, delete it,
 * edit the session around it, add the session itself after the fact -- and a
 * hand could still only be written while somebody was sitting at the table.
 * `logHand` never had that restriction; the screen did, by reading
 * `activeSession` and refusing when there was none.
 *
 * What is worth pinning is the part that is not merely "the form opens": when
 * the hand is timed, and that the reset offer stays where it belongs. A hand
 * added to a night that is over is not a bad beat that has just happened to
 * somebody, and offering them a break from a table they left last Tuesday
 * would be the app talking to itself.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import LogHandScreen from '../../../app/session/hand';
import { useLogStore } from '../../store/useLogStore';

const mockLogged: { sessionId: string; at?: number; tags?: string[] }[] = [];
const mockParams: { id?: string; sessionId?: string } = {};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

/** A night that ended, and the live one, so the screen can tell them apart. */
const ENDED = session('done', { startedAt: Date.UTC(2026, 0, 1), endedAt: Date.UTC(2026, 0, 1, 5) });
const LIVE = session('live', { endedAt: null, cashOut: null });

const pickCard = async (rank: string, suitLabel: string) => {
  await userEvent.press(screen.getByLabelText(`Rank ${rank}`));
  await userEvent.press(screen.getByLabelText(`${rank} of ${suitLabel}`));
};

beforeEach(() => {
  mockLogged.length = 0;
  delete mockParams.id;
  delete mockParams.sessionId;
  useLogStore.setState({
    status: 'ready',
    activeSession: null,
    sessions: [ENDED],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    logHand: (async (input: { sessionId: string }) => {
      mockLogged.push(input);
      return { id: 'h1' };
    }) as never,
    tableOfferMadeAt: null,
  });
});

describe('a hand on a night that is over', () => {
  it('writes to the session the route named, with nothing running', async () => {
    mockParams.sessionId = 'done';
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByText('Save hand'));

    expect(mockLogged).toHaveLength(1);
    expect(mockLogged[0].sessionId).toBe('done');
  });

  it('times it at the end of that session rather than at now', async () => {
    mockParams.sessionId = 'done';
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByText('Save hand'));

    // Not Date.now(), which would file a hand from January under today and
    // sort it above every hand that really happened in that session.
    expect(mockLogged[0].at).toBe(ENDED.endedAt);
  });

  it('says which night it is going into, since it is not the one you are in', async () => {
    mockParams.sessionId = 'done';
    await renderScreen(<LogHandScreen />);
    expect(screen.getByText(/Adding to Aria on/)).toBeTruthy();
  });

  it('offers no reset, however the hand was tagged', async () => {
    mockParams.sessionId = 'done';
    await renderScreen(<LogHandScreen />);
    await userEvent.press(screen.getByText('bad beat'));
    await userEvent.press(screen.getByText('Save hand'));

    expect(mockLogged).toHaveLength(1);
    expect(screen.queryByText('That one is logged.')).toBeNull();
  });

  it('says so when the route names a session that is not there', async () => {
    mockParams.sessionId = 'gone';
    await renderScreen(<LogHandScreen />);
    // Not "no session running", which is advice for a problem they do not have.
    expect(screen.getByText('Session not found')).toBeTruthy();
  });
});

describe('the live table is unchanged', () => {
  it('still writes to the running session with no route param at all', async () => {
    useLogStore.setState({ activeSession: LIVE, sessions: [LIVE] });
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByText('Save hand'));

    expect(mockLogged[0].sessionId).toBe('live');
    // Left to the store, which stamps it now.
    expect(mockLogged[0].at).toBeUndefined();
  });

  it('and still offers the reset there', async () => {
    useLogStore.setState({ activeSession: LIVE, sessions: [LIVE] });
    await renderScreen(<LogHandScreen />);
    await userEvent.press(screen.getByText('bad beat'));
    await userEvent.press(screen.getByText('Save hand'));

    expect(await screen.findByText('That one is logged.')).toBeTruthy();
  });

  it('treats the live session opened by id as live, not as history', async () => {
    useLogStore.setState({ activeSession: LIVE, sessions: [LIVE] });
    mockParams.sessionId = 'live';
    await renderScreen(<LogHandScreen />);
    await pickCard('A', 'spades');
    await pickCard('K', 'diamonds');
    await userEvent.press(screen.getByText('Save hand'));

    // The two ways in disagree about the param and agree about the session, so
    // it is `endedAt` that decides, not which button was pressed.
    expect(mockLogged[0].at).toBeUndefined();
  });
});

describe('a named session that is not there any more', () => {
  it('says so rather than quietly writing the hand to tonight instead', async () => {
    // The screen has always had the words for this, and could not reach them
    // while a live session existed: `namedSession ?? activeSession` fell
    // through to the live one as readily for a session that was named and is
    // gone as for one that was never named. `atTheTable` then matched, and
    // Save wrote the hand to the table the player is sitting at, stamped now.
    //
    // A sync applying a delete from another device while the form is open is
    // all it takes.
    mockParams.sessionId = 'deleted-elsewhere';
    useLogStore.setState({ activeSession: LIVE, sessions: [LIVE] });

    await renderScreen(<LogHandScreen />);

    expect(screen.getByText('Session not found')).toBeTruthy();
    expect(screen.getByText('It may have been deleted.')).toBeTruthy();
    expect(mockLogged).toEqual([]);
  });

  it('and still offers the live session when the route named nothing at all', async () => {
    useLogStore.setState({ activeSession: LIVE, sessions: [LIVE] });

    await renderScreen(<LogHandScreen />);

    expect(screen.queryByText('Session not found')).toBeNull();
    expect(screen.queryByText('No session running')).toBeNull();
  });
});
