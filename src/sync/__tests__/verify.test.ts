/**
 * Checking a token, which is the whole of the gate.
 *
 * There is no user table and no session store behind this endpoint: the token
 * is the entire claim, so the difference between "verifies" and "parses" is the
 * difference between a paid feature and an open one. `src/auth/token.ts` parses
 * and says loudly that it proves nothing. This is the half that proves it, and
 * every test below is a way of getting past it that must not work.
 */

import { createHmac } from 'node:crypto';

import { bearerFrom, bucketFor, maySync, verifyToken } from '../verify';
import { readClaim } from '../../auth/token';

const NOW = 1_700_000_000_000;
const SECRET = 'a-gate-secret';
const OTHER = 'a-different-gate-secret';

const sign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const mint = ({ secret = SECRET, tier = 'full', subject = 'cus_QRS123', ttl = 2_592_000 } = {}) => {
  const payload = `${Math.floor(NOW / 1000) + ttl}.${tier}.${subject}`;
  return `${payload}.${sign(secret, payload)}`;
};

describe('verifying a token', () => {
  it('accepts one signed with the key', async () => {
    const claim = await verifyToken(SECRET, mint(), NOW);
    expect(claim).toMatchObject({ tier: 'full', subject: 'cus_QRS123' });
  });

  it('refuses one signed with another key', async () => {
    // The whole point. A token that parses is not a token that proves.
    const forged = mint({ secret: OTHER });
    expect(readClaim(forged, NOW)).not.toBeNull();
    expect(await verifyToken(SECRET, forged, NOW)).toBeNull();
  });

  it('refuses one with the signature cut off', async () => {
    const payload = mint().split('.').slice(0, 3).join('.');
    expect(await verifyToken(SECRET, `${payload}.`, NOW)).toBeNull();
    expect(await verifyToken(SECRET, payload, NOW)).toBeNull();
  });

  it('refuses one whose fields were edited after signing', async () => {
    // Raising your own tier is the attack this exists for.
    const [expiry, , subject, signature] = mint({ tier: 'free' }).split('.');
    expect(await verifyToken(SECRET, `${expiry}.full.${subject}.${signature}`, NOW)).toBeNull();
  });

  it('refuses one that has expired, even correctly signed', async () => {
    expect(await verifyToken(SECRET, mint({ ttl: -10 }), NOW)).toBeNull();
  });

  it('refuses everything when the secret is missing', async () => {
    // The state to leave a deploy in until there is something to sync.
    expect(await verifyToken('', mint(), NOW)).toBeNull();
  });

  it('refuses no token at all', async () => {
    expect(await verifyToken(SECRET, null, NOW)).toBeNull();
  });
});

describe('who may sync', () => {
  it('lets a paid subject through', async () => {
    expect(maySync(await verifyToken(SECRET, mint(), NOW))).toBe(true);
  });

  it('refuses the free tier', async () => {
    expect(maySync(await verifyToken(SECRET, mint({ tier: 'free' }), NOW))).toBe(false);
  });

  it('refuses a passcode, which is a door rather than a person', async () => {
    // Everybody who typed one shares this subject, so syncing them together
    // would pour every preview visitor's log into a single bucket.
    const claim = await verifyToken(SECRET, mint({ subject: 'passcode' }), NOW);
    expect(claim).not.toBeNull();
    expect(maySync(claim)).toBe(false);
  });

  it('refuses nobody at all', () => {
    expect(maySync(null)).toBe(false);
  });
});

describe('which bucket a log lives in', () => {
  it('is an HMAC, so the store never holds a customer id', async () => {
    const bucket = await bucketFor(SECRET, 'cus_QRS123');
    expect(bucket).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket).not.toContain('cus_');
  });

  it('is stable for one person and different for another', async () => {
    expect(await bucketFor(SECRET, 'cus_A')).toBe(await bucketFor(SECRET, 'cus_A'));
    expect(await bucketFor(SECRET, 'cus_A')).not.toBe(await bucketFor(SECRET, 'cus_B'));
  });

  it('moves when the key does, which is what rotating one is for', async () => {
    expect(await bucketFor(SECRET, 'cus_A')).not.toBe(await bucketFor(OTHER, 'cus_A'));
  });
});

describe('reading the header', () => {
  it('takes the token out of a bearer header', () => {
    expect(bearerFrom('Bearer abc.def')).toBe('abc.def');
    expect(bearerFrom('bearer abc.def')).toBe('abc.def');
  });

  it('refuses anything else', () => {
    for (const header of [null, undefined, '', 'abc.def', 'Basic abc', 'Bearer', 'Bearer a b']) {
      expect(bearerFrom(header)).toBeNull();
    }
  });
});
