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

import { RENEW_WITHIN_MS, dueForRenewal, paidForSync, SUBJECT_PASSCODE, SYNC_NEEDS_PASS, syncIsPaidFor, TIERS, hasOwnSubject, readClaim, type Claim, type Tier } from '../token';

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
    subject = 'log_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
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
      subject: 'log_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
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
    const payload = `${Math.floor((NOW + 3_600_000) / 1000)}.admin.log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4`;
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
      const payload = `${expiry}.full.log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4`;
      expect(readClaim(`${payload}.${sign(payload)}`, NOW)).toBeNull();
    }
  });

  it('reads a token whose signature is wrong, and says so in the name', () => {
    // Not an oversight, and worth pinning so that nobody later reads a claim
    // as proof of anything. This side has no key. The server checks.
    const payload = `${Math.floor((NOW + 3_600_000) / 1000)}.full.log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4`;
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

/**
 * When to ask for a new token, which is the app's half of the renewal.
 *
 * Ten days of thirty. Wide enough that a device opened once a week renews long
 * before it runs out, narrow enough that this is not something every launch
 * does.
 */
describe('whether a token is due to be replaced', () => {
  const NOW = 1_700_000_000_000;
  const claimAt = (expiresAt: number) => ({ expiresAt, tier: 'free' as const, subject: 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' });

  it('is not, with most of the month still on it', () => {
    expect(dueForRenewal(claimAt(NOW + RENEW_WITHIN_MS + 60_000), NOW)).toBe(false);
  });

  it('is, once inside the window', () => {
    expect(dueForRenewal(claimAt(NOW + RENEW_WITHIN_MS), NOW)).toBe(true);
    expect(dueForRenewal(claimAt(NOW + 60_000), NOW)).toBe(true);
  });

  it('is not, once it has already run out', () => {
    // A renewal cannot resurrect one and the server refuses it, so asking
    // would only be a request that fails.
    expect(dueForRenewal(claimAt(NOW), NOW)).toBe(false);
    expect(dueForRenewal(claimAt(NOW - 1), NOW)).toBe(false);
  });

  it('and is not, for no claim at all', () => {
    expect(dueForRenewal(null, NOW)).toBe(false);
  });
});

describe('what sync costs', () => {
  const claimOf = (tier: Tier): Claim => ({
    expiresAt: 1_800_000_000_000,
    tier,
    subject: 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
  });

  it('is nothing today, for everybody, whatever their tier says', () => {
    /**
     * The claim the whole feature rests on. `SYNC_NEEDS_PASS` is false because
     * this app cannot yet find out who has paid: its own door mints the free
     * tier for every sign-in and refuses to renew anything else, so a live
     * gate would refuse sync to the people who signed in here, buyers
     * included. Written out rather than read off the constant, so a change to
     * it has to change a test that says so.
     */
    expect(SYNC_NEEDS_PASS).toBe(false);
    expect(paidForSync(claimOf('free'))).toBe(true);
    expect(paidForSync(claimOf('full'))).toBe(true);
    expect(paidForSync(null)).toBe(true);
  });

  it('is the pass, when the switch says so', () => {
    expect(syncIsPaidFor(true, claimOf('full'))).toBe(true);
    expect(syncIsPaidFor(true, claimOf('free'))).toBe(false);
    expect(syncIsPaidFor(true, null)).toBe(false);
  });

  it('and is nothing when it does not, which is the same rule read twice', () => {
    for (const tier of TIERS) expect(syncIsPaidFor(false, claimOf(tier))).toBe(true);
    expect(syncIsPaidFor(false, null)).toBe(true);
  });

  it('answers whatever the switch is set to, so the two cannot drift', () => {
    // The one assertion tying the bound form to the rule. Without it the
    // constant could be flipped and `paidForSync` go on ignoring it.
    for (const tier of TIERS) {
      expect(paidForSync(claimOf(tier))).toBe(syncIsPaidFor(SYNC_NEEDS_PASS, claimOf(tier)));
    }
  });
});
