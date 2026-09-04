/**
 * Holding the token, and answering what it is worth.
 *
 * All of the logic, none of the platform. A `TokenStore` is three methods, the
 * same shape trick `SqlRepository` plays on `SqlDriver`: the keychain on
 * device and `localStorage` on web each implement it in a dozen lines, and
 * everything worth testing lives here and is exercised against an in-memory
 * one.
 *
 * ## Nothing in here gates the free app
 *
 * Log is free in its entirety and stays usable forever by somebody who never
 * types an email address. There is no signed-out state to handle, because
 * signed out is the state the whole app already runs in: every screen reads
 * the local database and always will. What a session buys is one feature that
 * does not exist without a server to talk to. See SYNC.md.
 */

import type { Timestamp } from '../domain/types';
import { holdsLogPlus, readClaim, type Claim } from './token';

/**
 * Somewhere to keep one string.
 *
 * Every method resolves rather than throwing when the store is unavailable.
 * Storage that is missing or locked is ordinary here, not exceptional: a
 * private browsing window, a browser set to block site data, a prerender with
 * no `window` at all. The answer in every case is the same as never having
 * signed in, which the app is built to handle.
 */
export interface TokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** For tests, and the fallback when a platform has nowhere durable to write. */
export const memoryTokenStore = (): TokenStore => {
  let held: string | null = null;
  return {
    read: async () => held,
    write: async (token: string) => {
      held = token;
    },
    clear: async () => {
      held = null;
    },
  };
};

export interface Session {
  claim: Claim;
  /** Whether this session buys cross-device history. */
  syncs: boolean;
}

export class SessionManager {
  private readonly store: TokenStore;
  private readonly clock: () => Timestamp;

  constructor(store: TokenStore, clock: () => Timestamp = Date.now) {
    this.store = store;
    this.clock = clock;
  }

  /**
   * The session this device holds, or null.
   *
   * **An expired token is cleared rather than merely ignored.** Leaving it
   * costs nothing today and everything the day somebody reads the store
   * without going through here; a token that has stopped meaning anything is
   * a credential still sitting on a phone that gets sold.
   */
  async current(): Promise<Session | null> {
    const token = await this.store.read();
    if (token === null) return null;

    const claim = readClaim(token, this.clock());
    if (claim === null) {
      await this.store.clear();
      return null;
    }
    return { claim, syncs: holdsLogPlus(claim) };
  }

  /**
   * Take a token from the sign-in and keep it.
   *
   * Refuses one it cannot read, rather than storing it and discovering the
   * problem on the next launch. The check is shape and expiry only: see the
   * note at the top of `token.ts` about what this side can and cannot prove.
   */
  async signIn(token: string): Promise<Session | null> {
    const claim = readClaim(token, this.clock());
    if (claim === null) return null;
    await this.store.write(token);
    return { claim, syncs: holdsLogPlus(claim) };
  }

  /**
   * The raw token, for the one caller that needs to send it somewhere.
   *
   * Read through `current()` rather than straight out of the store, so an
   * expired one is cleared here too and never handed to a request that would
   * be refused for carrying it.
   */
  async token(): Promise<string | null> {
    return (await this.current()) === null ? null : this.store.read();
  }

  /**
   * Forget the token.
   *
   * Only the token. Signing out is not a wipe: the log is the player's and it
   * is local, and an app that emptied itself when a card expired would be the
   * exact thing SYNC.md refuses to build.
   */
  async signOut(): Promise<void> {
    await this.store.clear();
  }
}
