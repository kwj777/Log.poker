/**
 * The repository conformance suite.
 *
 * One suite, two implementations. Anything the app relies on -- ordering,
 * cascade behavior, patch semantics, constraint errors -- is asserted here once,
 * so SQLite and IndexedDB cannot quietly diverge and produce a bug that only
 * reproduces on one platform.
 */

import { ConstraintError, NotFoundError, type Repository } from '../repository';
import type { RepositoryContext } from '../support';

export interface HarnessContext {
  ctx: RepositoryContext;
  /** Advance the injected clock. */
  tick: (ms: number) => void;
}

export interface Harness {
  create: (context: HarnessContext) => Promise<Repository>;
  destroy: (repository: Repository) => Promise<void>;
}

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

/**
 * Deterministic clock and ids. Real timestamps and UUIDs would make assertions
 * about ordering and equality flaky for no benefit.
 */
const makeContext = (): HarnessContext => {
  let now = T0;
  let counter = 0;
  return {
    ctx: {
      clock: { now: () => now },
      ids: { next: () => `id-${String(++counter).padStart(3, '0')}` },
    },
    tick: (ms: number) => {
      now += ms;
    },
  };
};

export const runRepositoryContract = (name: string, harness: Harness): void => {
  describe(`${name} repository contract`, () => {
    let repository: Repository;
    let context: HarnessContext;

    beforeEach(async () => {
      context = makeContext();
      repository = await harness.create(context);
    });

    afterEach(async () => {
      await harness.destroy(repository);
    });

    const newVenue = (name_ = 'Bellagio', isHomeGame = false) =>
      repository.createVenue({ name: name_, isHomeGame });

    const stakes = { smallBlind: 100, bigBlind: 200 };

    const newSession = async (overrides: Partial<Parameters<Repository['createSession']>[0]> = {}) => {
      const venueId = overrides.venueId ?? (await newVenue()).id;
      return repository.createSession({
        venueId,
        gameType: 'NLHE',
        stakes,
        buyIn: 30_000,
        startedAt: T0,
        ...overrides,
      });
    };

    describe('venues', () => {
      it('creates a venue with generated id and timestamps', async () => {
        const venue = await newVenue('Commerce Casino');
        expect(venue).toMatchObject({
          id: 'id-001',
          name: 'Commerce Casino',
          isHomeGame: false,
          sessionCount: 0,
          createdAt: T0,
          updatedAt: T0,
        });
      });

      it('trims whitespace and rejects an empty name', async () => {
        const venue = await repository.createVenue({ name: '  Aria  ', isHomeGame: false });
        expect(venue.name).toBe('Aria');
        await expect(repository.createVenue({ name: '   ', isHomeGame: false })).rejects.toBeInstanceOf(
          ConstraintError,
        );
      });

      it('round-trips a venue through storage', async () => {
        const created = await newVenue('Wynn', true);
        expect(await repository.getVenue(created.id)).toEqual(created);
      });

      it('returns null for a missing venue', async () => {
        expect(await repository.getVenue('nope')).toBeNull();
      });

      it('derives sessionCount and sorts venues by most played', async () => {
        const quiet = await newVenue('Quiet Room');
        const busy = await newVenue('Busy Room');
        await newSession({ venueId: busy.id });
        await newSession({ venueId: busy.id });
        await newSession({ venueId: quiet.id });

        const venues = await repository.listVenues();
        expect(venues.map((venue) => [venue.name, venue.sessionCount])).toEqual([
          ['Busy Room', 2],
          ['Quiet Room', 1],
        ]);
      });

      it('sorts venues with equal counts by name, case-insensitively', async () => {
        await newVenue('zeta room');
        await newVenue('Alpha Room');
        const venues = await repository.listVenues();
        expect(venues.map((venue) => venue.name)).toEqual(['Alpha Room', 'zeta room']);
      });

      it('updates a venue and bumps updatedAt', async () => {
        const venue = await newVenue('Old Name');
        context.tick(5_000);
        const updated = await repository.updateVenue(venue.id, { name: 'New Name' });
        expect(updated.name).toBe('New Name');
        expect(updated.createdAt).toBe(T0);
        expect(updated.updatedAt).toBe(T0 + 5_000);
        expect(await repository.getVenue(venue.id)).toEqual(updated);
      });

      it('leaves untouched fields alone when patching', async () => {
        const venue = await newVenue('Home Game', true);
        const updated = await repository.updateVenue(venue.id, { name: 'Tuesday Game' });
        expect(updated.isHomeGame).toBe(true);
      });

      it('throws NotFoundError updating a missing venue', async () => {
        await expect(repository.updateVenue('nope', { name: 'x' })).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it('deletes an unused venue but refuses one with sessions', async () => {
        const unused = await newVenue('Unused');
        await repository.deleteVenue(unused.id);
        expect(await repository.getVenue(unused.id)).toBeNull();

        const used = await newVenue('Used');
        await newSession({ venueId: used.id });
        await expect(repository.deleteVenue(used.id)).rejects.toBeInstanceOf(ConstraintError);
        expect(await repository.getVenue(used.id)).not.toBeNull();
      });
    });

    describe('sessions', () => {
      it('creates a session that starts live', async () => {
        const session = await newSession();
        expect(session.cashOut).toBeNull();
        expect(session.endedAt).toBeNull();
        expect(session.notes).toBeNull();
        expect(session.stakes).toEqual(stakes);
      });

      it('preserves an optional ante on the stakes', async () => {
        const session = await newSession({
          stakes: { smallBlind: 200, bigBlind: 500, ante: 500 },
        });
        const loaded = await repository.getSession(session.id);
        expect(loaded?.stakes?.ante).toBe(500);
      });

      it('omits ante entirely when the game has none', async () => {
        const session = await newSession();
        const loaded = await repository.getSession(session.id);
        expect(loaded?.stakes?.ante).toBeUndefined();
      });

      it('rejects a session for a venue that does not exist', async () => {
        await expect(newSession({ venueId: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
      });

      it('resolves the venue and rebuys on read', async () => {
        const venue = await newVenue('Aria');
        const session = await newSession({ venueId: venue.id });
        await repository.addRebuy({ sessionId: session.id, amount: 20_000, at: T0 + HOUR });

        const loaded = await repository.getSession(session.id);
        expect(loaded?.venue?.name).toBe('Aria');
        expect(loaded?.rebuys).toHaveLength(1);
        expect(loaded?.rebuys[0].amount).toBe(20_000);
      });

      it('lists sessions newest first', async () => {
        const venue = await newVenue();
        const oldest = await newSession({ venueId: venue.id, startedAt: T0 });
        const newest = await newSession({ venueId: venue.id, startedAt: T0 + 2 * HOUR });
        const middle = await newSession({ venueId: venue.id, startedAt: T0 + HOUR });

        const sessions = await repository.listSessions();
        expect(sessions.map((session) => session.id)).toEqual([newest.id, middle.id, oldest.id]);
      });

      it('returns an empty list when nothing is stored', async () => {
        expect(await repository.listSessions()).toEqual([]);
      });

      it('ends a session, recording cash-out and end time together', async () => {
        const session = await newSession();
        const ended = await repository.endSession(session.id, 52_500, T0 + 4 * HOUR);
        expect(ended.cashOut).toBe(52_500);
        expect(ended.endedAt).toBe(T0 + 4 * HOUR);

        const loaded = await repository.getSession(session.id);
        expect(loaded?.cashOut).toBe(52_500);
        expect(loaded?.endedAt).toBe(T0 + 4 * HOUR);
      });

      it('allows a cash-out of exactly zero', async () => {
        const session = await newSession();
        const ended = await repository.endSession(session.id, 0, T0 + HOUR);
        expect(ended.cashOut).toBe(0);
        const loaded = await repository.getSession(session.id);
        expect(loaded?.cashOut).toBe(0);
      });

      it('refuses an end time before the start time', async () => {
        const session = await newSession({ startedAt: T0 });
        await expect(repository.endSession(session.id, 100, T0 - 1)).rejects.toBeInstanceOf(
          ConstraintError,
        );
      });

      it('throws NotFoundError ending a missing session', async () => {
        await expect(repository.endSession('nope', 0, T0)).rejects.toBeInstanceOf(NotFoundError);
      });

      it('finds the active session and none once it has ended', async () => {
        const venue = await newVenue();
        await newSession({ venueId: venue.id, startedAt: T0, cashOut: 100, endedAt: T0 + HOUR });
        expect(await repository.getActiveSession()).toBeNull();

        const live = await newSession({ venueId: venue.id, startedAt: T0 + 2 * HOUR });
        expect((await repository.getActiveSession())?.id).toBe(live.id);

        await repository.endSession(live.id, 40_000, T0 + 5 * HOUR);
        expect(await repository.getActiveSession()).toBeNull();
      });

      it('returns the most recent session when several are live', async () => {
        const venue = await newVenue();
        await newSession({ venueId: venue.id, startedAt: T0 });
        const newer = await newSession({ venueId: venue.id, startedAt: T0 + HOUR });
        expect((await repository.getActiveSession())?.id).toBe(newer.id);
      });

      it('clears a nullable field when a patch passes null', async () => {
        const session = await newSession({ notes: 'first note' });
        const updated = await repository.updateSession(session.id, { notes: null });
        expect(updated.notes).toBeNull();
      });

      it('leaves a field alone when a patch omits it', async () => {
        const session = await newSession({ notes: 'keep me' });
        const updated = await repository.updateSession(session.id, { buyIn: 40_000 });
        expect(updated.notes).toBe('keep me');
        expect(updated.buyIn).toBe(40_000);
      });

      it('deletes a session and cascades to its children', async () => {
        const session = await newSession();
        await repository.addRebuy({ sessionId: session.id, amount: 10_000, at: T0 + HOUR });
        await repository.createHand({ sessionId: session.id, at: T0 + HOUR, holeCards: 'AsKd' });
        await repository.createMoodEntry({
          sessionId: session.id,
          phase: 'start',
          score: 2,
          at: T0,
        });

        await repository.deleteSession(session.id);

        expect(await repository.getSession(session.id)).toBeNull();
        expect(await repository.listRebuys(session.id)).toEqual([]);
        expect(await repository.listHands(session.id)).toEqual([]);
        expect(await repository.listMoodEntries(session.id)).toEqual([]);
      });

      it('leaves other sessions untouched when one is deleted', async () => {
        const venue = await newVenue();
        const keep = await newSession({ venueId: venue.id });
        const drop = await newSession({ venueId: venue.id });
        await repository.createHand({ sessionId: keep.id, at: T0, holeCards: 'QhQd' });
        await repository.deleteSession(drop.id);

        expect(await repository.getSession(keep.id)).not.toBeNull();
        expect(await repository.listHands(keep.id)).toHaveLength(1);
      });
    });

    describe('tournaments', () => {
      const newTournament = async (overrides: Record<string, unknown> = {}) => {
        const venueId = (await newVenue('Aria')).id;
        return repository.createSession({
          venueId,
          format: 'tournament',
          gameType: 'NLHE',
          buyIn: 10_000,
          fee: 1_000,
          entrants: 210,
          finishPosition: 12,
          startedAt: T0,
          ...overrides,
        });
      };

      it('round-trips every tournament field through storage', async () => {
        const created = await newTournament();
        expect(await repository.getSession(created.id)).toMatchObject({
          format: 'tournament',
          buyIn: 10_000,
          fee: 1_000,
          entrants: 210,
          finishPosition: 12,
        });
      });

      it('gives a tournament no stakes, even when the caller sends some', async () => {
        const created = await newTournament({ stakes });
        expect(created.stakes).toBeNull();
        expect((await repository.getSession(created.id))?.stakes).toBeNull();
      });

      it('gives a cash game no fee, field or finish, even when the caller sends them', async () => {
        const venueId = (await newVenue()).id;
        const created = await repository.createSession({
          venueId,
          gameType: 'NLHE',
          stakes,
          buyIn: 30_000,
          fee: 1_000,
          entrants: 210,
          finishPosition: 12,
          startedAt: T0,
        });
        expect(created).toMatchObject({ fee: null, entrants: null, finishPosition: null });
      });

      it('defaults a session with no format to a cash game', async () => {
        expect((await newSession()).format).toBe('cash');
      });

      it('keeps a cash session with no stakes null rather than zeroed', async () => {
        const venueId = (await newVenue()).id;
        const created = await repository.createSession({
          venueId,
          gameType: 'NLHE',
          buyIn: 30_000,
          startedAt: T0,
        });
        expect(created.stakes).toBeNull();
        expect((await repository.getSession(created.id))?.stakes).toBeNull();
      });

      it('stores the currency on the session rather than inside the stakes', async () => {
        const created = await newSession({ currency: 'GBP' });
        const loaded = await repository.getSession(created.id);
        expect(loaded?.currency).toBe('GBP');
        expect(loaded?.stakes).not.toHaveProperty('currency');
      });

      it('defaults the currency when the caller names none', async () => {
        expect((await newSession()).currency).toBe('USD');
      });

      it('patches a finish onto a tournament after it ends', async () => {
        const created = await newTournament({ entrants: null, finishPosition: null });
        await repository.endSession(created.id, 25_000, T0 + HOUR);
        const updated = await repository.updateSession(created.id, {
          entrants: 188,
          finishPosition: 4,
        });
        expect(updated).toMatchObject({ entrants: 188, finishPosition: 4, cashOut: 25_000 });
      });

      it('filters sessions by format', async () => {
        const venueId = (await newVenue('Wynn')).id;
        await newSession({ venueId });
        await newTournament({ venueId });
        expect(await repository.listSessions({ format: 'tournament' })).toHaveLength(1);
        expect(await repository.listSessions({ format: 'cash' })).toHaveLength(1);
        expect(await repository.listSessions()).toHaveLength(2);
      });
    });

    describe('imported sessions', () => {
      const imported = (importKey: string, overrides: Record<string, unknown> = {}) => ({
        gameType: 'NLHE' as const,
        stakes,
        buyIn: 5_000,
        cashOut: 8_825,
        startedAt: T0,
        endedAt: T0 + HOUR,
        importKey,
        ...overrides,
      });

      it('leaves importKey null on a session logged in the app', async () => {
        const session = await newSession();
        expect(session.importKey).toBeNull();
        expect(await repository.listImportKeys()).toEqual([]);
      });

      it('round-trips an import key through storage', async () => {
        const venue = await newVenue('PokerStars');
        const created = await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        expect(created.importKey).toBe('csv|1');
        expect((await repository.getSession(created.id))?.importKey).toBe('csv|1');
      });

      it('writes a batch in one call and returns it in order', async () => {
        const venue = await newVenue('PokerStars');
        const created = await repository.createSessions([
          { venueId: venue.id, ...imported('csv|1') },
          { venueId: venue.id, ...imported('csv|2', { startedAt: T0 + HOUR }) },
        ]);
        expect(created.map((session) => session.importKey)).toEqual(['csv|1', 'csv|2']);
        expect(await repository.listSessions()).toHaveLength(2);
      });

      it('accepts an empty batch without touching storage', async () => {
        expect(await repository.createSessions([])).toEqual([]);
        expect(await repository.listSessions()).toEqual([]);
      });

      it('lists every import key it holds and nothing else', async () => {
        const venue = await newVenue('PokerStars');
        await repository.createSessions([
          { venueId: venue.id, ...imported('csv|1') },
          { venueId: venue.id, ...imported('csv|2', { startedAt: T0 + HOUR }) },
        ]);
        await newSession({ venueId: venue.id });
        expect((await repository.listImportKeys()).sort()).toEqual(['csv|1', 'csv|2']);
      });

      it('refuses a session whose import key is already stored', async () => {
        const venue = await newVenue('PokerStars');
        await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        await expect(
          repository.createSession({ venueId: venue.id, ...imported('csv|1') }),
        ).rejects.toBeInstanceOf(ConstraintError);
        expect(await repository.listSessions()).toHaveLength(1);
      });

      it('refuses a batch that repeats a key within itself', async () => {
        const venue = await newVenue('PokerStars');
        await expect(
          repository.createSessions([
            { venueId: venue.id, ...imported('csv|1') },
            { venueId: venue.id, ...imported('csv|1') },
          ]),
        ).rejects.toBeInstanceOf(ConstraintError);
        expect(await repository.listSessions()).toEqual([]);
      });

      it('writes nothing at all when one row of a batch is rejected', async () => {
        const venue = await newVenue('PokerStars');
        await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        await expect(
          repository.createSessions([
            { venueId: venue.id, ...imported('csv|2', { startedAt: T0 + HOUR }) },
            { venueId: venue.id, ...imported('csv|1') },
          ]),
        ).rejects.toBeInstanceOf(ConstraintError);
        expect(await repository.listSessions()).toHaveLength(1);
      });

      it('rejects a batch naming a venue that does not exist', async () => {
        await expect(
          repository.createSessions([{ venueId: 'nope', ...imported('csv|1') }]),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(await repository.listSessions()).toEqual([]);
      });

      it('keeps many hand-logged sessions alongside imported ones', async () => {
        // The unique index has to tolerate any number of sessions with no key --
        // on IndexedDB that only works because the property is absent, not null.
        const venue = await newVenue('Aria');
        await newSession({ venueId: venue.id });
        await newSession({ venueId: venue.id });
        await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        expect(await repository.listSessions()).toHaveLength(3);
        expect(await repository.listImportKeys()).toEqual(['csv|1']);
      });

      it('does not carry an import key onto a session it did not come with', async () => {
        const venue = await newVenue('PokerStars');
        const created = await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        const updated = await repository.updateSession(created.id, { notes: 'edited' });
        expect(updated.importKey).toBe('csv|1');
        expect((await repository.getSession(created.id))?.importKey).toBe('csv|1');
      });

      it('frees an import key when the session is deleted, so the row can be imported again', async () => {
        const venue = await newVenue('PokerStars');
        const created = await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        await repository.deleteSession(created.id);
        expect(await repository.listImportKeys()).toEqual([]);
        await expect(
          repository.createSession({ venueId: venue.id, ...imported('csv|1') }),
        ).resolves.toBeDefined();
      });

      it('clears import keys with everything else', async () => {
        const venue = await newVenue('PokerStars');
        await repository.createSession({ venueId: venue.id, ...imported('csv|1') });
        await repository.clearAll();
        expect(await repository.listImportKeys()).toEqual([]);
      });
    });

    describe('session filters', () => {
      const seedFiltered = async () => {
        const home = await newVenue('Home Game', true);
        const room = await newVenue('Card Room');
        const a = await newSession({
          venueId: home.id,
          gameType: 'PLO',
          startedAt: T0,
          cashOut: 40_000,
          endedAt: T0 + 3 * HOUR,
        });
        const b = await newSession({ venueId: room.id, gameType: 'NLHE', startedAt: T0 + 24 * HOUR });
        const c = await newSession({
          venueId: room.id,
          gameType: 'NLHE',
          startedAt: T0 + 48 * HOUR,
          cashOut: 10_000,
          endedAt: T0 + 52 * HOUR,
        });
        return { home, room, a, b, c };
      };

      it('filters by venue', async () => {
        const { room, b, c } = await seedFiltered();
        const sessions = await repository.listSessions({ venueId: room.id });
        expect(sessions.map((session) => session.id).sort()).toEqual([b.id, c.id].sort());
      });

      it('filters by game type', async () => {
        const { a } = await seedFiltered();
        const sessions = await repository.listSessions({ gameType: 'PLO' });
        expect(sessions.map((session) => session.id)).toEqual([a.id]);
      });

      it('filters by status', async () => {
        const { b } = await seedFiltered();
        expect((await repository.listSessions({ status: 'active' })).map((s) => s.id)).toEqual([b.id]);
        expect(await repository.listSessions({ status: 'completed' })).toHaveLength(2);
        expect(await repository.listSessions({ status: 'all' })).toHaveLength(3);
      });

      it('filters by date range, inclusive of from and exclusive of to', async () => {
        const { a, b } = await seedFiltered();
        const sessions = await repository.listSessions({ from: T0, to: T0 + 48 * HOUR });
        expect(sessions.map((session) => session.id).sort()).toEqual([a.id, b.id].sort());
      });

      it('combines filters', async () => {
        const { room, c } = await seedFiltered();
        const sessions = await repository.listSessions({
          venueId: room.id,
          status: 'completed',
          gameType: 'NLHE',
        });
        expect(sessions.map((session) => session.id)).toEqual([c.id]);
      });

      it('applies a limit after ordering', async () => {
        const { c } = await seedFiltered();
        const sessions = await repository.listSessions({ limit: 1 });
        expect(sessions.map((session) => session.id)).toEqual([c.id]);
      });
    });

    describe('rebuys', () => {
      it('records rebuys in chronological order', async () => {
        const session = await newSession();
        await repository.addRebuy({ sessionId: session.id, amount: 20_000, at: T0 + 2 * HOUR });
        await repository.addRebuy({ sessionId: session.id, amount: 10_000, at: T0 + HOUR });

        const rebuys = await repository.listRebuys(session.id);
        expect(rebuys.map((rebuy) => rebuy.amount)).toEqual([10_000, 20_000]);
      });

      it('rejects a rebuy for a session that does not exist', async () => {
        await expect(
          repository.addRebuy({ sessionId: 'nope', amount: 100, at: T0 }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it('deletes a single rebuy', async () => {
        const session = await newSession();
        const rebuy = await repository.addRebuy({ sessionId: session.id, amount: 20_000, at: T0 });
        await repository.deleteRebuy(rebuy.id);
        expect(await repository.listRebuys(session.id)).toEqual([]);
      });

      it('scopes rebuys to their own session', async () => {
        const venue = await newVenue();
        const one = await newSession({ venueId: venue.id });
        const two = await newSession({ venueId: venue.id });
        await repository.addRebuy({ sessionId: one.id, amount: 20_000, at: T0 });
        expect(await repository.listRebuys(two.id)).toEqual([]);
      });
    });

    describe('hands', () => {
      it('stores a hand with notation, position and tags', async () => {
        const session = await newSession();
        const hand = await repository.createHand({
          sessionId: session.id,
          at: T0 + HOUR,
          holeCards: 'AsKd',
          position: 'BTN',
          note: 'Ran into aces',
          tags: ['cooler', 'misplayed'],
          amount: -25_000,
        });

        expect(await repository.getHand(hand.id)).toEqual(hand);
        expect(hand.tags).toEqual(['cooler', 'misplayed']);
      });

      it('defaults optional fields so a one-tap hand is valid', async () => {
        const session = await newSession();
        const hand = await repository.createHand({ sessionId: session.id, at: T0 });
        expect(hand).toMatchObject({
          holeCards: null,
          position: null,
          note: null,
          tags: [],
          amount: null,
        });
      });

      it('lists hands newest first', async () => {
        const session = await newSession();
        const first = await repository.createHand({ sessionId: session.id, at: T0 });
        const third = await repository.createHand({ sessionId: session.id, at: T0 + 2 * HOUR });
        const second = await repository.createHand({ sessionId: session.id, at: T0 + HOUR });

        const hands = await repository.listHands(session.id);
        expect(hands.map((hand) => hand.id)).toEqual([third.id, second.id, first.id]);
      });

      it('lists hands across every session when no session is given', async () => {
        const venue = await newVenue();
        const one = await newSession({ venueId: venue.id });
        const two = await newSession({ venueId: venue.id });
        await repository.createHand({ sessionId: one.id, at: T0 });
        await repository.createHand({ sessionId: two.id, at: T0 + HOUR });
        expect(await repository.listHands()).toHaveLength(2);
      });

      it('updates a hand and replaces its tags wholesale', async () => {
        const session = await newSession();
        const hand = await repository.createHand({
          sessionId: session.id,
          at: T0,
          tags: ['bad_beat'],
        });
        context.tick(1_000);
        const updated = await repository.updateHand(hand.id, { tags: ['bluff'], note: 'Re-read it' });
        expect(updated.tags).toEqual(['bluff']);
        expect(updated.note).toBe('Re-read it');
        expect(updated.updatedAt).toBe(T0 + 1_000);
        expect(await repository.getHand(hand.id)).toEqual(updated);
      });

      it('clears a hand note when patched with null', async () => {
        const session = await newSession();
        const hand = await repository.createHand({ sessionId: session.id, at: T0, note: 'x' });
        const updated = await repository.updateHand(hand.id, { note: null });
        expect(updated.note).toBeNull();
      });

      it('rejects a hand for a session that does not exist', async () => {
        await expect(
          repository.createHand({ sessionId: 'nope', at: T0 }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it('throws NotFoundError updating a missing hand', async () => {
        await expect(repository.updateHand('nope', { note: 'x' })).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it('deletes a hand', async () => {
        const session = await newSession();
        const hand = await repository.createHand({ sessionId: session.id, at: T0 });
        await repository.deleteHand(hand.id);
        expect(await repository.getHand(hand.id)).toBeNull();
      });

      it('does not alias the caller’s tag array', async () => {
        const session = await newSession();
        const tags: ('bluff' | 'cooler')[] = ['bluff'];
        const hand = await repository.createHand({ sessionId: session.id, at: T0, tags });
        tags.push('cooler');
        expect((await repository.getHand(hand.id))?.tags).toEqual(['bluff']);
      });
    });

    describe('mood entries', () => {
      it('stores mood entries per phase', async () => {
        const session = await newSession();
        await repository.createMoodEntry({ sessionId: session.id, phase: 'start', score: 2, at: T0 });
        await repository.createMoodEntry({
          sessionId: session.id,
          phase: 'end',
          score: 4,
          at: T0 + 4 * HOUR,
        });

        const entries = await repository.listMoodEntries(session.id);
        expect(entries.map((entry) => [entry.phase, entry.score])).toEqual([
          ['end', 4],
          ['start', 2],
        ]);
      });

      it('rejects a mood entry for a session that does not exist', async () => {
        await expect(
          repository.createMoodEntry({ sessionId: 'nope', phase: 'mid', score: 3, at: T0 }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it('deletes a mood entry', async () => {
        const session = await newSession();
        const entry = await repository.createMoodEntry({
          sessionId: session.id,
          phase: 'mid',
          score: 5,
          at: T0,
        });
        await repository.deleteMoodEntry(entry.id);
        expect(await repository.listMoodEntries(session.id)).toEqual([]);
      });

      it('lists mood entries across sessions when unscoped', async () => {
        const venue = await newVenue();
        const one = await newSession({ venueId: venue.id });
        const two = await newSession({ venueId: venue.id });
        await repository.createMoodEntry({ sessionId: one.id, phase: 'start', score: 1, at: T0 });
        await repository.createMoodEntry({ sessionId: two.id, phase: 'start', score: 3, at: T0 });
        expect(await repository.listMoodEntries()).toHaveLength(2);
      });
    });

    describe('tombstones', () => {
      /** Every changed record of one kind, by id, tombstones included. */
      const changed = async (since = 0) => await repository.listChangedSince(since);

      it('keeps a deleted session readable to the sync layer and to nobody else', async () => {
        const session = await newSession();
        context.tick(HOUR);
        await repository.deleteSession(session.id);

        expect(await repository.getSession(session.id)).toBeNull();
        expect(await repository.listSessions()).toEqual([]);

        const { sessions } = await changed();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].record.id).toBe(session.id);
        expect(sessions[0].deletedAt).toBe(T0 + HOUR);
      });

      it('stamps the children with the same moment as the parent', async () => {
        const session = await newSession();
        await repository.addRebuy({ sessionId: session.id, amount: 100, at: T0 });
        await repository.createHand({ sessionId: session.id, at: T0 });
        await repository.createMoodEntry({ sessionId: session.id, phase: 'start', score: 3, at: T0 });

        context.tick(HOUR);
        await repository.deleteSession(session.id);

        // Not merely "all deleted": a child a millisecond fresher than its
        // parent is a hand that a later merge can revive on its own.
        const { rebuys, hands, moodEntries } = await changed();
        for (const change of [...rebuys, ...hands, ...moodEntries]) {
          expect(change.deletedAt).toBe(T0 + HOUR);
        }
        expect(await repository.listHands()).toEqual([]);
        expect(await repository.listMoodEntries()).toEqual([]);
        expect(await repository.listRebuys(session.id)).toEqual([]);
      });

      it('frees the import key, so a deleted import can be imported again', async () => {
        const venue = await newVenue();
        const session = await newSession({ venueId: venue.id, importKey: 'stars:2026-03-01:1' });
        expect(await repository.listImportKeys()).toEqual(['stars:2026-03-01:1']);

        context.tick(HOUR);
        await repository.deleteSession(session.id);
        expect(await repository.listImportKeys()).toEqual([]);

        // The whole point: the unique index has to let the row back in.
        const again = await newSession({ venueId: venue.id, importKey: 'stars:2026-03-01:1' });
        expect(again.id).not.toBe(session.id);
      });

      it('tombstones a hand, a rebuy and a mood entry one at a time', async () => {
        const session = await newSession();
        const rebuy = await repository.addRebuy({ sessionId: session.id, amount: 100, at: T0 });
        const hand = await repository.createHand({ sessionId: session.id, at: T0 });
        const mood = await repository.createMoodEntry({
          sessionId: session.id,
          phase: 'start',
          score: 3,
          at: T0,
        });

        context.tick(HOUR);
        await repository.deleteRebuy(rebuy.id);
        await repository.deleteHand(hand.id);
        await repository.deleteMoodEntry(mood.id);

        expect(await repository.getHand(hand.id)).toBeNull();
        expect(await repository.listRebuys(session.id)).toEqual([]);
        expect(await repository.listMoodEntries()).toEqual([]);

        const { rebuys, hands, moodEntries } = await changed();
        expect(rebuys[0].deletedAt).toBe(T0 + HOUR);
        expect(hands[0].deletedAt).toBe(T0 + HOUR);
        expect(moodEntries[0].deletedAt).toBe(T0 + HOUR);
        // The session itself was not touched by any of the three.
        const { sessions } = await changed();
        expect(sessions[0].deletedAt).toBeNull();
      });

      it('does not let a tombstoned session hold its venue hostage', async () => {
        const venue = await newVenue();
        const session = await newSession({ venueId: venue.id });
        await expect(repository.deleteVenue(venue.id)).rejects.toThrow(ConstraintError);

        await repository.deleteSession(session.id);
        await expect(repository.deleteVenue(venue.id)).resolves.toBeUndefined();
        expect(await repository.listVenues()).toEqual([]);

        // Tombstoned, not removed: the deleted session's venueId still points
        // at the row, and a foreign key that stops resolving is a broken read.
        const { venues } = await changed();
        expect(venues).toHaveLength(1);
        expect(venues[0].deletedAt).not.toBeNull();
      });

      it('leaves a tombstoned session out of its venue count', async () => {
        const venue = await newVenue();
        const kept = await newSession({ venueId: venue.id });
        const dropped = await newSession({ venueId: venue.id });
        expect((await repository.getVenue(venue.id))?.sessionCount).toBe(2);

        await repository.deleteSession(dropped.id);
        expect((await repository.getVenue(venue.id))?.sessionCount).toBe(1);
        expect((await repository.listVenues())[0].sessionCount).toBe(1);
        expect(kept.id).not.toBe(dropped.id);
      });

      it('refuses to add anything to a session that is gone', async () => {
        const session = await newSession();
        await repository.deleteSession(session.id);

        await expect(repository.addRebuy({ sessionId: session.id, amount: 1, at: T0 })).rejects.toThrow(
          NotFoundError,
        );
        await expect(repository.createHand({ sessionId: session.id, at: T0 })).rejects.toThrow(
          NotFoundError,
        );
        await expect(repository.updateSession(session.id, { notes: 'back?' })).rejects.toThrow(
          NotFoundError,
        );
      });

      it('does not offer a tombstoned session as the active one', async () => {
        const session = await newSession();
        expect((await repository.getActiveSession())?.id).toBe(session.id);
        await repository.deleteSession(session.id);
        expect(await repository.getActiveSession()).toBeNull();
      });

      it('reports changes after a cursor and nothing before it', async () => {
        const venue = await newVenue();
        context.tick(HOUR);
        const session = await newSession({ venueId: venue.id });

        // The venue is older than the cursor and the session is not.
        const { venues, sessions } = await repository.listChangedSince(T0 + HOUR - 1);
        expect(venues).toEqual([]);
        expect(sessions.map((change) => change.record.id)).toEqual([session.id]);

        // And a cursor at the newest stamp reports nothing at all, which is
        // what makes a second sync with no changes cost one empty answer.
        expect(await repository.listChangedSince(T0 + HOUR)).toEqual({
          venues: [],
          sessions: [],
          rebuys: [],
          hands: [],
          moodEntries: [],
        });
      });

      it('hands the sync layer records the domain types would not carry', async () => {
        const session = await newSession();
        const { sessions } = await changed();
        // The record is the same shape the app reads, with the storage concern
        // beside it rather than on it.
        expect(sessions[0].record).toEqual(session);
        expect(Object.hasOwn(sessions[0].record, 'deletedAt')).toBe(false);
      });
    });

    describe('applying what the sync layer hands back', () => {
      const change = <T>(record: T, deletedAt: number | null = null) => ({ record, deletedAt });
      const set = (parts: Partial<Record<string, unknown[]>>) => ({
        venues: [], sessions: [], rebuys: [], hands: [], moodEntries: [], ...parts,
      }) as Parameters<Repository['applyChanges']>[0];

      /** A record as another device would have written it: already stamped. */
      const foreignVenue = (id: string, updatedAt: number) => ({
        id, name: id, isHomeGame: false, sessionCount: 0, createdAt: T0, updatedAt,
      });

      it('writes a record this device has never seen', async () => {
        await repository.applyChanges(set({ venues: [change(foreignVenue('v-remote', T0))] }));
        const venues = await repository.listVenues();
        expect(venues.map((venue) => venue.id)).toEqual(['v-remote']);
      });

      it('does not re-stamp it, or every incoming record would push straight back', async () => {
        context.tick(HOUR);
        await repository.applyChanges(set({ venues: [change(foreignVenue('v-remote', T0))] }));
        const { venues } = await repository.listChangedSince(0);
        expect(venues[0].record.updatedAt).toBe(T0);
      });

      it('overwrites a record this device already had', async () => {
        const venue = await newVenue('Before');
        await repository.applyChanges(set({
          venues: [change({ ...venue, name: 'After', updatedAt: T0 + HOUR })],
        }));
        expect((await repository.getVenue(venue.id))?.name).toBe('After');
      });

      it('applies a tombstone, so a delete on one device lands on this one', async () => {
        const venue = await newVenue();
        const session = await newSession({ venueId: venue.id });
        await repository.applyChanges(set({
          sessions: [change({ ...session, updatedAt: T0 + HOUR }, T0 + HOUR)],
        }));
        expect(await repository.listSessions()).toEqual([]);
        expect(await repository.getSession(session.id)).toBeNull();
      });

      it('brings a record back when the server says it is live again', async () => {
        // The venue-tombstone rule can do exactly this: a delete that lost.
        const venue = await newVenue();
        await repository.deleteVenue(venue.id);
        expect(await repository.listVenues()).toEqual([]);

        await repository.applyChanges(set({
          venues: [change({ ...venue, updatedAt: T0 + HOUR })],
        }));
        expect((await repository.listVenues()).map((v) => v.id)).toEqual([venue.id]);
      });

      it('skips a session whose venue has not arrived, rather than failing the sync', async () => {
        // Foreign keys are on. One inconsistent row should cost that row.
        const orphan = {
          id: 'orphan', venueId: 'never-seen', format: 'cash', gameType: 'NLHE',
          stakes: { smallBlind: 100, bigBlind: 200 }, currency: 'USD', buyIn: 1,
          fee: null, cashOut: null, entrants: null, finishPosition: null,
          startedAt: T0, endedAt: null, notes: null, importKey: null,
          createdAt: T0, updatedAt: T0,
        };
        await expect(repository.applyChanges(set({ sessions: [change(orphan)] })))
          .resolves.toBeUndefined();
        expect(await repository.listSessions()).toEqual([]);
      });

      it('takes a venue and the session on it in one call', async () => {
        // Parents first, within the one call, or the session would be skipped.
        await repository.applyChanges(set({
          venues: [change(foreignVenue('v-remote', T0))],
          sessions: [change({
            id: 's-remote', venueId: 'v-remote', format: 'cash', gameType: 'NLHE',
            stakes: { smallBlind: 100, bigBlind: 200 }, currency: 'USD', buyIn: 30_000,
            fee: null, cashOut: null, entrants: null, finishPosition: null,
            startedAt: T0, endedAt: null, notes: null, importKey: null,
            createdAt: T0, updatedAt: T0,
          })],
        }));
        const sessions = await repository.listSessions();
        expect(sessions.map((session) => session.id)).toEqual(['s-remote']);
        expect(sessions[0].venue?.id).toBe('v-remote');
      });

      it('takes hands onto a session that arrived in the same call', async () => {
        await repository.applyChanges(set({
          venues: [change(foreignVenue('v-remote', T0))],
          sessions: [change({
            id: 's-remote', venueId: 'v-remote', format: 'cash', gameType: 'NLHE',
            stakes: { smallBlind: 100, bigBlind: 200 }, currency: 'USD', buyIn: 30_000,
            fee: null, cashOut: null, entrants: null, finishPosition: null,
            startedAt: T0, endedAt: null, notes: null, importKey: null,
            createdAt: T0, updatedAt: T0,
          })],
          hands: [change({
            id: 'h-remote', sessionId: 's-remote', holeCards: 'AsKd', position: null,
            note: null, tags: [], amount: null, at: T0, createdAt: T0, updatedAt: T0,
          })],
        }));
        const hands = await repository.listHands();
        expect(hands.map((hand) => hand.id)).toEqual(['h-remote']);
        expect(hands[0].holeCards).toBe('AsKd');
      });

      it('is safe to apply the same change twice', async () => {
        const changes = set({ venues: [change(foreignVenue('v-remote', T0))] });
        await repository.applyChanges(changes);
        await repository.applyChanges(changes);
        expect((await repository.listVenues()).length).toBe(1);
      });

      it('does nothing at all when handed nothing', async () => {
        await expect(repository.applyChanges(set({}))).resolves.toBeUndefined();
        expect(await repository.listVenues()).toEqual([]);
      });
    });

    describe('collecting tombstones', () => {
      const DAY = 24 * HOUR;

      it('removes a tombstone older than the line, and its children with it', async () => {
        const session = await newSession();
        await repository.addRebuy({ sessionId: session.id, amount: 100, at: T0 });
        await repository.createHand({ sessionId: session.id, at: T0 });
        await repository.deleteSession(session.id);

        const removed = await repository.collectTombstones(T0 + DAY);
        expect(removed).toBe(3);

        // Gone for real, not merely invisible: the sync layer's own read is
        // the only way to tell the two apart.
        const { sessions, hands, rebuys } = await repository.listChangedSince(0);
        expect(sessions).toEqual([]);
        expect(hands).toEqual([]);
        expect(rebuys).toEqual([]);
      });

      it('leaves a tombstone newer than the line exactly where it is', async () => {
        const session = await newSession();
        context.tick(HOUR);
        await repository.deleteSession(session.id);

        expect(await repository.collectTombstones(T0)).toBe(0);
        const { sessions } = await repository.listChangedSince(0);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].deletedAt).toBe(T0 + HOUR);
      });

      it('never touches a live record, however old', async () => {
        const session = await newSession();
        expect(await repository.collectTombstones(T0 + 10 * 365 * DAY)).toBe(0);
        expect((await repository.getSession(session.id))?.id).toBe(session.id);
      });

      it('keeps a venue while anything still points at it', async () => {
        // Foreign keys are on. A session whose venue was collected is a broken
        // read, and a tombstoned session still names its venue.
        const venue = await newVenue();
        const session = await newSession({ venueId: venue.id });
        await repository.deleteSession(session.id);
        await repository.deleteVenue(venue.id);

        // The session goes; the venue waits for it to be gone.
        expect(await repository.collectTombstones(T0 + DAY)).toBe(2);
        expect((await repository.listChangedSince(0)).venues).toEqual([]);
      });

      it('and keeps one a live session points at, whatever the line says', async () => {
        // The shape a merge produces: one device deleted the venue, another
        // logged a session on it, and the session won. The tombstone is still
        // sitting here locally and must not be collected out from under it.
        const venue = await newVenue();
        const session = await newSession({ venueId: venue.id });
        await repository.applyChanges({
          venues: [{ record: { ...venue, updatedAt: T0 }, deletedAt: T0 }],
          sessions: [], rebuys: [], hands: [], moodEntries: [],
        });

        expect(await repository.collectTombstones(T0 + DAY)).toBe(0);
        // And the session that saved it is still readable, venue and all.
        expect((await repository.getSession(session.id))?.id).toBe(session.id);
      });

      it('is safe to run when there is nothing to collect', async () => {
        expect(await repository.collectTombstones(T0 + DAY)).toBe(0);
        await newSession();
        expect(await repository.collectTombstones(T0 + DAY)).toBe(0);
      });

      it('is safe to run twice', async () => {
        const session = await newSession();
        await repository.deleteSession(session.id);
        expect(await repository.collectTombstones(T0 + DAY)).toBe(1);
        expect(await repository.collectTombstones(T0 + DAY)).toBe(0);
      });

      it('frees a collected session to be imported again', async () => {
        const venue = await newVenue();
        const session = await newSession({ venueId: venue.id, importKey: 'k' });
        await repository.deleteSession(session.id);
        await repository.collectTombstones(T0 + DAY);
        const again = await newSession({ venueId: venue.id, importKey: 'k' });
        expect(again.id).not.toBe(session.id);
      });
    });

    describe('maintenance', () => {
      it('clears every table', async () => {
        const session = await newSession();
        await repository.addRebuy({ sessionId: session.id, amount: 100, at: T0 });
        await repository.createHand({ sessionId: session.id, at: T0 });
        await repository.createMoodEntry({ sessionId: session.id, phase: 'start', score: 3, at: T0 });

        await repository.clearAll();

        expect(await repository.listVenues()).toEqual([]);
        expect(await repository.listSessions()).toEqual([]);
        expect(await repository.listHands()).toEqual([]);
        expect(await repository.listMoodEntries()).toEqual([]);
      });

      it('clears without leaving tombstones, because reset is not erasure', async () => {
        // A tombstone here would push the wipe to every other device, so a
        // player clearing a phone they are about to sell would take five years
        // of history off the laptop with it. See SYNC.md.
        const session = await newSession();
        await repository.createHand({ sessionId: session.id, at: T0 });
        await repository.clearAll();

        expect(await repository.listChangedSince(0)).toEqual({
          venues: [],
          sessions: [],
          rebuys: [],
          hands: [],
          moodEntries: [],
        });
      });

      it('is safe to init twice', async () => {
        await repository.init();
        await repository.init();
        expect(await repository.listVenues()).toEqual([]);
      });
    });
  });
};
