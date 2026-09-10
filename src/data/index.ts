/**
 * The data layer's public entry point.
 *
 * Everything above this file asks for `getRepository()` and gets whichever
 * implementation the platform provides. This is also the one place the syncing
 * wrapper is composed in, which is what keeps sync out of every feature folder:
 * a screen asks for a repository and gets one, and whether it is talking to a
 * server is not a question it can ask.
 *
 * **The wrapper is only reached by somebody holding a token that syncs.** The
 * free app is the unwrapped local repository, exactly as it has always been,
 * for somebody who never types an email address. That is not a branch in a
 * screen, it is the absence of one.
 */

import { getSession, getToken, renewIfDue } from '../auth';
import { cursorStore } from '../sync/cursorStore';
import { SyncingRepository } from './SyncingRepository';
import { createRepository, STORAGE_ENGINE } from './repositoryFactory';
import { safeToCollect, type Repository } from './repository';

let pending: Promise<Repository> | null = null;

/**
 * The local database, opened once and kept across every recompose.
 *
 * Held apart from `pending` because it is the one part of the composition that
 * has nothing to do with who is signed in. `compose` used to call
 * `createRepository()` itself, so a recompose opened a second handle on the
 * same database and dropped the first without closing it -- and there is
 * nothing to close it with, since `Repository` has no `close`.
 *
 * Six sign-ins in one process left six handles open. All of them work and all
 * of them see each other's writes, because they are views onto one database
 * rather than copies of it, so nothing diverged; Dexie also closes a handle by
 * default when another connection wants to upgrade or delete, so a stale one
 * cannot block a migration either. What was left was a connection per sign-in
 * held for the life of the process, and a native SQLite handle is a file
 * descriptor rather than an object.
 *
 * Opening once is a smaller fix than a `close` on the interface and a driver
 * to implement it twice, and it is also the more honest shape: signing in
 * re-decides whether there is a wrapper, and was never a reason to reopen the
 * database underneath it.
 */
let opened: Promise<Repository> | null = null;

const openLocal = (): Promise<Repository> => {
  opened ??= createRepository().catch((error: unknown) => {
    // Same reasoning as `getRepository`: a failure to open must not be the
    // answer every later launch gets.
    opened = null;
    throw error;
  });
  return opened;
};

/**
 * The local repository, wrapped if this device holds a session that syncs.
 *
 * A failure to read the session is not a failure to open the app: the answer
 * is the local repository, which is the whole app minus one feature. Sync is
 * the thing that can be missing.
 */
const compose = async (): Promise<Repository> => {
  const local = await openLocal();
  try {
    const session = await getSession();
    if (session === null || !session.syncs) {
      // Nobody else is holding a copy, so this device collects on the window
      // alone. Without it, an app that never signs in keeps every tombstone
      // forever and grows where it used to shrink. Failing is not worth a
      // launch.
      //
      // **On the window alone only if the server is holding nothing of ours.**
      // This branch is two devices, not one. A device that has never signed in
      // is safe to sweep on the window, because nothing anywhere can send a
      // deleted row back to it. A device that has signed out is not: it may be
      // holding deletes it never managed to push while the bucket still has
      // the live rows, and that is the same hazard the tokenless branch below
      // refuses to sweep for. Signing out landed here and swept anyway.
      //
      // What separates them is `settled`, the newest moment before which the
      // server has heard everything this device wrote. Zero on a device that
      // never synced and on one whose bucket has been erased, which is what
      // makes both of those the ordinary case.
      void cursorStore
        .read()
        .then(({ settled }) =>
          local.collectTombstones(safeToCollect(settled, Date.now())),
        )
        .catch(() => undefined);
      return local;
    }

    const token = await getToken();
    if (token === null) {
      // A session that syncs but no token to sync with: an expired sign-in, or
      // a keychain that would not open. The local app, and **no sweep**.
      //
      // This is the one branch that used to fall through to the line above, and
      // it is the one place that sweep is unsafe: this device may be holding
      // tombstones it has never managed to push, and the server is still
      // holding the live rows. Dropping them here does not lose a delete
      // quietly -- it loses it loudly, on the next sync, when the rows this
      // person deleted come back down and land on every device they own.
      return local;
    }

    // And a token that is nearly out is replaced, here, because this is the
    // one thing that runs on every launch and holds a token while it does.
    // Thirty days was the whole life of a session until this line: on the
    // thirty-first, `current()` cleared the token, the branch above returned
    // the local repository, and nothing anywhere said why. Not awaited, for
    // the same reason as the push below, and it cannot take the launch with it
    // whatever it does.
    void renewIfDue();

    // A syncing device does not decide this for itself: the server draws the
    // line from every device it has heard from, and this one only knows about
    // itself. See `SyncingRepository`.
    // `getToken` rather than the string read above, so a renewal is picked up
    // by the next sync. A tab left open past thirty days used to go on sending
    // the token it was built with, get a 401, and halt for good with a
    // perfectly valid one in the store. See the constructor.
    const syncing = new SyncingRepository(local, getToken, cursorStore);

    // Whatever a sync brings down, the screens hear about. Wired here, on the
    // wrapper this call is building, so it is re-wired every recompose and the
    // one after a sign-in is not the one that gets missed. See `onSyncApplied`.
    let seen = 0;
    syncing.subscribe((state) => {
      if (state.applied === seen) return;
      seen = state.applied;
      for (const watcher of watchers) watcher();
    });

    // One pull on the way up, because otherwise a device that only reads never
    // syncs again. Every other sync in the app is the tail of a write, so a
    // laptop somebody signs in on, reads their history on, and never types into
    // would take its first answer and then stay on it for good -- which is the
    // one question this feature exists to answer, asked on the one device most
    // likely to ask it. Not awaited: the app opens on the local database and
    // whatever arrives, arrives.
    void syncing.push().catch(() => undefined);
    return syncing;
  } catch {
    return local;
  }
};

/**
 * Open (once) and return the repository. Concurrent callers during startup share
 * the same promise, so the database is never opened twice.
 */
export const getRepository = (): Promise<Repository> => {
  pending ??= compose().catch((error: unknown) => {
    // Clear the cache so a transient open failure can be retried rather than
    // permanently poisoning every later call.
    pending = null;
    throw error;
  });
  return pending;
};

/**
 * Compose again, because the session changed.
 *
 * Signing in has to reach the data layer somehow, and the alternative to this
 * is the data layer subscribing to the auth layer, which is a dependency in the
 * wrong direction for one event that happens twice in a lifetime.
 *
 * Only the composition. The database stays open: see `opened`.
 */
export const recomposeRepository = (): void => {
  pending = null;
};

/**
 * Sync because the app came back to the front, if there is anything to sync.
 *
 * The one trigger the engine did not have. Writes push, and a launch pulls
 * once, so the device that only reads -- the laptop with the tab open, the
 * phone that was in a pocket -- had no way back to the server for as long as
 * the process lived. See `SyncingRepository.resume`, which owns the question of
 * whether an arrival at the front is worth a request.
 *
 * Silent about all three of the ways there is nothing to do: nothing composed
 * yet, which means the launch pull has not run and will; a composition that
 * failed, which is not this call's to report; and a signed-out device, whose
 * repository is the plain local one and has no server to ask.
 */
export const syncOnResume = async (): Promise<void> => {
  if (pending === null) return;
  const repository = await pending.catch(() => null);
  if (repository instanceof SyncingRepository) await repository.resume();
};

/**
 * Told when a sync has changed the local database underneath the screens.
 *
 * Stable across a recompose, which is the whole reason it is here rather than
 * on the wrapper. Signing in builds a new `SyncingRepository`, and anything
 * subscribed to the old one would be listening to an object nothing writes to
 * any more -- on exactly the sync that matters most, the first one after a
 * sign-in.
 *
 * A pull writes rows straight into the local database. The store above holds
 * the arrays the screens render and reloads them only when the app asks it to,
 * so before this the history somebody had just signed in for arrived and then
 * sat there, invisible, until they quit and reopened. Which on a device that
 * has just been signed in on looks exactly like sync not working.
 */
const watchers = new Set<() => void>();

export const onSyncApplied = (listener: () => void): (() => void) => {
  watchers.add(listener);
  return () => watchers.delete(listener);
};

/** The syncing wrapper, when there is one. Settings asks; nothing else does. */
export const getSyncingRepository = async (): Promise<SyncingRepository | null> => {
  const repository = await getRepository();
  return repository instanceof SyncingRepository ? repository : null;
};

/** Test/dev hook: swap in another implementation. */
export const setRepository = (repository: Repository | null): void => {
  pending = repository === null ? null : Promise.resolve(repository);
};

export { STORAGE_ENGINE };
export { SyncingRepository } from './SyncingRepository';
export type { SyncState, Cursors } from './SyncingRepository';
export * from './repository';
