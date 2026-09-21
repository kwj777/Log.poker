/**
 * Folding one room into another.
 *
 * A venue is free text typed at a table, so two spellings of one room is the
 * ordinary outcome rather than an edge case. Until this existed they were
 * permanent: `deleteVenue` is refused while sessions are logged against a
 * venue, which is right, and left a typo with a single session behind it on
 * the dashboard forever.
 *
 * What is worth pinning is the order. The sessions move first and the venue
 * goes last, so a failure part way leaves both venues in place with some
 * sessions moved -- the state the merge started from, only smaller, and
 * running it again finishes the job. The other order would delete a venue and
 * strand every session that had not moved yet.
 */

import type { Repository } from '../../data/repository';

const repository = {
  listVenues: jest.fn(),
  listSessions: jest.fn(),
  listHands: jest.fn(),
  countHands: jest.fn(),
  listMoodEntries: jest.fn(),
  getActiveSession: jest.fn(),
  getPreferences: jest.fn(),
  updateSession: jest.fn(),
  deleteVenue: jest.fn(),
};

jest.mock('../../data', () => ({
  getRepository: async () => repository as unknown as Repository,
  onSyncApplied: () => () => undefined,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useLogStore } = require('../useLogStore') as typeof import('../useLogStore');

/** What happened, in order, so the order itself can be asserted. */
let calls: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  repository.listVenues.mockImplementation(async () => []);
  repository.listHands.mockImplementation(async () => []);
  repository.countHands.mockImplementation(async () => 0);
  repository.listMoodEntries.mockImplementation(async () => []);
  repository.getActiveSession.mockImplementation(async () => null);
  repository.getPreferences.mockImplementation(async () => ({ startingBalance: null }));
  repository.listSessions.mockImplementation(async (filter?: { venueId?: string }) =>
    filter?.venueId === 'old' ? [{ id: 's1', rebuys: [] }, { id: 's2', rebuys: [] }] : [],
  );
  repository.updateSession.mockImplementation(async (id: string) => {
    calls.push(`move ${id}`);
    return { id };
  });
  repository.deleteVenue.mockImplementation(async (id: string) => {
    calls.push(`delete ${id}`);
  });
});

describe('merging a venue into another', () => {
  it('moves every session that was logged against it', async () => {
    await useLogStore.getState().mergeVenues('old', 'keep');
    expect(repository.updateSession).toHaveBeenCalledWith('s1', { venueId: 'keep' });
    expect(repository.updateSession).toHaveBeenCalledWith('s2', { venueId: 'keep' });
  });

  it('then removes the venue it emptied, and only then', async () => {
    await useLogStore.getState().mergeVenues('old', 'keep');
    expect(calls).toEqual(['move s1', 'move s2', 'delete old']);
  });

  it('answers how many moved, which is what the screen says back', async () => {
    expect(await useLogStore.getState().mergeVenues('old', 'keep')).toBe(2);
  });

  it('asks only for the sessions of the venue going away', async () => {
    await useLogStore.getState().mergeVenues('old', 'keep');
    expect(repository.listSessions).toHaveBeenCalledWith({ venueId: 'old' });
  });

  it('does nothing at all when a venue is merged into itself', async () => {
    expect(await useLogStore.getState().mergeVenues('old', 'old')).toBe(0);
    expect(repository.deleteVenue).not.toHaveBeenCalled();
    expect(repository.updateSession).not.toHaveBeenCalled();
  });

  it('leaves both venues in place when a session will not move', async () => {
    repository.updateSession.mockImplementation(async () => {
      throw new Error('write failed');
    });
    await expect(useLogStore.getState().mergeVenues('old', 'keep')).rejects.toThrow('write failed');
    // The half-done state is two venues and some sessions moved, which running
    // it again finishes. A delete here would have stranded the rest.
    expect(repository.deleteVenue).not.toHaveBeenCalled();
  });

  it('reads the venues and the sessions back, since both changed', async () => {
    await useLogStore.getState().mergeVenues('old', 'keep');
    // The venue read is what drops the row; the session read is what puts the
    // surviving name on every row that shows one.
    expect(repository.listVenues).toHaveBeenCalled();
    expect(repository.countHands).not.toHaveBeenCalled();
  });
});
