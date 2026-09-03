/**
 * The two ends agreeing about where the endpoint is.
 *
 * The client and the function are in one repository and still have two
 * separate ideas of the URL, which is exactly the kind of pair that drifts: a
 * path changed in one file and not the other is a 404 that no type checker and
 * no unit test would notice, on a feature nobody exercises until it is live.
 *
 * The function itself is not run here. It is the thin part, and everything in
 * it with a rule attached lives in `bundle.ts` and `verify.ts`, which are.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SYNC_URL } from '../client';

const source = readFileSync(
  join(__dirname, '..', '..', '..', 'netlify', 'functions', 'sync.mts'),
  'utf8',
);

describe('the sync endpoint', () => {
  it('answers where the client asks', () => {
    expect(new URL(SYNC_URL).pathname).toBe('/api/sync');
    expect(source).toContain("export const config = { path: '/api/sync' };");
  });

  it('is on Log, not on the host that mints the token', () => {
    // Same origin as the web app, which is what makes this free of CORS and
    // of a preflight. Worth pinning: the way to make it cross-origin later is
    // to think about it, not to notice it already works.
    expect(new URL(SYNC_URL).origin).toBe('https://log.poker');
  });

  it('refuses everything without a key to check tokens with', () => {
    expect(source).toContain("process.env.GATE_SECRET");
    expect(source).toMatch(/if \(!secret\)[\s\S]{0,200}503/);
  });

  it('checks the signature and the entitlement separately', () => {
    // 401 and 403 mean different things to the loop: one is sign in again, the
    // other is this is paid. Collapsing them would make the client retry
    // forever against an answer that will never change.
    expect(source).toMatch(/verifyToken[\s\S]{0,200}401/);
    expect(source).toMatch(/maySync[\s\S]{0,200}403/);
  });

  it('never reaches the store before it has authorized the request', () => {
    // Call sites, not imports: the two are in the opposite order at the top of
    // the file, which is how the first version of this test passed by accident.
    const opened = source.indexOf("getStore('log-sync')");
    expect(opened).toBeGreaterThan(-1);
    expect(source.indexOf('await verifyToken(')).toBeLessThan(opened);
    expect(source.indexOf('if (!maySync(claim))')).toBeLessThan(opened);
  });

  it('keys the bucket by an HMAC rather than by the subject', () => {
    expect(source).toContain('bucketFor(secret, claim.subject)');
    expect(source).not.toMatch(/getStore\([^)]*subject/);
  });

  it('tells the device how far back it has collected', () => {
    // Without it the device keeps its tombstones forever, which is the safe
    // failure and still a growing database.
    expect(source).toContain('collectedThrough: merged.collectedThrough');
  });

  it('names the device so the merge knows who is still waiting', () => {
    expect(source).toMatch(/typeof device === 'string' \? device : null/);
  });

  it('caps the body, and reads the stream rather than the declared length', () => {
    expect(source).toContain('MAX_BODY');
    expect(source).toContain('reader.cancel()');
  });

  it('treats a failed read as a failure rather than as an empty bucket', () => {
    // The worst available bug: an unreadable store looks like a new customer,
    // and the merge that follows would replace their whole history with one
    // device's view of it.
    expect(source).toMatch(/bucket read failed[\s\S]{0,120}503/);
  });

  it('answers no cache, and varies on the header that decides who it is', () => {
    expect(source).toContain("'Cache-Control': 'private, no-store, must-revalidate'");
    expect(source).toContain("Vary: 'Authorization'");
  });
});
