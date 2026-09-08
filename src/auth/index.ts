/**
 * The auth layer's public entry point.
 *
 * Everything above this file asks for `getSession()` and gets whatever the
 * platform's store had, which is almost always null and is meant to be: Log is
 * free in its entirety, and a session buys one feature that does not exist yet.
 * Nothing in the app calls this today.
 */

import { SessionManager } from './session';
import { renewToken } from './signin';
import { tokenStore, TOKEN_STORE } from './tokenStore';

let manager: SessionManager = new SessionManager(tokenStore);

export const getSession = () => manager.current();
export const getToken = () => manager.token();
export const signIn = (token: string) => manager.signIn(token);
export const signOut = () => manager.signOut();

/**
 * Ask for a fresh token if the one held is nearly out. Launch calls this.
 *
 * Wired here because it is the one place that knows both halves: the manager
 * holds the token and `signin.ts` knows where to trade it. Neither has any
 * business importing the other.
 *
 * Never throws and never waits on anything the caller cares about. A renewal
 * that does not happen is a token that is still good for up to another ten
 * days and another launch to try in.
 */
export const renewIfDue = async (): Promise<boolean> =>
  manager
    .renewIfDue(async (token) => {
      const answer = await renewToken(token);
      return answer.ok ? answer.token : null;
    })
    .catch(() => false);

/** Test/dev hook: swap in another store, the way `setRepository` does. */
export const setSessionManager = (next: SessionManager | null): void => {
  manager = next ?? new SessionManager(tokenStore);
};

export { TOKEN_STORE };
export * from './session';
export * from './token';
