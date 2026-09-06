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

/** The least a record has to be for this to place it in the tree. */
interface Row {
  id: string;
  updatedAt: Timestamp;
  venueId?: unknown;
  sessionId?: unknown;
}

interface Item {
  table: SyncTable;
  change: Change<Row>;
  size: number;
}

export interface Batch {
  /** What goes up now. */
  changes: ChangeSet;
  /**
   * The mark this batch earns: everything at or below it has been sent.
   *
   * Taken from the time prefix rather than from the batch, because a parent
   * pulled in from above the cut is sent without everything around it having
   * been, and a mark past that would strand the records around it.
   */
  sent: Timestamp;
  /** Whether anything was held back, and so whether to come straight back. */
  more: boolean;
}

const parentOf = (item: Item): unknown => {
  if (item.table === 'sessions') return item.change.record.venueId;
  if (item.table === 'venues') return null;
  return item.change.record.sessionId;
};

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
  const items: Item[] = [];
  let highest = floor;
  let total = 0;
  for (const table of SYNC_TABLES) {
    for (const change of pending[table] as unknown as Change<Row>[]) {
      const size = JSON.stringify(change).length;
      items.push({ table, change, size });
      total += size;
      if (change.record.updatedAt > highest) highest = change.record.updatedAt;
    }
  }
  if (total <= cap) return { changes: pending, sent: highest, more: false };

  // When it was written, then by table, then by id. The last two decide nothing
  // but decide it the same way every time, which is what makes a retry send the
  // same batch rather than a different one.
  const order = [...items].sort(
    (a, b) =>
      a.change.record.updatedAt - b.change.record.updatedAt ||
      SYNC_TABLES.indexOf(a.table) - SYNC_TABLES.indexOf(b.table) ||
      (a.change.record.id < b.change.record.id ? -1 : 1),
  );

  const byId = new Map(items.map((item) => [item.change.record.id, item]));
  const taken = new Set<string>();
  const batch = emptyChangeSet() as unknown as Record<SyncTable, Change<Row>[]>;
  let size = 0;
  let sent = floor;

  /**
   * A record and every ancestor of it still waiting to go, parents first.
   *
   * An ancestor that is not in `pending` at all is one whose stamp is under the
   * mark, which means it has already been sent and is on the server.
   */
  const closureOf = (item: Item): Item[] => {
    const chain: Item[] = [];
    const walking = new Set<string>();
    const walk = (current: Item): void => {
      const { id } = current.change.record;
      if (taken.has(id) || walking.has(id)) return;
      walking.add(id);
      const parent = parentOf(current);
      if (typeof parent === 'string') {
        const held = byId.get(parent);
        if (held) walk(held);
      }
      chain.push(current);
    };
    walk(item);
    return chain;
  };

  for (const item of order) {
    // Already sent as somebody's parent. The mark still moves over it, because
    // it has gone.
    if (taken.has(item.change.record.id)) {
      sent = item.change.record.updatedAt;
      continue;
    }

    const chain = closureOf(item);
    const cost = chain.reduce((sum, one) => sum + one.size, 0);
    // Over budget, and stopping here is only allowed once the mark has actually
    // moved. `taken.size > 0` was the wrong test: a record that had already
    // been sent is re-read every round, because the floor is read one
    // millisecond back, so it filled the batch, satisfied that test, and let
    // the loop break at the same place forever. The mark stayed where it was,
    // the next round rebuilt the identical batch, and the device pushed nothing
    // again for the rest of its life while reporting every round a success.
    //
    // Measured against the mark instead, the batch always contains at least one
    // record the mark can move past, so every round makes progress. The cost is
    // that a single record bigger than the budget goes anyway rather than
    // wedging everything behind it -- and the budget is a quarter of what the
    // endpoint will take, so it very likely still lands.
    if (sent > floor && size + cost > cap) break;

    for (const one of chain) {
      batch[one.table].push(one.change);
      taken.add(one.change.record.id);
      size += one.size;
    }
    sent = item.change.record.updatedAt;
  }

  return {
    changes: batch as unknown as ChangeSet,
    sent,
    more: taken.size < items.length,
  };
};
