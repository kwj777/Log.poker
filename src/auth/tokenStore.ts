/**
 * Where the token lives on iOS and Android: the keychain, via expo-secure-store.
 *
 * Metro swaps `tokenStore.web.ts` in for the browser build, the same way it
 * picks Dexie over SQLite in `repositoryFactory`. Both files export the same
 * `tokenStore`, and the `satisfies` in each keeps them from drifting.
 *
 * The keychain rather than AsyncStorage because this is a bearer credential:
 * anything holding the string is the account until it expires. On device that
 * means the Keychain and the Keystore, which is what SecureStore is.
 *
 * Every method swallows its failure and answers as if nothing were stored. The
 * keychain can genuinely be unavailable -- a device that has just booted and
 * not been unlocked will refuse a read -- and the cost of getting that wrong is
 * an app that throws on launch for a feature it is not even using yet.
 */

import * as SecureStore from 'expo-secure-store';

import type { TokenStore } from './session';

/**
 * One key, named for the family rather than the app.
 *
 * **Named for it rather than shared with it, so far.** `SecureStore` is called
 * with no options, so this is the app's own keychain service and no other app
 * can read it; `app.json` carries no keychain access group. The name has always
 * described the intention and never the arrangement, and reading it as the
 * arrangement is how a whole design once got written on top of a sharing that
 * was not happening.
 *
 * The account is meant to be shared across the three, and the access group is
 * what would do it. **The order matters and one way round is silent**: the
 * others have to be minting the family's own subject first, because a shared
 * store carrying a token this app's gate refuses is a device that stops syncing
 * for somebody who did nothing. See SYNC.md, "One identity for three apps".
 */
const KEY = 'family_access_token';

export const tokenStore = {
  async read() {
    try {
      return await SecureStore.getItemAsync(KEY);
    } catch {
      return null;
    }
  },
  async write(token: string) {
    try {
      await SecureStore.setItemAsync(KEY, token);
    } catch {
      // Nothing to do and nothing worth saying: the session lasts as long as
      // the process, and the next launch asks to sign in again.
    }
  },
  async clear() {
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      // As above. A clear that could not write is indistinguishable, to
      // everything downstream, from one that was never asked for.
    }
  },
} satisfies TokenStore;

/** Named in Settings, so a bug report says which store it hit. */
export const TOKEN_STORE = 'Keychain (expo-secure-store)';
