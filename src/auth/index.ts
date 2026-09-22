/**
 * The auth layer's public entry point.
 *
 * Everything above this file asks for `getSession()` and gets whatever the
 * platform's store had, which for most people is null and is meant to be: Log
 * is free in its entirety and works signed out.
 *
 * What a session buys is real now, which this said it was not. Five modules
 * import this file: `src/data/index.ts` composes the syncing repository behind
 * a token and renews one at launch, `SignInCard` runs the sign-in,
 * `app/claim.tsx` takes delivery of a hand-off, and the warm-up and
 * after-session cards ask `hasPass` which of two sentences to show. The
 * paragraph that used to be here -- "a session buys one feature that does not
 * exist yet. Nothing in the app calls this today." -- was written before any
 * of that shipped.
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
