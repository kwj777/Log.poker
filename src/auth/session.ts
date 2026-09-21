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
import { dueForRenewal, hasOwnSubject, paidForSync, readClaim, type Claim } from './token';

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

/**
 * For tests, and the fallback when a platform has nowhere durable to write.
 *
 * The second half of that is `SessionManager`'s, below: a store that cannot
 * keep the token is not a sign-in that failed, it is a sign-in that lasts as
 * long as the process.
 */
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
  /**
   * Whether this session carries a log between devices.
   *
   * Two conditions now, where there was one. A subject of its own, which a
   * shared passcode does not have because it names a door rather than a
   * person. And whatever sync costs, which is nothing while `SYNC_NEEDS_PASS`
   * is false and is the pass once it is not.
   *
   * Read by `data/index.ts` to decide whether to wrap the repository at all,
   * so a false answer here is a device that never asks rather than one that
   * asks and is turned away.
   */
  syncs: boolean;
}

export class SessionManager {
  private readonly store: TokenStore;
  private readonly clock: () => Timestamp;

  /**
   * Bumped every time the token this device holds is deliberately changed.
   *
   * The fence for `renewIfDue`, which is the one operation here that takes a
   * network round trip and then writes. Everything else is a read and a write
   * with nothing in between; that one has seconds in the middle, and somebody
   * can sign out or erase inside them. See the note there.
   */
  private generation = 0;

  /**
   * The token, when the platform's store would not keep it.
   *
   * Both adapters swallow a write they cannot do, because storage that is
   * missing or locked is ordinary here and an app that threw on launch for a
   * feature it is not using would be worse. What that leaves is a `write` that
   * answers the same whether or not anything was stored, and a sign-in on top
   * of it that reported a session nothing could then find: `current()` read the
   * store and got null, so the card said signed in, `recomposeRepository` built
   * the plain local repository, `token()` had nothing to send, and the one-time
   * code was already spent. A private window, a browser set to block site data,
   * a phone booted and not yet unlocked -- in all three, signing in did nothing
   * and said it had worked.
   *
   * So the write is read back, and what the store would not keep is kept here
   * instead. That is what the rest of this class already claims: a sign-in
   * lasts as long as the process, and the next launch asks again.
   */
  private readonly fallback = memoryTokenStore();

  constructor(store: TokenStore, clock: () => Timestamp = Date.now) {
    this.store = store;
    this.clock = clock;
  }

  /**
   * The token this device is holding, from wherever it is being held.
   *
   * The fallback first: it is only ever set by a write the store refused, so
   * when it holds anything it holds something newer than whatever the store
   * kept instead.
   */
  private async stored(): Promise<string | null> {
    return (await this.fallback.read()) ?? (await this.store.read());
  }

  /**
   * Keep a token, durably if the platform will and in memory if it will not.
   *
   * The read-back is the whole of the test, because a `TokenStore` cannot say
   * no: `write` resolves either way by design. Reading it back is the only
   * question that has a different answer.
   *
   * **The fallback is never emptied on the way through.** It is set or cleared
   * once the durable store has answered, so at every await in here one of the
   * two is holding a token. Clearing it first read cleanly and left a window
   * -- three awaits wide, and `renewIfDue` runs at launch without being
   * awaited -- where a device with no durable store had nothing anywhere, and
   * a `current()` landing in it reported signed out. That is not a cosmetic
   * answer: `data/index.ts` composes the plain local repository on it and
   * nothing syncs for the rest of the process.
   */
  private async keep(token: string): Promise<void> {
    await this.store.write(token);
    if ((await this.store.read()) === token) await this.fallback.clear();
    else await this.fallback.write(token);
  }

  /** Forget it in both places, so neither can put back what the other dropped. */
  private async forget(): Promise<void> {
    await this.fallback.clear();
    await this.store.clear();
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
    const token = await this.stored();
    if (token === null) return null;

    const claim = readClaim(token, this.clock());
    if (claim === null) {
      this.generation += 1;
      await this.forget();
      return null;
    }
    return { claim, syncs: hasOwnSubject(claim) && paidForSync(claim) };
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
    this.generation += 1;
    await this.keep(token);
    return { claim, syncs: hasOwnSubject(claim) && paidForSync(claim) };
  }

  /**
   * The raw token, for the one caller that needs to send it somewhere.
   *
   * Read through `current()` rather than straight out of the store, so an
   * expired one is cleared here too and never handed to a request that would
   * be refused for carrying it.
   */
  async token(): Promise<string | null> {
    return (await this.current()) === null ? null : this.stored();
  }

  /**
   * Replace the token with a fresh one, if the one held is nearly out.
   *
   * The whole of what stops a session from ending on a timer. Called at launch
   * and never awaited: this is a network request, and nothing in Log waits on
   * one.
   *
   * **Every way of failing leaves the token alone**, which is the property
   * worth stating rather than inferring. A refusal, a dead network, an answer
   * that is not a token, a store that will not write: in all of them what was
   * there is still there, still valid, and still renewable on the next launch.
   * There are ten days of window and a launch is another try. The one thing
   * this must never do is clear a working credential because a request failed,
   * which is the shape of every "signed me out for no reason" bug there is.
   *
   * Answers whether it wrote one, for a test and for nobody else.
   */
  async renewIfDue(fresh: (token: string) => Promise<string | null>): Promise<boolean> {
    // Captured before anything is read, and checked again before anything is
    // written. Renewal is the one operation on this class with a network round
    // trip in the middle of it, and it runs at launch without being awaited,
    // so the seconds it takes are seconds somebody can spend signing out or
    // erasing. Writing afterwards put the token back and signed the device
    // silently in again -- with a fresh thirty days, and after an erase into a
    // bucket that had just been deleted.
    const generation = this.generation;
    const now = this.clock();
    const token = await this.stored();
    if (token === null) return false;

    const claim = readClaim(token, now);
    // Expired, or unreadable. `current()` is the one place that clears, and it
    // is not this one: a renewal is not a session check.
    if (claim === null || !dueForRenewal(claim, now)) return false;

    const next = await fresh(token);
    if (next === null) return false;

    // Refused rather than stored, exactly as `signIn` refuses one: a token this
    // side cannot read is one the next launch would clear, and replacing a good
    // token with that is worse than not renewing at all.
    if (readClaim(next, now) === null) return false;

    // Nothing put the token down while this was in flight. The counter rather
    // than a re-read and a comparison, because it moves at the *start* of a
    // sign-out, before the clear it is waiting on has finished: a comparison
    // would still see the old token there and write over the top of somebody
    // signing out.
    if (generation !== this.generation) return false;

    await this.keep(next);
    return true;
  }

  /**
   * Forget the token.
   *
   * Only the token. Signing out is not a wipe: the log is the player's and it
   * is local, and an app that emptied itself when a card expired would be the
   * exact thing SYNC.md refuses to build.
   */
  async signOut(): Promise<void> {
    // Before the clear rather than after it. A renewal in flight checks this
    // counter before it writes, and the point of moving it first is that the
    // renewal is fenced from the moment somebody asks to sign out, not from
    // the moment the keychain finishes obliging.
    this.generation += 1;
    await this.forget();
  }
}
