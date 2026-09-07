/**
 * The token grammar, checked against tokens that are actually signed.
 *
 * The fixtures below are minted here with the same HMAC-SHA256 over the same
 * three fields that Untilt's `lib/access.js` signs, rather than typed out by
 * hand. A hand-typed fixture only ever proves that the parser agrees with
 * whoever typed it, which is the failure mode worth avoiding when the format
 * belongs to another repository.
 *
 * Nothing here asserts that a signature is *checked*, because this side cannot
 * check one and must not pretend to. See the note at the top of `token.ts`.
 */

import { createHmac } from 'node:crypto';

import { SUBJECT_PASSCODE, TIERS, hasOwnSubject, readClaim, type Tier } from '../token';

const NOW = 1_700_000_000_000;
const SECRET = 'test-gate-secret';

/** Untilt's `sign`: base64url of the HMAC, with the padding stripped. */
const sign = (payload: string): string =>
  createHmac('sha256', SECRET)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const mint = (
  {
    tier = 'full' as Tier,
    subject = 'cus_QRSTUV123',
    expiresAt = NOW + 30 * 24 * 3_600_000,
  } = {},
): string => {
  const payload = `${Math.floor(expiresAt / 1000)}.${tier}.${subject}`;
  return `${payload}.${sign(payload)}`;
};

describe('reading a token', () => {
  it('reads a real one', () => {
    const claim = readClaim(mint(), NOW);
    expect(claim).toEqual({
      expiresAt: NOW + 30 * 24 * 3_600_000,
      tier: 'full',
      subject: 'cus_QRSTUV123',
    });
  });

  it('converts the expiry out of seconds', () => {
    // The token counts in seconds and every other timestamp in this app counts
    // in milliseconds, which is a difference of a factor of a thousand and
    // therefore of about fifty years if it goes unnoticed.
    const claim = readClaim(mint({ expiresAt: NOW + 3_600_000 }), NOW);
    expect(claim?.expiresAt).toBe(NOW + 3_600_000);
    expect(claim?.expiresAt).toBeGreaterThan(NOW);
  });

  it('reads both tiers', () => {
    for (const tier of TIERS) {
      expect(readClaim(mint({ tier }), NOW)?.tier).toBe(tier);
    }
  });

  it('refuses one that has expired', () => {
    expect(readClaim(mint({ expiresAt: NOW - 1000 }), NOW)).toBeNull();
  });

  it('refuses one expiring exactly now, rather than racing it', () => {
    const expiresAt = NOW + 1000;
    expect(readClaim(mint({ expiresAt }), expiresAt)).toBeNull();
  });

  it('refuses null, so a store with nothing in it needs no special case', () => {
    expect(readClaim(null, NOW)).toBeNull();
  });

  it('refuses anything that is not four fields', () => {
    for (const wrong of ['', 'nonsense', 'a.b.c', 'a.b.c.d.e', mint().replace('.', '')]) {
      expect(readClaim(wrong, NOW)).toBeNull();
    }
  });

  it('refuses a tier this build does not know', () => {
    const payload = `${Math.floor((NOW + 3_600_000) / 1000)}.admin.cus_1`;
    expect(readClaim(`${payload}.${sign(payload)}`, NOW)).toBeNull();
  });

  it('refuses a subject with a separator in it', () => {
    // The attack the narrow subject pattern exists for: a dot in the subject
    // would shift every field along and be read as a different claim.
    const payload = `${Math.floor((NOW + 3_600_000) / 1000)}.free.cus.full`;
    expect(readClaim(`${payload}.${sign(payload)}`, NOW)).toBeNull();
  });

  it('refuses a subject that is empty or too long', () => {
    for (const subject of ['', 'x'.repeat(65)]) {
      expect(readClaim(mint({ subject }), NOW)).toBeNull();
    }
  });

  it('refuses an expiry that is not a plain number', () => {
    for (const expiry of ['-1', '1e9', '12345678901234', 'soon']) {
      const payload = `${expiry}.full.cus_1`;
      expect(readClaim(`${payload}.${sign(payload)}`, NOW)).toBeNull();
    }
  });

  it('reads a token whose signature is wrong, and says so in the name', () => {
    // Not an oversight, and worth pinning so that nobody later reads a claim
    // as proof of anything. This side has no key. The server checks.
    const payload = `${Math.floor((NOW + 3_600_000) / 1000)}.full.cus_1`;
    expect(readClaim(`${payload}.not-a-real-signature`, NOW)).not.toBeNull();
  });
});

describe('what a claim is worth', () => {
  it('gives cross-device history to a subject of their own', () => {
    expect(hasOwnSubject(readClaim(mint({ tier: 'full' }), NOW))).toBe(true);
  });

  it('gives it to the free tier too, because sync is free', () => {
    // This is the assertion, not a variant of the one above. Cross-device
    // history was gated on `tier === 'full'` and is not gated on anything a
    // purchase decides any more, and the free tier is the only way to notice
    // if that ever comes back.
    expect(hasOwnSubject(readClaim(mint({ tier: 'free' }), NOW))).toBe(true);
  });

  it('reads the same for every tier the grammar allows', () => {
    // Stronger than the two above and cheap: whatever Untilt puts in that
    // field, it cannot be what decides this.
    for (const tier of TIERS) {
      expect(hasOwnSubject(readClaim(mint({ tier }), NOW))).toBe(true);
    }
  });

  it('withholds it from a passcode, which is a door rather than a person', () => {
    // Every passcode holder shares this subject, so syncing them would pour
    // every preview visitor's history into one bucket. The one refusal that
    // survived making this free, because it was never about money.
    const claim = readClaim(mint({ tier: 'full', subject: SUBJECT_PASSCODE }), NOW);
    expect(claim).not.toBeNull();
    expect(hasOwnSubject(claim)).toBe(false);
  });

  it('withholds it from nobody at all', () => {
    expect(hasOwnSubject(null)).toBe(false);
  });
});
