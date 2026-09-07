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

import { bearerFrom, bucketFor, checkToken, hasOwnBucket, verifyToken } from '../verify';
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

/**
 * The same gate, asked for a reason as well as an answer.
 *
 * All four are still a 401 on the wire. They exist so that the deploy log can
 * say which one, because on the day this endpoint is turned on the difference
 * between "the key here is not Untilt's key" and "nobody has signed in" is the
 * difference between an afternoon and a fortnight.
 */
describe('why a token was refused', () => {
  it('says nothing was sent', async () => {
    expect(await checkToken(SECRET, null, NOW)).toEqual({ refused: 'absent' });
  });

  it('says nothing was set, which is the same silence from this end', async () => {
    expect(await checkToken('', mint(), NOW)).toEqual({ refused: 'absent' });
  });

  it('says malformed for something that is not a token at all', async () => {
    expect(await checkToken(SECRET, 'hello', NOW)).toEqual({ refused: 'malformed' });
    expect(await checkToken(SECRET, `${mint()}.extra`, NOW)).toEqual({ refused: 'malformed' });
  });

  it('says signature when the key is the wrong key', async () => {
    // The one that matters. Every other symptom of a wrong `GATE_SECRET` is
    // indistinguishable from nobody having signed in.
    expect(await checkToken(SECRET, mint({ secret: OTHER }), NOW)).toEqual({
      refused: 'signature',
    });
  });

  it('says expired for a good token that has run out', async () => {
    expect(await checkToken(SECRET, mint({ ttl: -1 }), NOW)).toEqual({ refused: 'expired' });
  });

  it('and says signature, not expired, when both are wrong', async () => {
    // The expiry is one person's problem. The key is everybody's.
    expect(await checkToken(SECRET, mint({ secret: OTHER, ttl: -1 }), NOW)).toEqual({
      refused: 'signature',
    });
  });

  it('hands back the claim when there is nothing wrong with it', async () => {
    expect(await checkToken(SECRET, mint(), NOW)).toEqual({
      claim: { expiresAt: expect.any(Number), tier: 'full', subject: 'cus_QRS123' },
    });
  });

  it('and `verifyToken` is that answer with the reason dropped', async () => {
    // One place decides what a valid token is, so the gate and the log can
    // never come to different conclusions about the same request.
    expect(await verifyToken(SECRET, mint({ ttl: -1 }), NOW)).toBeNull();
    expect(await verifyToken(SECRET, mint(), NOW)).not.toBeNull();
  });
});

describe('who may sync', () => {
  it('lets a subject of their own through', async () => {
    expect(hasOwnBucket(await verifyToken(SECRET, mint(), NOW))).toBe(true);
  });

  it('lets the free tier through too, because sync is free', async () => {
    // The gate this replaces was `hasOwnBucket(claim) && claim.tier === 'full'`,
    // and a free tier got 403 on every write. Nothing is sold here any more, so
    // this is the assertion that would fail if a paid line came back.
    expect(hasOwnBucket(await verifyToken(SECRET, mint({ tier: 'free' }), NOW))).toBe(true);
  });

  it('refuses a passcode, which is a door rather than a person', async () => {
    // Everybody who typed one shares this subject, so syncing them together
    // would pour every preview visitor's log into a single bucket. The only
    // refusal left, and it was never a price.
    const claim = await verifyToken(SECRET, mint({ subject: 'passcode' }), NOW);
    expect(claim).not.toBeNull();
    expect(hasOwnBucket(claim)).toBe(false);
  });

  it('refuses nobody at all', () => {
    expect(hasOwnBucket(null)).toBe(false);
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
