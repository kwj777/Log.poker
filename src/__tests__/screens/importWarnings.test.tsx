/**
 * What the import screen says about a file it could not use.
 *
 * `parseSessionCsv` writes a reason per row it skips, and reports an error
 * whenever nothing survived: "Nothing in that file could be read as a
 * session." A file where every row was skipped is both of those at once -- a
 * file the parser had a specific reason to reject on every line -- and the
 * screen drew the per-line reasons only in the branch where at least one row
 * had landed. So on the one path where they are the whole explanation, they
 * were computed and thrown away, and the player got one generic sentence and a
 * list of the column names.
 *
 * Month-name dates, Excel serial dates and a blank result column all land
 * there, which is not a contrived file: it is a tracker export that named its
 * dates differently.
 */

import { screen, userEvent } from '@testing-library/react-native';

import { renderScreen } from '../support/screen';
import ImportScreen from '../../../app/import';
import { useLogStore } from '../../store/useLogStore';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() } }));

jest.mock('../../features/import/pickCsvFile', () => ({
  CAN_PICK_FILE: false,
  pickCsvFile: async () => null,
}));

jest.mock('../../data', () => ({
  getRepository: async () => ({}),
  onSyncApplied: () => () => undefined,
}));

const paste = async (csv: string) => {
  await renderScreen(<ImportScreen />);
  await userEvent.paste(screen.getByLabelText('Session summary rows'), csv);
};

beforeEach(() => {
  useLogStore.setState({
    status: 'ready',
    sessions: [],
    venues: [],
    moodEntries: [],
    handCount: 0,
    handsVersion: 0,
  });
});

describe('a file where every row was skipped', () => {
  it('says why each one was, not only that none of them worked', async () => {
    await paste('Date,Buy-in,Cash-out\nJan 2 2026,100,250\nJan 3 2026,100,0\n');

    // The generic sentence is still there, and is still not an explanation.
    expect(screen.getByText(/Nothing in that file could be read/)).toBeTruthy();
    expect(screen.getByText('Worth knowing')).toBeTruthy();
    // One per row, each naming its own line.
    expect(screen.getAllByText(/Couldn’t read the date/)).toHaveLength(2);
    expect(screen.getByText('Line 2')).toBeTruthy();
    expect(screen.getByText('Line 3')).toBeTruthy();
  });

  it('and does the same for a row with nothing to make a result from', async () => {
    await paste('Date,Buy-in,Result\n2026-01-02,100,\n2026-01-03,100,-\n');

    expect(screen.getByText(/Nothing in that file could be read/)).toBeTruthy();
    expect(screen.getAllByText(/No result or cash-out on this row/)).toHaveLength(2);
  });
});

describe('a file that mostly worked', () => {
  it('still says what it skipped on the way', async () => {
    // The case that was already covered, kept so hoisting the block out of
    // that branch is held to leaving it there.
    await paste('Date,Buy-in,Cash-out\n2026-01-02,100,250\nJan 3 2026,100,0\n');

    expect(screen.queryByText(/Nothing in that file could be read/)).toBeNull();
    expect(screen.getByText('Worth knowing')).toBeTruthy();
    expect(screen.getByText(/Couldn’t read the date/)).toBeTruthy();
  });

  it('and says nothing of the kind when there is nothing to say', async () => {
    // A file with everything in it. A file merely *readable* still warns: no
    // stakes column and no duration column are both things the variance view
    // needs and will not have, which is the block doing its job.
    await paste(
      'Date,Stakes,Buy-in,Cash-out,Duration\n' +
        '2026-01-02,$1/$2,100,250,4:00\n2026-01-03,$1/$2,100,0,3:30\n',
    );

    expect(screen.queryByText('Worth knowing')).toBeNull();
  });
});

describe('what the preview says a file is worth', () => {
  /**
   * `parseSessionCsv` resolves a currency per row, so a file can hold several.
   *
   * The headline summed them all and labeled the total with whichever row came
   * first. It is the number a player reads to decide whether to press Import,
   * and Log's own export writes a Currency column, so a player with two
   * currencies hits it on their own file. The three tab screens each carry a
   * comment about having fixed this exact thing.
   */
  const MIXED = [
    'Date,Game,Stakes,Buy-in,Cash-out,Currency,Site',
    '2026-03-01 19:00,NLHE,1/2,200,500,USD,Aria',
    '2026-03-02 19:00,NLHE,1/2,200,900,EUR,Kings',
    '',
  ].join('\n');

  it('keeps two currencies apart rather than adding them up', async () => {
    await paste(MIXED);

    expect(await screen.findByText('2 sessions')).toBeTruthy();
    expect(screen.getByText('+$300')).toBeTruthy();
    expect(screen.getByText(/700/)).toBeTruthy();
    // The sum that was printed before, with the first row's symbol on it.
    expect(screen.queryByText('+$1,000')).toBeNull();
  });

  it('and still says one figure when the file says one currency', async () => {
    await paste(
      [
        'Date,Game,Stakes,Buy-in,Cash-out,Currency,Site',
        '2026-03-01 19:00,NLHE,1/2,200,500,USD,Aria',
        '2026-03-02 19:00,NLHE,1/2,200,900,USD,Kings',
        '',
      ].join('\n'),
    );

    expect(await screen.findByText('2 sessions')).toBeTruthy();
    expect(screen.getByText('+$1,000')).toBeTruthy();
  });
});

