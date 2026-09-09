/**
 * Where the cursors live on the web.
 *
 * Beside the token rather than in the database, because they are facts about
 * this device's conversation with the server rather than part of the log:
 * `clearAll` wipes the log, and cursors that went with it would leave a reset
 * device believing it had already seen everything, so its log would come back
 * empty and stay that way.
 *
 * They are still forgotten at the same moment the token is, which for a while
 * **nothing did**, on either engine: not signing out, not erasing the copy on
 * the server. So an erased log could never go back up, because `pushed` still
 * said it had all been sent, and the next person to sign in on a device
 * inherited the last one's place in a conversation with a different bucket.
 * `SyncingRepository.forget` is what does it, and the card calls it wherever
 * it puts a token down.
 */

import { randomId } from '../data/support';
import type { CursorStore, Cursors } from '../data/SyncingRepository';

const KEY = 'log_sync_cursors';

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * A device id, invented exactly once and kept through everything.
 *
 * Not a fingerprint and not a person: random bytes, meaningless anywhere but
 * in this one bundle. It exists so the server can count how many devices are
 * still waiting to hear about a tombstone, which is the difference between
 * collecting on a rule and collecting on a guess. Two requests carrying it are
 * already obviously from one place, because they carry the same token.
 */
const mint = (): string => randomId().replace(/[^A-Za-z0-9_-]/g, '').padEnd(16, '0').slice(0, 32);

/**
 * The id this run invented, minted once and then reused.
 *
 * Every path below that cannot read a stored id falls back to a fresh one, and
 * a store that is failing rather than empty takes that path on every sync. A
 * new id each time would have the server counting one phone as hundreds of
 * devices, each of them holding a tombstone back for six months, and the log
 * re-sent from nothing every time. One id per run is wrong in a way that
 * settles; a new one per call is wrong in a way that grows.
 */
let invented: string | null = null;

export const freshCursors = (): Cursors => ({
  pulled: 0,
  pushed: 0,
  device: (invented ??= mint()),
  settled: 0,
});

const parse = (held: string | null): Cursors => {
  const fresh = freshCursors();
  try {
    const { pulled, pushed, device, settled } = JSON.parse(held ?? '') as Partial<Cursors>;
    return {
      pulled: typeof pulled === 'number' && pulled > 0 ? pulled : 0,
      pushed: typeof pushed === 'number' && pushed > 0 ? pushed : 0,
      // Zero when it is missing or nonsense, which reads as "the server has
      // heard nothing from here". That is the answer that sweeps on the window
      // alone, and it is the right way to be wrong: a record written before
      // this field existed was either pushed, in which case the server holds
      // the delete too, or never sent, in which case there is no bucket
      // waiting to send it back.
      settled: typeof settled === 'number' && settled > 0 ? settled : 0,
      // A stored id survives whatever else was wrong with the record. Minting
      // a new one makes this device look new to the server, which holds
      // collection up for a whole window under a name nobody will use again.
      device: typeof device === 'string' && DEVICE_ID.test(device) ? device : fresh.device,
    };
  } catch {
    // Nothing stored, or something that is not a cursor. Both mean this device
    // has seen nothing, which costs one full sync and no data.
    return fresh;
  }
};

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const cursorStore: CursorStore = {
  async read() {
    try {
      return parse(storage()?.getItem(KEY) ?? null);
    } catch {
      return freshCursors();
    }
  },
  async write(cursors: Cursors) {
    try {
      storage()?.setItem(KEY, JSON.stringify(cursors));
    } catch {
      // Full, or blocked. One re-sync, and re-syncing is idempotent.
    }
  },
};
