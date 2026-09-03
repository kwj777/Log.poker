/**
 * Holding a token, against a store that fails the way real ones do.
 *
 * The two stores that ship are a keychain and `localStorage`, and both can be
 * unavailable rather than merely empty: a device that has booted and not been
 * unlocked, a private window, a browser set to block site data. Their adapters
 * swallow that and answer as if nothing were stored, so the case that has to
 * be proved here is that answering "nothing" is handled everywhere rather than
 * being an edge nobody walked.
 */

import { SessionManager, memoryTokenStore, type TokenStore } from '../session';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const token = (expiresAt: number, tier = 'full', subject = 'cus_1'): string =>
  `${Math.floor(expiresAt / 1000)}.${tier}.${subject}.signature`;

const live = token(NOW + 30 * 24 * HOUR);

/** A store that has nowhere to write, which every platform can genuinely be. */
const deadStore = (): TokenStore => ({
  read: async () => null,
  write: async () => {},
  clear: async () => {},
});

describe('the session a device holds', () => {
  it('is nothing before anybody signs in', async () => {
    const manager = new SessionManager(memoryTokenStore(), () => NOW);
    expect(await manager.current()).toBeNull();
  });

  it('is what the stored token says', async () => {
    const store = memoryTokenStore();
    await store.write(live);
    const session = await new SessionManager(store, () => NOW).current();
    expect(session?.claim.subject).toBe('cus_1');
    expect(session?.syncs).toBe(true);
  });

  it('survives a round trip through sign-in', async () => {
    const store = memoryTokenStore();
    const manager = new SessionManager(store, () => NOW);
    expect((await manager.signIn(live))?.syncs).toBe(true);
    expect((await manager.current())?.syncs).toBe(true);
    expect(await store.read()).toBe(live);
  });

  it('does not sync on the free tier, though it is still a session', async () => {
    const manager = new SessionManager(memoryTokenStore(), () => NOW);
    const session = await manager.signIn(token(NOW + HOUR, 'free'));
    expect(session).not.toBeNull();
    expect(session?.syncs).toBe(false);
  });

  it('refuses a token it cannot read rather than storing it', async () => {
    // Storing it would move the failure to the next launch, where there is no
    // longer anybody in front of the screen to tell.
    const store = memoryTokenStore();
    const manager = new SessionManager(store, () => NOW);
    expect(await manager.signIn('not-a-token')).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it('refuses one that has already expired', async () => {
    const manager = new SessionManager(memoryTokenStore(), () => NOW);
    expect(await manager.signIn(token(NOW - HOUR))).toBeNull();
  });
});

describe('a token that has stopped meaning anything', () => {
  it('is cleared on the way past, not merely ignored', async () => {
    // A credential still sitting on a phone that gets sold.
    const store = memoryTokenStore();
    await store.write(token(NOW + HOUR));
    const manager = new SessionManager(store, () => NOW + 2 * HOUR);

    expect(await manager.current()).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it('and so is one that was never readable', async () => {
    const store = memoryTokenStore();
    await store.write('rubbish');
    await new SessionManager(store, () => NOW).current();
    expect(await store.read()).toBeNull();
  });
});

describe('signing out', () => {
  it('forgets the token', async () => {
    const store = memoryTokenStore();
    const manager = new SessionManager(store, () => NOW);
    await manager.signIn(live);
    await manager.signOut();
    expect(await store.read()).toBeNull();
    expect(await manager.current()).toBeNull();
  });

  it('is safe with nothing to forget', async () => {
    const manager = new SessionManager(memoryTokenStore(), () => NOW);
    await expect(manager.signOut()).resolves.toBeUndefined();
  });
});

describe('a store with nowhere to write', () => {
  it('reads as signed out rather than throwing', async () => {
    const manager = new SessionManager(deadStore(), () => NOW);
    expect(await manager.current()).toBeNull();
  });

  it('lets a sign-in appear to work for as long as the process lasts', async () => {
    // The claim is real and the app can use it now; the next launch will ask
    // again. Better than refusing to sign in at all in a private window.
    const manager = new SessionManager(deadStore(), () => NOW);
    expect((await manager.signIn(live))?.syncs).toBe(true);
  });
});
