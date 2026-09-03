/**
 * Where the token lives on the web: `localStorage`, for want of anywhere better.
 *
 * There is no keychain in a browser. The honest options are a `HttpOnly`
 * cookie, which this cannot use because the token is minted on another
 * registrable domain, and `localStorage`, which is readable by any script that
 * gets onto the page. Log runs no third-party script and has no ad, no tracker
 * and no analytics, so the set of scripts that could read it is the set that
 * ships in the bundle. That is the argument, and it is worth re-reading if a
 * third-party script is ever added.
 *
 * Every accessor is wrapped. `localStorage` is not merely empty in a private
 * window or with site data blocked, it *throws on access*, and it does not
 * exist at all during the static export that prerenders the app's shell.
 */

import type { TokenStore } from './session';

const KEY = 'family_access_token';

/** Null rather than a throw when there is no storage, which is a real state. */
const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const tokenStore = {
  async read() {
    try {
      return storage()?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  },
  async write(token: string) {
    try {
      storage()?.setItem(KEY, token);
    } catch {
      // Full, or blocked. The session lasts as long as the tab.
    }
  },
  async clear() {
    try {
      storage()?.removeItem(KEY);
    } catch {
      // Nothing readable was written, so nothing readable is left behind.
    }
  },
} satisfies TokenStore;

/** Named in Settings, so a bug report says which store it hit. */
export const TOKEN_STORE = 'localStorage';
