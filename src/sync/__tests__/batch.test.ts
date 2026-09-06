/**
 * Splitting a backlog that will not fit in one request.
 *
 * Two properties, and the second is the one that makes this hard. **The mark
 * has to be honest**: everything at or below it must really have gone, or the
 * records between it and the truth are never sent again. And **the server must
 * never be left holding a child without its parent**, because the receiving
 * device skips an orphan and moves its cursor past it, so that record is never
 * offered to it again. Both failures are silent and both are permanent.
 */

import { batchFor } from '../batch';
import { emptyChangeSet } from '../protocol';
import type { ChangeSet } from '../../data/repository';

const T0 = 1_700_000_000_000;

type Rec = Record<string, unknown>;

const changeSet = (parts: Partial<Record<keyof ChangeSet, unknown[]>>): ChangeSet =>
  ({ ...emptyChangeSet(), ...parts }) as ChangeSet;

/** Padded, so a handful of records is enough to run into any budget. */
const venue = (id: string, updatedAt: number, over: Rec = {}) => ({
  record: { id, name: id.padEnd(200, '.'), isHomeGame: false, sessionCount: 0,
            createdAt: T0, updatedAt, ...over },
  deletedAt: null,
});

const session = (id: string, venueId: string, updatedAt: number, over: Rec = {}) => ({
  record: { id, venueId, format: 'cash', gameType: 'NLHE',
            stakes: { smallBlind: 100, bigBlind: 200 }, currency: 'USD', buyIn: 30_000,
            fee: null, cashOut: null, entrants: null, finishPosition: null,
            startedAt: T0, endedAt: null, notes: id.padEnd(200, '.'), importKey: null,
            createdAt: T0, updatedAt, ...over },
  deletedAt: null,
});

const hand = (id: string, sessionId: string, updatedAt: number) => ({
  record: { id, sessionId, holeCards: 'AsKd', position: null, note: id.padEnd(200, '.'),
            tags: [], amount: null, at: T0, createdAt: T0, updatedAt },
  deletedAt: null,
});

/** Every id in a batch, so the shape of the cut can be asserted directly. */
const idsIn = (changes: ChangeSet): string[] =>
  [...changes.venues, ...changes.sessions, ...changes.rebuys, ...changes.hands,
   ...changes.moodEntries].map((change) => change.record.id).sort();

describe('a backlog that fits', () => {
  it('goes whole, and the mark is the newest record in it', () => {
    const pending = changeSet({
      venues: [venue('v1', T0)],
      sessions: [session('s1', 'v1', T0 + 1)],
    });
    const batch = batchFor(pending, 0);
    expect(batch.more).toBe(false);
    expect(batch.changes).toBe(pending);
    expect(batch.sent).toBe(T0 + 1);
  });

  it('and an empty one leaves the mark where it was', () => {
    const batch = batchFor(emptyChangeSet(), T0);
    expect(batch.more).toBe(false);
    expect(batch.sent).toBe(T0);
  });
});

describe('a backlog that does not fit', () => {
  it('sends a prefix and says there is more', () => {
    const pending = changeSet({
      venues: [venue('v1', T0), venue('v2', T0 + 1), venue('v3', T0 + 2)],
    });
    const batch = batchFor(pending, 0, 400);
    expect(batch.more).toBe(true);
    expect(idsIn(batch.changes)).toEqual(['v1']);
    expect(batch.sent).toBe(T0);
  });

  it('marks only what it sent, so the rest is read again next time', () => {
    const pending = changeSet({
      venues: [venue('v1', T0), venue('v2', T0 + 1), venue('v3', T0 + 2)],
    });
    const first = batchFor(pending, 0, 700);
    expect(idsIn(first.changes)).toEqual(['v1', 'v2']);
    expect(first.sent).toBe(T0 + 1);

    // What the device would read next: everything above the mark, less one
    // millisecond, exactly as `run` does it.
    const left = changeSet({
      venues: pending.venues.filter((change) => change.record.updatedAt > first.sent - 1),
    });
    const second = batchFor(left, first.sent, 700);
    expect(idsIn(second.changes)).toEqual(['v2', 'v3']);
    expect(second.more).toBe(false);
    expect(second.sent).toBe(T0 + 2);
  });

  it('sends one record that cannot fit at all, rather than nothing forever', () => {
    const pending = changeSet({ venues: [venue('v1', T0), venue('v2', T0 + 1)] });
    const batch = batchFor(pending, 0, 1);
    expect(idsIn(batch.changes)).toEqual(['v1']);
    expect(batch.more).toBe(true);
  });

  it('always moves the mark, even when the first record was already sent', () => {
    // The floor is read one millisecond back, so the record that set the mark
    // comes round again every time. Counting what has been taken rather than
    // where the mark is let that record fill the batch, satisfy the test and
    // break the loop at the same place forever: the mark never moved, the next
    // round rebuilt the identical batch, and the device pushed nothing again
    // for the rest of its life while reporting every round a success.
    const alreadySent = venue('v1', T0);
    const oversized = venue('v2', T0 + 1, { name: 'x'.repeat(4000) });
    const after = venue('v3', T0 + 2);
    const pending = changeSet({ venues: [alreadySent, oversized, after] });

    const batch = batchFor(pending, T0, 700);
    expect(batch.sent).toBeGreaterThan(T0);
    expect(idsIn(batch.changes)).toContain('v2');
  });

  it('and keeps moving it round after round until the backlog is gone', () => {
    // The property the one above buys: a loop that terminates.
    const venues = Array.from({ length: 8 }, (_, index) => venue(`v${index}`, T0 + index));
    let floor = 0;
    const seen = new Set();
    for (let round = 0; round < 12; round += 1) {
      const left = venues.filter((change) => change.record.updatedAt > floor - 1);
      if (left.length === 0) break;
      const batch = batchFor(changeSet({ venues: left }), floor, 700);
      for (const id of idsIn(batch.changes)) seen.add(id);
      expect(batch.sent).toBeGreaterThanOrEqual(floor);
      if (!batch.more) { floor = batch.sent; break; }
      expect(batch.sent).toBeGreaterThan(floor);
      floor = batch.sent;
    }
    expect(seen.size).toBe(8);
  });

  it('cuts the same way twice, so a retry is the same request', () => {
    const pending = changeSet({
      venues: [venue('v1', T0), venue('v2', T0), venue('v3', T0)],
    });
    expect(idsIn(batchFor(pending, 0, 700).changes))
      .toEqual(idsIn(batchFor(pending, 0, 700).changes));
  });
});

describe('never a child without its parent', () => {
  it('carries a session up with the hand that needs it', () => {
    // The session was edited after its hands, so it sorts above them. A plain
    // time prefix takes the hands and leaves the session behind, and every
    // other device then skips those hands for good.
    const pending = changeSet({
      venues: [venue('v1', T0)],
      sessions: [session('s1', 'v1', T0 + 500)],
      hands: [hand('h1', 's1', T0 + 1), hand('h2', 's1', T0 + 2)],
    });
    // Room for the venue and for one hand carrying its session up with it,
    // and not for the second hand.
    const batch = batchFor(pending, 0, 1400);
    expect(batch.more).toBe(true);
    expect(idsIn(batch.changes)).not.toContain('h2');
    expect(idsIn(batch.changes)).toContain('h1');
    expect(idsIn(batch.changes)).toContain('s1');
    expect(idsIn(batch.changes)).toContain('v1');
  });

  it('and the mark stays under the parent it reached forward for', () => {
    // The session went, but nothing between the hand and the session did, so a
    // mark at the session would step over all of it.
    const pending = changeSet({
      venues: [venue('v1', T0)],
      sessions: [session('s1', 'v1', T0 + 500)],
      hands: [hand('h1', 's1', T0 + 1), hand('h2', 's1', T0 + 2)],
    });
    const batch = batchFor(pending, 0, 1400);
    expect(batch.sent).toBeLessThan(T0 + 500);
  });

  it('walks the whole chain, not just one step', () => {
    const pending = changeSet({
      venues: [venue('v1', T0 + 900)],
      sessions: [session('s1', 'v1', T0 + 500)],
      hands: [hand('h1', 's1', T0 + 1)],
    });
    const batch = batchFor(pending, 0, 800);
    expect(idsIn(batch.changes)).toEqual(['h1', 's1', 'v1']);
  });

  it('does not reach for a parent that is already on the server', () => {
    // A parent under the mark has been sent. Not being in the backlog is what
    // says so, and nothing else needs to.
    const pending = changeSet({ hands: [hand('h1', 's1', T0 + 1)] });
    const batch = batchFor(pending, T0, 10_000);
    expect(idsIn(batch.changes)).toEqual(['h1']);
    expect(batch.more).toBe(false);
  });

  it('moves the mark over a parent it had already sent early', () => {
    // `s1` goes in the first chain, as `h1` needs it. Reaching it again in
    // time order must still advance the mark: it has gone.
    const pending = changeSet({
      venues: [venue('v1', T0)],
      sessions: [session('s1', 'v1', T0 + 2)],
      hands: [hand('h1', 's1', T0 + 1)],
    });
    const batch = batchFor(pending, 0, 10_000);
    expect(batch.more).toBe(false);
    expect(batch.sent).toBe(T0 + 2);
  });

  it('survives a record that names itself as its own parent', () => {
    const loop = session('s1', 'v1', T0);
    loop.record.venueId = 's1';
    const batch = batchFor(changeSet({ sessions: [loop] }), 0, 10_000);
    expect(idsIn(batch.changes)).toEqual(['s1']);
  });
});
