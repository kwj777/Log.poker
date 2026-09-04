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

import { getSession, getToken } from '../auth';
import { cursorStore } from '../sync/cursorStore';
import { SyncingRepository } from './SyncingRepository';
import { createRepository, STORAGE_ENGINE } from './repositoryFactory';
import { TOMBSTONE_RETENTION_MS, type Repository } from './repository';

let pending: Promise<Repository> | null = null;

/**
 * The local repository, wrapped if this device holds a session that syncs.
 *
 * A failure to read the session is not a failure to open the app: the answer
 * is the local repository, which is the whole app minus one feature. Sync is
 * the thing that can be missing.
 */
const compose = async (): Promise<Repository> => {
  const local = await createRepository();
  try {
    const session = await getSession();
    const token = session !== null && session.syncs ? await getToken() : null;
    if (token === null) {
      // Nothing to disagree with, so this device collects on the window alone.
      // Without it, an app that never signs in keeps every tombstone forever
      // and grows where it used to shrink. Failing is not worth a launch.
      void local
        .collectTombstones(Date.now() - TOMBSTONE_RETENTION_MS)
        .catch(() => undefined);
      return local;
    }
    // A syncing device does not decide this for itself: the server draws the
    // line from every device it has heard from, and this one only knows about
    // itself. See `SyncingRepository`.
    return new SyncingRepository(local, token, cursorStore);
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
 */
export const recomposeRepository = (): void => {
  pending = null;
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
