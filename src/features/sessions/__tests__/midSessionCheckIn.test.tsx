/**
 * The one mood write with nowhere to say it had failed.
 *
 * Every other write in the app reports through `ErrorNote` and is pinned in
 * `writeFailures.test.tsx`. This one fired `void logMood(...)` with no catch
 * and then drew a card opening with the word "Logged.", so a quota or a full
 * disk left an unhandled rejection and a card asserting a check-in that is not
 * in the log, which the end-of-session summary then quietly disagrees with.
 */

import { render, screen, userEvent } from '@testing-library/react-native';

import { MidSessionCheckIn } from '../MidSessionCheckIn';
import { session } from '../../../__tests__/support/sessions';
import { useLogStore } from '../../../store/useLogStore';

jest.mock('../../../data', () => ({
  getRepository: async () => ({ listHands: async () => [] }),
  onSyncApplied: () => () => undefined,
}));

const HOUR = 3_600_000;
/** Three hours in, which is past the two the prompt waits for. */
const LIVE = session('s1', { startedAt: Date.now() - 3 * HOUR, endedAt: null, cashOut: null });

const ready = (logMood: (...args: never[]) => Promise<unknown>) =>
  useLogStore.setState({
    status: 'ready',
    activeSession: LIVE,
    sessions: [LIVE],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
    lastMidSessionPromptAt: null,
    logMood: logMood as never,
  });

describe('a check-in that will not save', () => {
  it('does not tell the player it was logged', async () => {
    ready(async () => {
      throw new Error('The database is full.');
    });
    await render(<MidSessionCheckIn session={LIVE} elapsedMs={3 * HOUR} />);

    // A 5 is the tilted end, which is the score that opens the reset card.
    await userEvent.press(screen.getByLabelText('Tilted, 5 of 5'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
    expect(screen.queryByText('Logged.')).toBeNull();
  });

  it('and still says so for a score that wanted no reset', async () => {
    // That branch draws no card at all, so the failure had nowhere to go: the
    // prompt simply vanished and the write was lost in silence.
    ready(async () => {
      throw new Error('The database is full.');
    });
    await render(<MidSessionCheckIn session={LIVE} elapsedMs={3 * HOUR} />);

    await userEvent.press(screen.getByLabelText('Calm, 1 of 5'));

    expect(await screen.findByText('The database is full.')).toBeTruthy();
  });

  it('says it was logged when it was', async () => {
    ready(async () => undefined);
    await render(<MidSessionCheckIn session={LIVE} elapsedMs={3 * HOUR} />);

    await userEvent.press(screen.getByLabelText('Tilted, 5 of 5'));

    expect(await screen.findByText('Logged.')).toBeTruthy();
  });
});
