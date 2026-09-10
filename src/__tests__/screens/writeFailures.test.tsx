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
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import { session } from '../support/sessions';
import LogHandScreen from '../../../app/session/hand';
import ActiveSessionScreen from '../../../app/session/active';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

const full = () => new Error('The database is full.');

const ready = (over: Partial<ReturnType<typeof useLogStore.getState>> = {}) =>
  useLogStore.setState({
    status: 'ready',
    activeSession: session('s1'),
    sessions: [session('s1')],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    ...over,
  });

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

describe('when nothing has gone wrong', () => {
  it('there is no note on the screen at all', async () => {
    ready({ logHand: (async () => ({ id: 'h1' })) as never });
    await renderScreen(<LogHandScreen />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
