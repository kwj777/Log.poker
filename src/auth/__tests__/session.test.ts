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

const token = (expiresAt: number, tier = 'full', subject = 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'): string =>
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
    expect(session?.claim.subject).toBe('log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4');
    expect(session?.syncs).toBe(true);
  });

  it('survives a round trip through sign-in', async () => {
    const store = memoryTokenStore();
    const manager = new SessionManager(store, () => NOW);
    expect((await manager.signIn(live))?.syncs).toBe(true);
    expect((await manager.current())?.syncs).toBe(true);
    expect(await store.read()).toBe(live);
  });

  it('syncs on the free tier, because cross-device history is free', async () => {
    // The inverse of this was asserted while sync was sold. Left pointing the
    // other way rather than deleted: the free tier is the only tier that can
    // notice a paid line coming back.
    const manager = new SessionManager(memoryTokenStore(), () => NOW);
    const session = await manager.signIn(token(NOW + HOUR, 'free'));
    expect(session).not.toBeNull();
    expect(session?.syncs).toBe(true);
  });

  it('does not sync on a shared passcode, which is the one case left', async () => {
    // Everybody who typed one carries the same subject, so their logs would
    // merge into a single bucket. The only reason `syncs` is ever false now.
    const manager = new SessionManager(memoryTokenStore(), () => NOW);
    const session = await manager.signIn(token(NOW + HOUR, 'full', 'passcode'));
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

/**
 * The case where the platform will not keep it: a private window, a browser
 * set to block site data, a phone booted and not yet unlocked.
 *
 * Signing in has to go on working there, for the process, rather than being
 * refused. What it must not do is *look* like it worked: a `TokenStore` cannot
 * report a failed write, so a sign-in that only read its own return value said
 * yes while every other part of the app -- the repository it composes, the
 * token it sends, the launch after it -- said no.
 *
 * So each test here asks what the app can do next, rather than what `signIn`
 * answered. That distinction is the bug.
 */
describe('a store with nowhere to write', () => {
  it('reads as signed out rather than throwing', async () => {
    const manager = new SessionManager(deadStore(), () => NOW);
    expect(await manager.current()).toBeNull();
  });

  it('keeps a sign-in for as long as the process lasts', async () => {
    const manager = new SessionManager(deadStore(), () => NOW);

    expect((await manager.signIn(live))?.syncs).toBe(true);
    // What `recomposeRepository` asks, and what the sync client sends. Both
    // answered null while the card said signed in.
    expect((await manager.current())?.syncs).toBe(true);
    expect(await manager.token()).toBe(live);
  });

  it('and asks again on the next launch, because that is all it promised', async () => {
    const store = deadStore();
    await new SessionManager(store, () => NOW).signIn(live);
    expect(await new SessionManager(store, () => NOW).current()).toBeNull();
  });

  it('forgets it on the way out, with nowhere to clear', async () => {
    const manager = new SessionManager(deadStore(), () => NOW);
    await manager.signIn(live);
    await manager.signOut();
    expect(await manager.current()).toBeNull();
    expect(await manager.token()).toBeNull();
  });

  it('stops serving it the moment it runs out', async () => {
    let now = NOW;
    const manager = new SessionManager(deadStore(), () => now);
    await manager.signIn(live);

    now = NOW + 31 * 24 * HOUR;
    expect(await manager.current()).toBeNull();
    // And is gone rather than merely refused, the same as a stored one.
    now = NOW;
    expect(await manager.current()).toBeNull();
  });

  it('renews into it as well, so a long session does not end on a timer', async () => {
    const DAY = 24 * HOUR;
    const nearlyOut = token(NOW + 3 * DAY, 'free');
    const fresh = token(NOW + 30 * DAY, 'free');
    const manager = new SessionManager(deadStore(), () => NOW);
    await manager.signIn(nearlyOut);

    expect(await manager.renewIfDue(async () => fresh)).toBe(true);
    expect(await manager.token()).toBe(fresh);
  });

  it('is not reached at all by a store that works', async () => {
    // The tripwire against holding every token in memory regardless. A store
    // that kept it is the only thing holding it, so emptying the store behind
    // this class's back is a device that is signed out -- which is what
    // clearing the site data in another tab really is.
    const store = memoryTokenStore();
    const manager = new SessionManager(store, () => NOW);
    await manager.signIn(live);

    await store.clear();
    expect(await manager.current()).toBeNull();
  });
});

/**
 * Replacing a token before it runs out.
 *
 * Every test here is really the same test: **the token that was there is still
 * there.** A renewal is a network request made at launch, on behalf of a
 * credential that is still perfectly good, and the one way it can do damage is
 * by throwing that credential away when the request does not work out. That is
 * the shape of every "signed me out for no reason" bug there is.
 */
describe('renewing before it runs out', () => {
  const DAY = 24 * HOUR;
  const nearlyOut = token(NOW + 3 * DAY, 'free', 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4');
  const fresh = token(NOW + 30 * DAY, 'free', 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4');

  const held = async (store: TokenStore) => store.read();

  it('asks, and keeps what comes back', async () => {
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const manager = new SessionManager(store, () => NOW);

    const asked: string[] = [];
    const wrote = await manager.renewIfDue(async (sent) => {
      asked.push(sent);
      return fresh;
    });

    expect(wrote).toBe(true);
    expect(asked).toEqual([nearlyOut]);
    expect(await held(store)).toBe(fresh);
  });

  it('does not ask at all while there is most of a month left', async () => {
    const store = memoryTokenStore();
    await store.write(live);
    let asked = 0;
    const wrote = await new SessionManager(store, () => NOW).renewIfDue(async () => {
      asked += 1;
      return fresh;
    });

    expect(wrote).toBe(false);
    expect(asked).toBe(0);
    expect(await held(store)).toBe(live);
  });

  it('keeps the token when the ask comes back with nothing', async () => {
    // A refusal, or a dead network. There are days of window left and every
    // launch is another try.
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const wrote = await new SessionManager(store, () => NOW).renewIfDue(async () => null);

    expect(wrote).toBe(false);
    expect(await held(store)).toBe(nearlyOut);
  });

  it('and when what comes back is not a token this side can read', async () => {
    // Replacing a good token with one the next launch would clear is worse
    // than not renewing at all.
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const wrote = await new SessionManager(store, () => NOW).renewIfDue(async () => 'not-a-token');

    expect(wrote).toBe(false);
    expect(await held(store)).toBe(nearlyOut);
  });

  it('does not ask for one that has already run out, and does not clear it either', async () => {
    // The server refuses an expired token, so asking is a request that fails.
    // Clearing is `current()`'s job and only its job: a renewal is not a
    // session check, and one that quietly signed somebody out would be a
    // renewal that did the exact thing it exists to prevent.
    const store = memoryTokenStore();
    const dead = token(NOW - HOUR, 'free', 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4');
    await store.write(dead);
    let asked = 0;
    const wrote = await new SessionManager(store, () => NOW).renewIfDue(async () => {
      asked += 1;
      return fresh;
    });

    expect(wrote).toBe(false);
    expect(asked).toBe(0);
    expect(await held(store)).toBe(dead);
  });

  it('and does nothing at all when nobody has signed in', async () => {
    let asked = 0;
    const wrote = await new SessionManager(memoryTokenStore(), () => NOW).renewIfDue(async () => {
      asked += 1;
      return fresh;
    });

    expect(wrote).toBe(false);
    expect(asked).toBe(0);
  });

  it('does not sign the device back in when a sign-out lands mid-renewal', async () => {
    // The renewal fires at launch and is not awaited, so the seconds it spends
    // on the network are seconds somebody can spend tapping Sign out. Writing
    // afterwards put the token back, with a fresh thirty days on it, and
    // nothing on screen said why the device was signed in again.
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const manager = new SessionManager(store, () => NOW);

    let arrive: (() => void) | null = null;
    const renewal = manager.renewIfDue(
      async () =>
        new Promise<string>((resolve) => {
          arrive = () => resolve(fresh);
        }),
    );
    for (let spin = 0; spin < 50 && arrive === null; spin += 1) await Promise.resolve();

    await manager.signOut();
    (arrive as unknown as () => void)();

    expect(await renewal).toBe(false);
    expect(await held(store)).toBeNull();
    expect(await manager.current()).toBeNull();
  });

  it('and not when the erase signs out mid-renewal either, which is the same path', async () => {
    // Worse there: the bucket has just been deleted, so putting the token back
    // signs the device in to something that is not there any more.
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const manager = new SessionManager(store, () => NOW);

    let arrive: (() => void) | null = null;
    const renewal = manager.renewIfDue(
      async () =>
        new Promise<string>((resolve) => {
          arrive = () => resolve(fresh);
        }),
    );
    for (let spin = 0; spin < 50 && arrive === null; spin += 1) await Promise.resolve();

    // What `erase` does: the server copy goes, then the token.
    await manager.signOut();
    (arrive as unknown as () => void)();
    await renewal;

    expect(await held(store)).toBeNull();
  });

  it('and does not overwrite a token somebody signed in with while it was out', async () => {
    // Two people, one device. The renewal read the first one's token; by the
    // time it answered, the second had signed in. Writing would hand the
    // device back to the person who had left it.
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const manager = new SessionManager(store, () => NOW);

    let arrive: (() => void) | null = null;
    const renewal = manager.renewIfDue(
      async () =>
        new Promise<string>((resolve) => {
          arrive = () => resolve(fresh);
        }),
    );
    for (let spin = 0; spin < 50 && arrive === null; spin += 1) await Promise.resolve();

    const theirs = token(NOW + 30 * DAY, 'free', 'log_e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5');
    await manager.signOut();
    await manager.signIn(theirs);
    (arrive as unknown as () => void)();

    expect(await renewal).toBe(false);
    expect(await held(store)).toBe(theirs);
  });

  it('and is fenced from the moment sign-out is asked for, not when it finishes', async () => {
    // The counter moves before the clear it is waiting on. A keychain write is
    // not instant, and a renewal answering inside a sign-out that has started
    // but not landed would look at a store that still held the old token,
    // compare it happily, and write over the top of somebody leaving.
    //
    // This is the test that tells the two orderings apart: the sign-out is
    // held open at the clear while the renewal answers.
    let letClearFinish: (() => void) | null = null;
    const slow: TokenStore = {
      ...memoryTokenStore(),
      read: async () => held(store),
      write: async (value) => void (await store.write(value)),
      clear: async () => {
        await new Promise<void>((resolve) => {
          letClearFinish = resolve;
        });
        await store.clear();
      },
    };
    const store = memoryTokenStore();
    await store.write(nearlyOut);
    const manager = new SessionManager(slow, () => NOW);

    let arrive: (() => void) | null = null;
    const renewal = manager.renewIfDue(
      async () =>
        new Promise<string>((resolve) => {
          arrive = () => resolve(fresh);
        }),
    );
    for (let spin = 0; spin < 50 && arrive === null; spin += 1) await Promise.resolve();

    const leaving = manager.signOut();
    for (let spin = 0; spin < 50 && letClearFinish === null; spin += 1) await Promise.resolve();

    // The renewal answers while the sign-out is still in the store's hands.
    (arrive as unknown as () => void)();
    expect(await renewal).toBe(false);

    (letClearFinish as unknown as () => void)();
    await leaving;
    expect(await held(store)).toBeNull();
  });

  it('and survives a store with nowhere to read from', async () => {
    expect(await new SessionManager(deadStore(), () => NOW).renewIfDue(async () => fresh)).toBe(
      false,
    );
  });
});
