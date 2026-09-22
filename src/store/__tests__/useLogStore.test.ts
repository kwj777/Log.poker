/**
 * What a write reads back, and what it leaves alone.
 *
 * The store used to re-read all five of its slices after every write. That is
 * the behavior these tests pin the replacement of, and there are two halves to
 * it. The obvious one is the reading: a rebuy has no business loading every
 * hand ever logged, and on a five-year log that was most of the time it took.
 *
 * The other half is what a reload does to everything downstream. Replacing an
 * array invalidates every `useMemo` over it, so logging a hand re-ran the
 * tournament bootstrap on the variance tab -- two thousand resamples -- because
 * the sessions array was new, not because it was different. A slice that is not
 * read keeps the array it had, which is what the identity assertions below are
 * about: they look like they are testing an implementation detail and they are
 * testing that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Repository } from '../../data/repository';

const repository = {
  listVenues: jest.fn(),
  listSessions: jest.fn(),
  listHands: jest.fn(),
  countHands: jest.fn(),
  listMoodEntries: jest.fn(),
  getActiveSession: jest.fn(),
  getPreferences: jest.fn(),
  setPreferences: jest.fn(),
  createVenue: jest.fn(),
  updateVenue: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  createHand: jest.fn(),
  addRebuy: jest.fn(),
  createMoodEntry: jest.fn(),
  endSession: jest.fn(),
};

jest.mock('../../data', () => ({
  getRepository: async () => repository as unknown as Repository,
  onSyncApplied: () => () => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useLogStore } = require('../useLogStore') as typeof import('../useLogStore');

/** Fresh arrays every call, exactly as a real read would hand back. */
const stubReads = () => {
  repository.listVenues.mockImplementation(async () => [{ id: 'v1', name: 'Aria' }]);
  repository.listSessions.mockImplementation(async () => [{ id: 's1', rebuys: [] }]);
  repository.listHands.mockImplementation(async () => [{ id: 'h1', sessionId: 's1' }]);
  repository.countHands.mockImplementation(async () => 1);
  repository.listMoodEntries.mockImplementation(async () => [{ id: 'm1', sessionId: 's1' }]);
  repository.getActiveSession.mockImplementation(async () => null);
  repository.getPreferences.mockImplementation(async () => ({ startingBalance: null }));
  repository.setPreferences.mockImplementation(async (patch) => patch);
};

const readCounts = () => ({
  venues: repository.listVenues.mock.calls.length,
  sessions: repository.listSessions.mock.calls.length,
  hands: repository.countHands.mock.calls.length,
  moodEntries: repository.listMoodEntries.mock.calls.length,
});

beforeEach(async () => {
  jest.clearAllMocks();
  stubReads();
  repository.createHand.mockImplementation(async () => ({ id: 'h2', sessionId: 's1' }));
  repository.addRebuy.mockImplementation(async () => ({ id: 'r1', sessionId: 's1' }));
  repository.createVenue.mockImplementation(async () => ({ id: 'v2', name: 'Bellagio' }));
  repository.updateVenue.mockImplementation(async () => undefined);
  repository.createMoodEntry.mockImplementation(async () => undefined);
  repository.createSession.mockImplementation(async () => ({ id: 's2', venueId: 'v1' }));
  repository.deleteSession.mockImplementation(async () => undefined);
  repository.endSession.mockImplementation(async () => undefined);
  useLogStore.setState({ status: 'idle', error: null });
  await useLogStore.getState().hydrate();
  jest.clearAllMocks();
});

describe('how many slices there are', () => {
  it('is the number the file says it is, in every sentence that says one', () => {
    // The header claimed the store "holds the whole dataset" and named "the
    // four tables" for three versions after neither was true: the hands came
    // out, `preferences` went in, and four other sentences in the same file
    // already said so in the past tense. The `Slice` union was right the whole
    // time, which is why nothing broke and why nobody noticed -- so it is the
    // union that is asked here, out of the same file.
    //
    // Spelled-out numbers only, and only where one counts a noun this file
    // uses for a slice, so an unrelated "five years of a heavy live player"
    // is left alone.
    const SPELLED = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    const source = readFileSync(join(__dirname, '..', 'useLogStore.ts'), 'utf8');
    const union = /type Slice =([^;]+);/.exec(source) as RegExpExecArray;
    const slices = union[1].split('|').length;
    const counts = [
      ...source.matchAll(/\b(one|two|three|four|five|six|seven|eight)\s+(slices?|reads?|tables?)\b/g),
    ];

    expect(counts.length).toBeGreaterThan(0);
    expect(counts.map(([, word]) => word)).toEqual(counts.map(() => SPELLED[slices - 1]));
  });

  it('and the hands are described as something two screens read across', () => {
    // `handCount`'s docstring justified holding a number rather than the rows
    // with "every screen that shows hands is a screen about one session". Two
    // are not: the hand log and the variance tab filter across the whole
    // history, and they are served by `useAllHands` seven hundred lines below
    // that sentence in the same file.
    const source = readFileSync(join(__dirname, '..', 'useLogStore.ts'), 'utf8');
    expect(source.replace(/\n\s*\*/g, '')).not.toContain(
      'every screen that shows hands is a screen about one session',
    );
    expect(source).toContain('export const useAllHands');
  });
});

describe('what a write reads back', () => {
  it('reads only the hands when a hand is logged', async () => {
    await useLogStore.getState().logHand({ sessionId: 's1' });
    expect(readCounts()).toEqual({ venues: 0, sessions: 0, hands: 1, moodEntries: 0 });
  });

  it('reads only the sessions when a rebuy is added, since rebuys are children', async () => {
    await useLogStore.getState().addRebuy('s1', 10_000);
    expect(readCounts()).toEqual({ venues: 0, sessions: 1, hands: 0, moodEntries: 0 });
  });

  it('reads the venues too when a session is started, because sessionCount is derived', async () => {
    await useLogStore.getState().startSession({ venueId: 'v1', gameType: 'NLHE', buyIn: 30_000 });
    const counts = readCounts();
    expect(counts.sessions).toBe(1);
    expect(counts.venues).toBe(1);
  });

  it('reads the sessions too when a venue is renamed, because each one carries its venue', async () => {
    await useLogStore.getState().renameVenue('v1', 'Aria High Limit');
    expect(readCounts()).toEqual({ venues: 1, sessions: 1, hands: 0, moodEntries: 0 });
  });

  it('reads everything when a session is deleted, because the tombstone cascades', async () => {
    await useLogStore.getState().deleteSession('s1');
    expect(readCounts()).toEqual({ venues: 1, sessions: 1, hands: 1, moodEntries: 1 });
  });
});

describe('what a write leaves alone', () => {
  it('hands a hand write the same sessions array it already had', async () => {
    const before = useLogStore.getState();
    await useLogStore.getState().logHand({ sessionId: 's1' });
    const after = useLogStore.getState();

    // The point of the whole change: unchanged by identity, so nothing memoized
    // over the sessions recomputes.
    expect(after.sessions).toBe(before.sessions);
    expect(after.venues).toBe(before.venues);
    expect(after.moodEntries).toBe(before.moodEntries);
  });

  it('and a rebuy leaves the hands where they were', async () => {
    const before = useLogStore.getState();
    await useLogStore.getState().addRebuy('s1', 10_000);
    const after = useLogStore.getState();

    expect(after.moodEntries).toBe(before.moodEntries);
    expect(after.sessions).not.toBe(before.sessions);
    // Nothing re-reads a session's hands over a rebuy.
    expect(after.handsVersion).toBe(before.handsVersion);
  });
});

describe('telling the hands hook to read again', () => {
  it('moves the version when a hand is logged', async () => {
    const before = useLogStore.getState().handsVersion;
    await useLogStore.getState().logHand({ sessionId: 's1' });
    expect(useLogStore.getState().handsVersion).toBeGreaterThan(before);
  });

  it('and when a session is deleted, which takes its hands with it', async () => {
    const before = useLogStore.getState().handsVersion;
    await useLogStore.getState().deleteSession('s1');
    expect(useLogStore.getState().handsVersion).toBeGreaterThan(before);
  });

  it('but not when only a venue was renamed', async () => {
    const before = useLogStore.getState().handsVersion;
    await useLogStore.getState().renameVenue('v1', 'Aria High Limit');
    expect(useLogStore.getState().handsVersion).toBe(before);
  });

  it('counts the hands rather than reading them', async () => {
    await useLogStore.getState().logHand({ sessionId: 's1' });
    // The whole point: a hand write must not read every hand in the log.
    expect(repository.listHands).not.toHaveBeenCalled();
    expect(repository.countHands).toHaveBeenCalled();
  });
});

describe('two reloads in flight at once', () => {
  it('keeps the newer answer for the slice they share', async () => {
    // The slow one started first and reads the database as it was before the
    // second write. Landing last, it used to win.
    let releaseSlow: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    repository.countHands.mockImplementationOnce(async () => {
      await slow;
      return 99;
    });

    const first = useLogStore.getState().refresh(['hands']);
    const second = useLogStore.getState().refresh(['hands']);
    await second;
    releaseSlow();
    await first;

    expect(useLogStore.getState().handCount).toBe(1);
  });

  it('and does not let it drop the slices nobody else claimed', async () => {
    // A full reload overlapping a hand write shares `hands` and nothing else.
    // One counter for the whole store would throw away its venues and sessions
    // to settle that one table.
    let releaseSlow: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    repository.countHands.mockImplementationOnce(async () => {
      await slow;
      return 99;
    });
    repository.listVenues.mockImplementationOnce(async () => [{ id: 'v-from-the-slow-read' }]);

    const full = useLogStore.getState().refresh();
    const handsOnly = useLogStore.getState().refresh(['hands']);
    await handsOnly;
    releaseSlow();
    await full;

    expect(useLogStore.getState().handCount).toBe(1);
    expect(useLogStore.getState().venues).toEqual([{ id: 'v-from-the-slow-read' }]);
  });
});

describe('a write that lands and then a second one that does not', () => {
  it('still learns about the session the database is now holding', async () => {
    // `createSession` commits and `createMoodEntry` throws after it. The
    // refresh used to sit below both, so it never ran: the store went on
    // showing no session while the database held a live one, and the screen
    // caught the rejection, said the session could not be started and put the
    // Start button back. Pressing it wrote a second live session, and
    // `getActiveSession` reads the newest open one, so the first became a row
    // that is invisible and permanently open.
    repository.createMoodEntry.mockImplementationOnce(async () => {
      throw new Error('out of space');
    });
    repository.getActiveSession.mockImplementation(async () => ({ id: 's2', rebuys: [] }));

    const session = await useLogStore.getState().startSession({
      venueId: 'v1', gameType: 'NLHE', buyIn: 30_000, mood: 3,
    });

    // The session started, because it did.
    expect(session.id).toBe('s2');
    expect(useLogStore.getState().activeSession).toEqual({ id: 's2', rebuys: [] });
  });

  it('and reads the log back after a cash-out whose extras threw', async () => {
    // The other end, where the throw is kept: what failed there is a
    // tournament's field and finish rather than one optional tap. The session
    // is closed either way, so the store has to stop drawing it as live.
    repository.createMoodEntry.mockImplementationOnce(async () => {
      throw new Error('out of space');
    });
    const before = readCounts().sessions;

    await expect(
      useLogStore.getState().endSession('s1', 45_000, 3),
    ).rejects.toThrow('out of space');

    expect(readCounts().sessions).toBeGreaterThan(before);
  });
});

describe('a preference written while a reload is in the air', () => {
  it('is not overwritten by the read that started before it', async () => {
    // `read` claims every slice before it starts and drops any another read has
    // claimed since, which is what stops a slow reload landing on top of a fast
    // one. `setStartingBalance` set its slice straight into the store without
    // going through `read`, so it was outside that guard: the reload still
    // believed it owned `preferences` and assigned its pre-write answer over
    // the new one. The number the player had just typed reverted on screen and
    // the dashboard headline flipped from Bankroll back to Profit, with the
    // right value in the database the whole time.
    //
    // `onSyncApplied` fires `refresh()` over everything, so the reload here is
    // the ordinary one a pull produces while somebody is on Settings.
    let releaseRead: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    repository.getPreferences.mockImplementationOnce(async () => {
      await slow;
      return { startingBalance: null };
    });

    const reload = useLogStore.getState().refresh();
    await useLogStore.getState().setStartingBalance({ cents: 500_000, currency: 'USD' });
    expect(useLogStore.getState().startingBalance).toEqual({ cents: 500_000, currency: 'USD' });

    releaseRead();
    await reload;

    expect(useLogStore.getState().startingBalance).toEqual({ cents: 500_000, currency: 'USD' });
  });
});

describe('a read that does not land', () => {
  /** The whole sessions slice refusing, which is what an unavailable database looks like. */
  const readsFail = () => {
    repository.listSessions.mockImplementation(async () => {
      throw new Error('read failed');
    });
    repository.getActiveSession.mockImplementation(async () => {
      throw new Error('read failed');
    });
  };

  it('says so to its caller rather than only writing it down', async () => {
    // `error` was the only record of this, and it has exactly one reader --
    // the root layout, which now draws it as a banner over whatever is on
    // screen. That is the right answer for a screen showing stale rows and the
    // wrong one for a caller about to navigate on the strength of the re-read.
    readsFail();

    expect(await useLogStore.getState().refresh(['sessions'])).toBe(false);
    expect(useLogStore.getState().error).toBe('read failed');
    expect(useLogStore.getState().status).toBe('ready');
  });

  it('and says so when it does land, which is every other time', async () => {
    expect(await useLogStore.getState().refresh(['sessions'])).toBe(true);
    expect(useLogStore.getState().error).toBeNull();
  });

  it('still does not fail the write that already committed', async () => {
    // The session is written before the refresh runs, and failing the call is
    // what used to put the Start button back on `app/session/new.tsx` and let
    // somebody write the night a second time. So `startSession` resolves, and
    // the store is left not holding what it just wrote -- which is the state
    // the screen has to notice for itself.
    readsFail();

    const session = await useLogStore
      .getState()
      .startSession({ venueId: 'v1', gameType: 'NLHE', buyIn: 30_000 });

    expect(session).toEqual({ id: 's2', venueId: 'v1' });
    expect(repository.createSession).toHaveBeenCalledTimes(1);
    expect(useLogStore.getState().activeSession).toBeNull();
  });
});

