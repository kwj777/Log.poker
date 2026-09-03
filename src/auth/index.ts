/**
 * The auth layer's public entry point.
 *
 * Everything above this file asks for `getSession()` and gets whatever the
 * platform's store had, which is almost always null and is meant to be: Log is
 * free in its entirety, and a session buys one feature that does not exist yet.
 * Nothing in the app calls this today.
 */

import { SessionManager } from './session';
import { tokenStore, TOKEN_STORE } from './tokenStore';

let manager: SessionManager = new SessionManager(tokenStore);

export const getSession = () => manager.current();
export const getToken = () => manager.token();
export const signIn = (token: string) => manager.signIn(token);
export const signOut = () => manager.signOut();

/** Test/dev hook: swap in another store, the way `setRepository` does. */
export const setSessionManager = (next: SessionManager | null): void => {
  manager = next ?? new SessionManager(tokenStore);
};

export { TOKEN_STORE };
export * from './session';
export * from './token';
