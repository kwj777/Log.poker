/**
 * Where the cursors live on iOS and Android.
 *
 * The same keychain the token uses, not because a cursor is a secret but
 * because it has to be forgotten at exactly the same moment the token is: a
 * cursor left behind after a sign-out would tell the next person to sign in on
 * this device that they had already seen everything, and their log would arrive
 * empty and stay that way.
 *
 * Metro swaps `cursorStore.web.ts` in for the browser build.
 */

import * as SecureStore from 'expo-secure-store';

import type { CursorStore, Cursors } from '../data/SyncingRepository';

const KEY = 'log_sync_cursors';

const parse = (held: string | null): Cursors => {
  try {
    const { pulled, pushed } = JSON.parse(held ?? '') as Partial<Cursors>;
    return {
      pulled: typeof pulled === 'number' && pulled > 0 ? pulled : 0,
      pushed: typeof pushed === 'number' && pushed > 0 ? pushed : 0,
    };
  } catch {
    // Nothing stored, or something that is not a cursor. Both mean the same:
    // this device has seen nothing, which costs one full sync and no data.
    return { pulled: 0, pushed: 0 };
  }
};

export const cursorStore: CursorStore = {
  async read() {
    try {
      return parse(await SecureStore.getItemAsync(KEY));
    } catch {
      return { pulled: 0, pushed: 0 };
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
