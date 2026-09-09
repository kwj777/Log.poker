/**
 * Which repository a device gets, and the one sweep that is not always safe.
 *
 * `compose` cannot be imported here: it reaches the keychain and the native
 * database through three modules that have nothing to run in Node. So this
 * reads the file, the way `endpoint.test.ts` reads the function it cannot call.
 * The property is about control flow rather than about a value, which is the
 * kind a source-level check can actually pin.
 *
 * What it is pinning is a delete that comes back. A device with no token still
 * has a local database, and the local sweep exists so an app that never signs
 * in does not keep every tombstone it has ever written. But "no token" covers
 * two different devices: one that never syncs, and one that syncs and whose
 * sign-in has lapsed. The second may be holding tombstones it never managed to
 * push, and the server is still holding the live rows. Sweeping there loses the
 * deletes, and the next sync puts every one of those sessions back on every
 * device the person owns.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

/** Where a call is, so the branches can be compared rather than the imports. */
const at = (needle: string): number => {
  const index = source.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
};

describe('composing the repository', () => {
  it('sweeps on the window only for a session that does not sync', () => {
    const branch = at('if (session === null || !session.syncs)');
    const sweep = at('collectTombstones(Date.now() - TOMBSTONE_RETENTION_MS)');
    expect(branch).toBeLessThan(sweep);
    expect(sweep).toBeLessThan(at('await getToken()'));
  });

  it('does not sweep when the token is the thing that is missing', () => {
    // The branch this used to fall through to, and the only one where the
    // sweep can destroy a delete nobody else has heard about yet.
    const tokenless = source.slice(at('const token = await getToken();'),
                                   at('const syncing = new SyncingRepository('));
    expect(tokenless).toContain('return local;');
    expect(tokenless).not.toContain('collectTombstones');
  });

  it('renews a token that is nearly out, on the one path that runs every launch', () => {
    // Thirty days was the whole life of a session until this line. On the
    // thirty-first `current()` cleared the token, the tokenless branch above
    // returned the local repository, and nothing anywhere said why: no 401, no
    // `problem`, and the sign-in form back where it started.
    const renew = at('void renewIfDue();');
    expect(at('const token = await getToken();')).toBeLessThan(renew);
    expect(renew).toBeLessThan(at('void syncing.push()'));
  });

  it('tells the screens when a sync brings something down', () => {
    // A pull writes rows straight into the local database and the store above
    // holds what the screens render. Nothing connected the two, so the history
    // somebody had just signed in for sat there until they reopened the app.
    const wired = at('syncing.subscribe(');
    expect(at('const syncing = new SyncingRepository(')).toBeLessThan(wired);
    expect(source).toContain('state.applied === seen');
  });

  it('and wires that up on the wrapper it is building, not once and forever', () => {
    // Signing in builds a new wrapper. A subscription made once, outside this
    // function, would be listening to an object nothing writes to any more --
    // on exactly the sync that matters most, the first one after a sign-in.
    const composeBody = source.slice(at('const compose = async'), at('export const getRepository'));
    expect(composeBody).toContain('syncing.subscribe(');
    expect(source).toContain('export const onSyncApplied');
  });

  it('and never waits on it, because nothing in Log waits on the network', () => {
    // `void`, not `await`. A renewal that hung would hang the launch, and the
    // app opens on the local database whatever the network is doing.
    expect(source).toContain('void renewIfDue();');
    expect(source).not.toContain('await renewIfDue(');
  });

  it('sweeps in exactly one place, so there is only one branch to get right', () => {
    expect([...source.matchAll(/collectTombstones\(/g)]).toHaveLength(1);
  });

  it('leaves a syncing device to collect to the line the server drew', () => {
    // Not a rule this file applies: it hands the local repository to the
    // wrapper, and the wrapper collects to `collectedThrough` and no further.
    expect(source).toContain('new SyncingRepository(local, getToken, cursorStore)');
  });

  it('and hands it somewhere to ask for a token rather than one token', () => {
    // The string read above is a token as it was at launch. A renewal writes a
    // fresh one beside it, and a tab left open past thirty days went on
    // sending the old one, took a 401, and halted for good with a valid token
    // in the store. Nothing on screen would have said why.
    expect(source).toContain('new SyncingRepository(local, getToken, cursorStore)');
    expect(source).not.toContain('new SyncingRepository(local, token,');
  });

  it('pulls once on the way up, so a device nobody writes on still syncs', () => {
    // Every other sync in the app is the tail of a write. Without this, a
    // laptop signed in and only ever read from takes one answer and stays on
    // it, which is the one question the feature exists to answer.
    const started = source.slice(at('new SyncingRepository(local, getToken, cursorStore)'));
    expect(started).toMatch(/void syncing\.push\(\)/);
    expect(started.indexOf('void syncing.push()')).toBeLessThan(started.indexOf('return syncing;'));
  });
});

/**
 * And the other end of the same wire.
 *
 * Read rather than run, for the reason the file above is read rather than run:
 * `src/data/index.ts` reaches the native database through modules that have
 * nothing to execute in Node, so the store that imports it cannot be loaded
 * here either. What can be pinned is that the two ends exist and are joined.
 */
describe('the store listening for it', () => {
  const store = readFileSync(join(__dirname, '..', '..', 'store', 'useLogStore.ts'), 'utf8');

  it('subscribes when it hydrates, and reloads the log when told', () => {
    expect(store).toContain('onSyncApplied');
    expect(store).toContain('listen(() => void get().refresh());');
  });

  it('and only once, however many times the app hydrates', () => {
    // `hydrate` is called from a `useEffect`, which React runs twice in
    // development, and nothing here ever unsubscribes: the store outlives
    // every screen. A second listener is a second full reload of the log on
    // every answer, forever.
    expect(store).toContain('let listening = false;');
    expect(store).toMatch(/if \(listening\) return;\s*listening = true;/);
  });
});
