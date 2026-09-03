/**
 * The web store, which is the only one of the two adapters Node can run.
 *
 * `localStorage` is not merely empty when it is unavailable, it throws on
 * access, and it does not exist at all during the static export that
 * prerenders the app's shell. Both are ordinary rather than exceptional, so
 * both are exercised here: the adapter's whole job is to turn them into the
 * same answer as never having signed in.
 *
 * The keychain adapter has no test. It is the same dozen lines against
 * `expo-secure-store`, which is a native module with nothing to run in Node,
 * and it is excluded from coverage for the same reason `expoSqliteDriver` is.
 */

const KEY = 'family_access_token';

/** Installed on `globalThis` before the module under test reads it. */
const install = (impl: Partial<Storage> | null): void => {
  if (impl === null) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    return;
  }
  (globalThis as { localStorage?: unknown }).localStorage = impl;
};

const realish = (): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  } as unknown as Storage;
};

const throwing = (): Storage =>
  ({
    getItem: () => {
      throw new DOMException('blocked');
    },
    setItem: () => {
      throw new DOMException('blocked');
    },
    removeItem: () => {
      throw new DOMException('blocked');
    },
  }) as unknown as Storage;

const load = async () => {
  jest.resetModules();
  return (await import('../tokenStore.web')).tokenStore;
};

afterEach(() => install(null));

describe('with storage that works', () => {
  it('round-trips a token', async () => {
    install(realish());
    const store = await load();
    await store.write('a.b.c.d');
    expect(await store.read()).toBe('a.b.c.d');
  });

  it('clears it', async () => {
    install(realish());
    const store = await load();
    await store.write('a.b.c.d');
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('reads null before anything is written', async () => {
    install(realish());
    expect(await (await load()).read()).toBeNull();
  });

  it('keeps it under a key named for the family rather than this app', async () => {
    // All three apps share one token; a Log-specific key would mean signing in
    // three times for one purchase.
    const storage = realish();
    install(storage);
    await (await load()).write('a.b.c.d');
    expect(storage.getItem(KEY)).toBe('a.b.c.d');
  });
});

describe('with no storage at all', () => {
  it('reads as signed out during a prerender', async () => {
    install(null);
    expect(await (await load()).read()).toBeNull();
  });

  it('lets a write go nowhere without throwing', async () => {
    install(null);
    const store = await load();
    await expect(store.write('a.b.c.d')).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('with storage that throws on access', () => {
  it('reads as signed out in a private window', async () => {
    install(throwing());
    expect(await (await load()).read()).toBeNull();
  });

  it('swallows a blocked write, because the app is not the storage', async () => {
    install(throwing());
    const store = await load();
    await expect(store.write('a.b.c.d')).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
