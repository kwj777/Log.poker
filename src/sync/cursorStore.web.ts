/**
 * Where the cursors live on the web. See `cursorStore.ts` for why they sit
 * beside the token rather than in the database.
 */

import type { CursorStore, Cursors } from '../data/SyncingRepository';

const KEY = 'log_sync_cursors';

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const parse = (held: string | null): Cursors => {
  try {
    const { pulled, pushed } = JSON.parse(held ?? '') as Partial<Cursors>;
    return {
      pulled: typeof pulled === 'number' && pulled > 0 ? pulled : 0,
      pushed: typeof pushed === 'number' && pushed > 0 ? pushed : 0,
    };
  } catch {
    return { pulled: 0, pushed: 0 };
  }
};

export const cursorStore: CursorStore = {
  async read() {
    try {
      return parse(storage()?.getItem(KEY) ?? null);
    } catch {
      return { pulled: 0, pushed: 0 };
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
