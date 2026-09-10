/**
 * What a write reads back, and what it leaves alone.
 *
 * The store used to re-read all four of its tables after every write. That is
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

import type { Repository } from '../../data/repository';

const repository = {
  listVenues: jest.fn(),
  listSessions: jest.fn(),
  listHands: jest.fn(),
  listMoodEntries: jest.fn(),
  getActiveSession: jest.fn(),
  createVenue: jest.fn(),
  updateVenue: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  createHand: jest.fn(),
  addRebuy: jest.fn(),
  createMoodEntry: jest.fn(),
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
  repository.listMoodEntries.mockImplementation(async () => [{ id: 'm1', sessionId: 's1' }]);
  repository.getActiveSession.mockImplementation(async () => null);
};

const readCounts = () => ({
  venues: repository.listVenues.mock.calls.length,
  sessions: repository.listSessions.mock.calls.length,
  hands: repository.listHands.mock.calls.length,
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
  useLogStore.setState({ status: 'idle', error: null });
  await useLogStore.getState().hydrate();
  jest.clearAllMocks();
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
    expect(after.hands).not.toBe(before.hands);
  });

  it('and a rebuy the same hands array', async () => {
    const before = useLogStore.getState();
    await useLogStore.getState().addRebuy('s1', 10_000);
    const after = useLogStore.getState();

    expect(after.hands).toBe(before.hands);
    expect(after.moodEntries).toBe(before.moodEntries);
    expect(after.sessions).not.toBe(before.sessions);
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

    repository.listHands.mockImplementationOnce(async () => {
      await slow;
      return [{ id: 'stale' }];
    });

    const first = useLogStore.getState().refresh(['hands']);
    const second = useLogStore.getState().refresh(['hands']);
    await second;
    releaseSlow();
    await first;

    expect(useLogStore.getState().hands).toEqual([{ id: 'h1', sessionId: 's1' }]);
  });

  it('and does not let it drop the slices nobody else claimed', async () => {
    // A full reload overlapping a hand write shares `hands` and nothing else.
    // One counter for the whole store would throw away its venues and sessions
    // to settle that one table.
    let releaseSlow: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    repository.listHands.mockImplementationOnce(async () => {
      await slow;
      return [{ id: 'stale' }];
    });
    repository.listVenues.mockImplementationOnce(async () => [{ id: 'v-from-the-slow-read' }]);

    const full = useLogStore.getState().refresh();
    const handsOnly = useLogStore.getState().refresh(['hands']);
    await handsOnly;
    releaseSlow();
    await full;

    expect(useLogStore.getState().hands).toEqual([{ id: 'h1', sessionId: 's1' }]);
    expect(useLogStore.getState().venues).toEqual([{ id: 'v-from-the-slow-read' }]);
  });
});
