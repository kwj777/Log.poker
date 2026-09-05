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

  it('sweeps in exactly one place, so there is only one branch to get right', () => {
    expect([...source.matchAll(/collectTombstones\(/g)]).toHaveLength(1);
  });

  it('leaves a syncing device to collect to the line the server drew', () => {
    // Not a rule this file applies: it hands the local repository to the
    // wrapper, and the wrapper collects to `collectedThrough` and no further.
    expect(source).toContain('new SyncingRepository(local, token, cursorStore)');
  });

  it('pulls once on the way up, so a device nobody writes on still syncs', () => {
    // Every other sync in the app is the tail of a write. Without this, a
    // laptop signed in and only ever read from takes one answer and stays on
    // it, which is the one question the feature exists to answer.
    const started = source.slice(at('new SyncingRepository(local, token, cursorStore)'));
    expect(started).toMatch(/void syncing\.push\(\)/);
    expect(started.indexOf('void syncing.push()')).toBeLessThan(started.indexOf('return syncing;'));
  });
});
