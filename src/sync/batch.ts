/**
 * How much of a backlog goes up in one request.
 *
 * A device sends what changed since it last synced, so an ordinary push is a
 * few kilobytes and none of this runs. The one that is not is a device pushing
 * for the first time with years already on it, and that push was refused: over
 * the endpoint's cap it is answered 400, which the client reads as `refused`,
 * and it then retries the identical body every five minutes for the rest of the
 * install's life. The player the feature exists for is the one it locked out.
 *
 * ## Why a time prefix is not enough on its own
 *
 * Cutting the backlog anywhere is easy. Cutting it somewhere the server can
 * hold the result is not, because the receiving end skips a record whose parent
 * is missing rather than failing the whole sync -- and its cursor moves past
 * that record anyway, so a hand that arrives before its session is never
 * offered to that device again. Split a push carelessly and the bug is silent,
 * permanent, and on the other device.
 *
 * Ordering by `updatedAt` almost gives it: a session is created before its
 * hands. Almost, because a session **edited** afterwards carries a stamp later
 * than the hands under it, so a time prefix can hold children whose session
 * sits above the cut and has never been sent at all.
 *
 * So the batch is a time prefix **plus whatever parents that prefix needs**.
 * The extra records are above the mark this batch earns, which costs sending
 * them again in the next round and nothing else: applying a record twice is a
 * no-op, which is the property the whole protocol already rests on.
 */

import type { Change, ChangeSet } from '../data/repository';
import type { Timestamp } from '../domain/types';
import { SYNC_TABLES, emptyChangeSet, type SyncTable } from './protocol';

/**
 * Characters, not bytes, and deliberately far under the endpoint's 2MB.
 *
 * A character is between one and four bytes once it is UTF-8, and a note is
 * whatever somebody typed. Budgeting in characters at a quarter of the cap
 * means even a body that is entirely outside ASCII arrives inside it.
 */
export const MAX_PUSH_CHARS = 512 * 1024;

/**
 * And the same for an answer, which had no bound at all.
 *
 * Larger than a push because a pull is the one that is legitimately big: a
 * device with nothing asks for everything, and making it ask ten times for a
 * history that would have fitted in two is a cost paid by every new device.
 */
export const MAX_ANSWER_CHARS = 1024 * 1024;

/** The least a record has to be for this to place it in the tree. */
interface Row {
  id: string;
  updatedAt: Timestamp;
  venueId?: unknown;
  sessionId?: unknown;
}

/** One record, reduced to what paging needs to know about it. */
interface Item<T> {
  table: SyncTable;
  id: string;
  parent: unknown;
  stamp: Timestamp;
  size: number;
  value: T;
}

interface Page<T> {
  taken: Item<T>[];
  sent: Timestamp;
  more: boolean;
}

/** What a record of this table hangs off, or null for one that hangs off nothing. */
const parentIn = (table: SyncTable, record: Row): unknown => {
  if (table === 'venues') return null;
  if (table === 'sessions') return record.venueId;
  return record.sessionId;
};

const describe = <T>(table: SyncTable, record: Row, stamp: Timestamp, value: T): Item<T> => ({
  table,
  id: record.id,
  parent: parentIn(table, record),
  stamp,
  size: JSON.stringify(value).length,
  value,
});

/**
 * The prefix that fits, plus the parents that prefix needs.
 *
 * One implementation for both directions. What changes between them is only
 * which stamp orders the records and where the floor came from; the rule about
 * never leaving a child without its parent is the same rule, and a second copy
 * of it is a second copy to get wrong.
 */
const pageOf = <T>(items: Item<T>[], floor: Timestamp, cap: number): Page<T> => {
  // By stamp, then by table, then by id. The last two decide nothing but decide
  // it the same way every time, which is what makes a retry send the same page.
  const order = [...items].sort(
    (a, b) =>
      a.stamp - b.stamp ||
      SYNC_TABLES.indexOf(a.table) - SYNC_TABLES.indexOf(b.table) ||
      (a.id < b.id ? -1 : 1),
  );

  const byId = new Map(items.map((item) => [item.id, item]));
  const held = new Set<string>();
  const taken: Item<T>[] = [];
  let size = 0;
  let sent = floor;

  /**
   * A record and every ancestor of it still in this set, parents first.
   *
   * An ancestor that is not in the set at all is one the other side already
   * has: on a push it is under the mark and so was sent, and in an answer it is
   * under the cursor and so was served.
   */
  const closureOf = (item: Item<T>): Item<T>[] => {
    const chain: Item<T>[] = [];
    const walking = new Set<string>();
    const walk = (current: Item<T>): void => {
      if (held.has(current.id) || walking.has(current.id)) return;
      walking.add(current.id);
      if (typeof current.parent === 'string') {
        const parent = byId.get(current.parent);
        if (parent) walk(parent);
      }
      chain.push(current);
    };
    walk(item);
    return chain;
  };

  for (const item of order) {
    // Already gone, as somebody's parent. The mark still moves over it.
    if (held.has(item.id)) {
      sent = item.stamp;
      continue;
    }

    const chain = closureOf(item);
    const cost = chain.reduce((sum, one) => sum + one.size, 0);
    // Over budget, and stopping here is only allowed once the mark has actually
    // moved. Counting what has been taken was the wrong test: a record that had
    // already gone is re-read every round, because the floor is read one step
    // back, so it filled the page, satisfied that test, and let the loop break
    // at the same place forever. The mark stayed where it was, the next round
    // rebuilt the identical page, and nothing ever moved again.
    //
    // **So the block at the floor is atomic.** The mark is a stamp, so records
    // sharing one cannot be told apart by it: every record at the floor goes in
    // one answer or the loop cannot advance. When that block is itself over the
    // cap it goes anyway, and the answer is that much bigger than the budget.
    // That is a property of a timestamp cursor rather than a bug here, and it
    // is bounded by how much one merge can write at one stamp -- which is why
    // `readBundle` no longer restamps a whole bundle on a version change, and
    // why a push is capped before it arrives.
    //
    // **The floor block and no other**, which is worth saying because the
    // obvious reading is stronger and is wrong. Once the mark has moved to a
    // new stamp T, `sent > floor` is satisfied and the very next record -- also
    // at T -- can end the page, so the answer goes back saying T with part of T
    // still here. Delivery survives it: a device is served everything at or
    // *after* the number it sends, so it gets the rest of T on the next round.
    //
    // `collect` does not. It takes the horizon as `min(acked) + 1` on the
    // stated ground that "a cursor of C is proof of having applied C, not
    // merely of having applied everything below it", and after a cut inside C
    // that is false: a tombstone at C held back from the page that issued the
    // cursor C can be swept before the device ever hears about it, and the row
    // it deletes comes back from that device for good. It needs a device more
    // than the retention window behind and a multi-record stamp straddling the
    // budget, which is narrow, and it is a real hole rather than a theoretical
    // one.
    //
    // **And it cannot be closed here.** Every record written by one merge
    // carries that merge's stamp, so a "stamp" is a whole push, bounded only by
    // the 2MB body cap the endpoint enforces. Making a block atomic makes a
    // bundle built from one push unpageable at any budget below it, which is
    // the failure this file exists to prevent and which the
    // "a history too big for one answer" case in
    // `src/data/__tests__/syncingRepository.test.ts` catches immediately. A
    // timestamp cursor cannot say "half of T", so the fix belongs on the side
    // that reads the cursor as proof, not on the side that issues it.
    //
    // Measured against the mark instead, a page always contains at least one
    // record the mark can move past, so every round makes progress. The cost is
    // that a single record bigger than the budget goes anyway rather than
    // wedging everything behind it, and the budget is a fraction of what either
    // end will take, so it very likely still lands.
    if (sent > floor && size + cost > cap) break;

    for (const one of chain) {
      taken.push(one);
      held.add(one.id);
      size += one.size;
    }
    sent = item.stamp;
  }

  return { taken, sent, more: held.size < items.length };
};

export interface Batch {
  /** What goes up now. */
  changes: ChangeSet;
  /**
   * The mark this batch earns: everything at or below it has been sent.
   *
   * Taken from the prefix rather than from the batch, because a parent pulled
   * in from above the cut is sent without everything around it having been, and
   * a mark past that would strand the records around it.
   */
  sent: Timestamp;
  /** Whether anything was held back, and so whether to come straight back. */
  more: boolean;
}

/**
 * The batch to send, and the mark it earns.
 *
 * Everything, when everything fits, which is every ordinary sync.
 */
export const batchFor = (
  pending: ChangeSet,
  floor: Timestamp,
  budget: number = MAX_PUSH_CHARS,
): Batch => {
  const cap = budget > 0 ? budget : MAX_PUSH_CHARS;
  const items: Item<Change<Row>>[] = [];
  let highest = floor;
  let total = 0;
  for (const table of SYNC_TABLES) {
    for (const change of pending[table] as unknown as Change<Row>[]) {
      const item = describe(table, change.record, change.record.updatedAt, change);
      items.push(item);
      total += item.size;
      if (item.stamp > highest) highest = item.stamp;
    }
  }
  if (total <= cap) return { changes: pending, sent: highest, more: false };

  const page = pageOf(items, floor, cap);
  const changes = emptyChangeSet() as unknown as Record<SyncTable, Change<Row>[]>;
  for (const item of page.taken) changes[item.table].push(item.value);

  return { changes: changes as unknown as ChangeSet, sent: page.sent, more: page.more };
};

/** A stored change as the merge holds it: with the server's stamp on it. */
export interface Stamped {
  record: Row;
  deletedAt: Timestamp | null;
  heardAt: Timestamp;
}

export interface Answer {
  /** What goes back now, with the server's own bookkeeping left off. */
  changes: ChangeSet;
  /** The cursor this answer earns: everything up to it has been handed over. */
  cursor: Timestamp;
  /** Whether anything was held back, and so whether to come straight back. */
  more: boolean;
}

/**
 * The answer to a pull, bounded the same way a push is.
 *
 * The request was capped and the answer was not, which is the wrong way round:
 * a first pull is the big one. Ten years of a three-a-week player is 2.68MB by
 * this data model, and the version-2 read deliberately stamps every entry as
 * heard now, so the first answer after that migration is the whole bundle for
 * everybody. Past what the platform will return, that device can never finish a
 * first sync, and no amount of retrying changes it.
 *
 * Cut on `heardAt`, because that is what the cursor is. And with the same
 * parent closure as a push, for a sharper version of the same reason: the
 * receiving device skips a record whose parent is missing and moves its cursor
 * past it anyway, so a hand handed over before its session is never offered
 * again. A settle rule can raise a session's stamp above the hands under it,
 * which is exactly the ordering that would do it.
 */
export const answerFrom = (
  records: Record<SyncTable, Record<string, Stamped>>,
  from: Timestamp,
  through: Timestamp,
  budget?: number,
): Answer => {
  const cap = budget !== undefined && budget > 0 ? budget : MAX_ANSWER_CHARS;
  const items: Item<Stamped>[] = [];
  let total = 0;
  for (const table of SYNC_TABLES) {
    for (const change of Object.values(records[table])) {
      if (change.heardAt < from) continue;
      const item = describe(table, change.record, change.heardAt, change);
      items.push(item);
      total += item.size;
    }
  }

  // `heardAt` is the server's note to itself and no part of what a device was
  // promised, so it comes off below rather than going on the wire.
  const changes = emptyChangeSet() as unknown as Record<SyncTable, Change<Row>[]>;

  if (total <= cap) {
    for (const item of items) {
      changes[item.table].push({ record: item.value.record, deletedAt: item.value.deletedAt });
    }
    return { changes: changes as unknown as ChangeSet, cursor: through, more: false };
  }

  const page = pageOf(items, from, cap);
  for (const item of page.taken) {
    changes[item.table].push({ record: item.value.record, deletedAt: item.value.deletedAt });
  }
  return { changes: changes as unknown as ChangeSet, cursor: page.sent, more: page.more };
};
