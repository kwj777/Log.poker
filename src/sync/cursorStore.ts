/**
 * Where the cursors live on iOS and Android.
 *
 * Beside the token rather than in the database, because they are facts about
 * this device's conversation with the server rather than part of the log:
 * `clearAll` wipes the log, and cursors that went with it would leave a reset
 * device believing it had already seen everything, so its log would come back
 * empty and stay that way.
 *
 * The keychain, not because a cursor is a secret but because it has to be
 * forgotten at the same moment the token is.
 */

import * as SecureStore from 'expo-secure-store';

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

export const freshCursors = (): Cursors => ({ pulled: 0, pushed: 0, device: mint() });

const parse = (held: string | null): Cursors => {
  const fresh = freshCursors();
  try {
    const { pulled, pushed, device } = JSON.parse(held ?? '') as Partial<Cursors>;
    return {
      pulled: typeof pulled === 'number' && pulled > 0 ? pulled : 0,
      pushed: typeof pushed === 'number' && pushed > 0 ? pushed : 0,
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

export const cursorStore: CursorStore = {
  async read() {
    try {
      return parse(await SecureStore.getItemAsync(KEY));
    } catch {
      return freshCursors();
    }
  },
  async write(cursors: Cursors) {
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(cursors));
    } catch {
      // A cursor that could not be saved costs one re-sync, and re-syncing is
      // idempotent. Not worth failing a write the player already saw succeed.
    }
  },
};
