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

import {
  SUBJECT_PREFIX,
  TOKEN_TTL_MS,
  bearerFrom,
  bucketFor,
  checkToken,
  hasOwnBucket,
  LEGACY_SIGNATURES_UNTIL,
  mintToken,
  normalizeEmail,
  subjectForEmail,
  verifyToken,
} from '../verify';
import { OWN_SUBJECT, hasOwnSubject, readClaim, SUBJECT_PASSCODE } from '../../auth/token';

const NOW = 1_700_000_000_000;
const SECRET = 'a-gate-secret';
const OTHER = 'a-different-gate-secret';

const sign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/*
  Built here rather than through `mintToken`, and the prefix is spelled out
  rather than imported. The preimage is the half of the format another
  repository has to agree with byte for byte: Untilt signs the same string in
  `lib/access.js`, and a helper that asked the minter what it had done would
  agree with whatever the minter had been changed to, which is the failure
  these tests exist to catch.
*/
const mint = ({ secret = SECRET, tier = 'full', subject = 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', ttl = 2_592_000, at = NOW } = {}) => {
  const payload = `${Math.floor(at / 1000) + ttl}.${tier}.${subject}`;
  return `${payload}.${sign(secret, `family.${payload}`)}`;
};

/** The same token signed the way this app signed before domain separation. */
const legacyMint = ({ secret = SECRET, tier = 'full', subject = 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', ttl = 2_592_000, at = NOW } = {}) => {
  const payload = `${Math.floor(at / 1000) + ttl}.${tier}.${subject}`;
  return `${payload}.${sign(secret, payload)}`;
};

describe('verifying a token', () => {
  it('accepts one signed with the key', async () => {
    const claim = await verifyToken(SECRET, mint(), NOW);
    expect(claim).toMatchObject({ tier: 'full', subject: 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' });
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
 * What the signature is taken over, which is the only difference between a
 * token the family passes around and the cookie that opens `untilt.poker`.
 *
 * The wire shape is identical and is meant to be: four dot-separated fields in
 * the same order, so nothing that parses one has to learn about the other. So
 * nothing observable is being asserted here except the one thing that is not
 * observable, which is why these build the preimage by hand rather than asking
 * the minter what it did.
 */
describe('the preimage a token signs', () => {
  const SUBJECT = 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
  const payloadOf = (token: string): string => token.split('.').slice(0, 3).join('.');

  it('is `family.` and the three fields, which is the string Untilt signs too', async () => {
    const token = await mintToken(SECRET, { subject: SUBJECT, tier: 'full', expiresAt: NOW + TOKEN_TTL_MS });
    expect(token).toBe(`${payloadOf(token)}.${sign(SECRET, `family.${payloadOf(token)}`)}`);
  });

  it('so a token this door mints is not also a cookie for untilt.poker', async () => {
    // The collision this closes, and it was a real one rather than a
    // theoretical one: Untilt's cookie signs the fields alone, and its subject
    // pattern admits a `log_` subject unchanged, so for the same person at the
    // same moment the two were the same bytes.
    const token = await mintToken(SECRET, { subject: SUBJECT, tier: 'full', expiresAt: NOW + TOKEN_TTL_MS });
    expect(token.split('.')[3]).not.toBe(sign(SECRET, payloadOf(token)));
  });

  it('and a cookie signed the other way is refused once the window has closed', async () => {
    expect(await verifyToken(SECRET, legacyMint(), LEGACY_SIGNATURES_UNTIL)).toBeNull();
  });

  it('which is a refusal about the signature, not about who it names', async () => {
    // Worth pinning apart, because the deploy log is the only thing anybody
    // reads here and `signature` is the line that sends somebody to check a
    // key. A subject this door would happily mint still fails on the preimage.
    expect(await checkToken(SECRET, legacyMint({ at: LEGACY_SIGNATURES_UNTIL }), LEGACY_SIGNATURES_UNTIL))
      .toEqual({ refused: 'signature' });
  });
});

/**
 * The window in which the old preimage still counts.
 *
 * Every token carrying it is one this door minted, and they all run out within
 * `TOKEN_TTL_MS` of the change landing, so the window is a way of not signing
 * anybody out for something they did not do. It closes on a date rather than
 * on somebody remembering, which is the whole reason it can be trusted to
 * close at all.
 */
describe('the legacy window', () => {
  const JUST_INSIDE = LEGACY_SIGNATURES_UNTIL - 1000;

  it('takes a token signed the old way while it is open', async () => {
    const token = legacyMint({ at: JUST_INSIDE - TOKEN_TTL_MS + 60_000 });
    expect(await verifyToken(SECRET, token, JUST_INSIDE)).toMatchObject({ tier: 'full' });
  });

  it('and refuses the same token one second later, when it has closed', async () => {
    // The same bytes, unexpired, under the same key. Only the clock moved.
    const token = legacyMint({ at: JUST_INSIDE - TOKEN_TTL_MS + 60_000 });
    expect(await verifyToken(SECRET, token, LEGACY_SIGNATURES_UNTIL)).toBeNull();
  });

  it('never takes one signed with another key, open or closed', async () => {
    // The window widens which preimage counts and nothing else. A wrong key is
    // still a wrong key on both sides of the date.
    const forged = legacyMint({ secret: OTHER });
    expect(await verifyToken(SECRET, forged, NOW)).toBeNull();
    expect(await verifyToken(SECRET, forged, LEGACY_SIGNATURES_UNTIL)).toBeNull();
  });

  it('and mints the new preimage from the first day rather than into the window', async () => {
    // Minting the old one for as long as it is accepted would only make more
    // tokens to wait for, and put off the day the window can be deleted.
    const token = await mintToken(SECRET, {
      subject: 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
      tier: 'free',
      expiresAt: LEGACY_SIGNATURES_UNTIL + TOKEN_TTL_MS,
    });
    expect(await verifyToken(SECRET, token, LEGACY_SIGNATURES_UNTIL)).toMatchObject({ tier: 'free' });
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
      claim: { expiresAt: expect.any(Number), tier: 'full', subject: 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' },
    });
  });

  it('and `verifyToken` is that answer with the reason dropped', async () => {
    // One place decides what a valid token is, so the gate and the log can
    // never come to different conclusions about the same request.
    expect(await verifyToken(SECRET, mint({ ttl: -1 }), NOW)).toBeNull();
    expect(await verifyToken(SECRET, mint(), NOW)).not.toBeNull();
  });
});

describe('the subject, which three apps have to derive identically', () => {
  /**
   * A fixed vector, because this is a contract across repositories.
   *
   * The account is shared across the family and the subject is the identity:
   * one string that is the sync subject in each app and the RevenueCat App
   * User ID. It cannot be the purchase record, because Log is free and a Log
   * user has bought nothing for a billing system to have heard of, so it runs
   * the other way -- the address makes the subject, and the subject is what a
   * vendor is handed.
   *
   * Which makes the preimage frozen. `'log.subject.' + normalizeEmail(address)`
   * copied byte for byte, including the `log.` that will read wrong in another
   * repository: it is the input to a hash rather than a name, and changing it
   * gives the same person a different subject and orphans every bucket, the
   * same way changing the key would. A vector is the only form of that rule
   * another codebase can check itself against, so here it is, with the answer
   * written out rather than recomputed by the test's own copy of the algorithm.
   */
  const VECTOR = { secret: 'family-gate-secret', address: 'Player@Example.COM' };
  const EXPECTED = 'log_dd63349789b05bdc192591f2e6ac664d';

  it('is this exact string for this exact address', async () => {
    expect(await subjectForEmail(VECTOR.secret, VECTOR.address)).toBe(EXPECTED);
  });

  it('and the same one however the address was capitalized', async () => {
    // The other half of the contract, and a way the family can split without
    // anybody noticing: one app lowercasing and one not gives `Player@` and
    // `player@` two identities and two histories.
    for (const written of ['player@example.com', 'PLAYER@EXAMPLE.COM', '  Player@Example.COM  ']) {
      expect(await subjectForEmail(VECTOR.secret, written)).toBe(EXPECTED);
    }
  });

  it('and it is the shape the gate takes, or the family cannot sign in at all', async () => {
    expect(OWN_SUBJECT.test(EXPECTED)).toBe(true);
  });

  it('and carries no address, which is what makes it safe to hand a vendor', async () => {
    // Handed to RevenueCat as the App User ID, so it must not be the mailbox.
    // An HMAC is stable, opaque and cannot be turned back into a person by
    // anybody without the key.
    const subject = await subjectForEmail(VECTOR.secret, VECTOR.address);
    expect(subject).not.toContain('Player');
    expect(subject.toLowerCase()).not.toContain('example');
    expect(subject).not.toContain('@');
  });

  it('and a different key gives a different one, so the key is part of it too', async () => {
    expect(await subjectForEmail('another-gate-secret', VECTOR.address)).not.toBe(EXPECTED);
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

  it('refuses a subject the other door in the family mints', async () => {
    // The one that changed, and the reason it did. Untilt mints for a Stripe
    // customer, so its subject is `cus_...`; this door derives one from an
    // address. Taking both meant keying a bucket off whichever arrived, with no
    // way to tell that they are the same person -- a customer id does not carry
    // the address. Somebody who arrived on Untilt's token synced into one
    // bucket, and when it expired (this app will not renew a paid claim, and
    // rightly, because the store is shared with the family) they signed in at
    // this door under the other subject and found an empty log, with the full
    // one somewhere nothing would ever ask for again.
    const claim = await verifyToken(SECRET, mint({ subject: 'cus_QRS123' }), NOW);
    // It still verifies. The signature was never the problem.
    expect(claim).not.toBeNull();
    expect(hasOwnBucket(claim)).toBe(false);
  });

  it('and anything else that is not the shape this door writes', async () => {
    // The grammar above is Untilt's and is much wider on purpose. This is the
    // whole of what the shape excludes, spelled out rather than implied.
    const wrong = [
      'log_' + 'a'.repeat(31), // a character short
      'log_' + 'a'.repeat(33), // one too many
      'log_' + 'A'.repeat(32), // hex, and `hmacHex` writes it lowercase
      'log_' + 'g'.repeat(32), // not hex at all
      'log' + 'a'.repeat(32), // no separator
      'xlog_' + 'a'.repeat(32), // prefixed
      'passcode',
    ];
    for (const subject of wrong) {
      const claim = await verifyToken(SECRET, mint({ subject }), NOW);
      expect(claim).not.toBeNull();
      expect(hasOwnBucket(claim)).toBe(false);
    }
  });

  it('and takes exactly what this door mints, for any address', async () => {
    // The other direction, and the one that locks the app out of itself if it
    // is wrong: the shape test and the thing that produces the shape have to
    // agree, or every sign-in is refused at once.
    for (const address of ['a@b.co', 'PLAYER@Example.COM', 'x'.repeat(60) + '@e.io', '']) {
      expect(OWN_SUBJECT.test(await subjectForEmail(SECRET, address))).toBe(true);
      const claim = await verifyToken(SECRET, mint({ subject: await subjectForEmail(SECRET, address) }), NOW);
      expect(hasOwnBucket(claim)).toBe(true);
    }
  });

  it('and the client says the same thing, or a device syncs into a wall', async () => {
    // `hasOwnSubject` decides whether the data layer builds a syncing wrapper
    // at all. A device that answered yes here and no at the endpoint would
    // send, take a 403, and halt, with a card reporting a session that syncs.
    for (const subject of ['cus_QRS123', 'passcode', 'log_' + 'a'.repeat(31), await subjectForEmail(SECRET, 'a@b.co')]) {
      const claim = await verifyToken(SECRET, mint({ subject }), NOW);
      expect(hasOwnSubject(claim)).toBe(hasOwnBucket(claim));
    }
  });

  it('refuses nobody at all', () => {
    expect(hasOwnBucket(null)).toBe(false);
  });
});

describe('which bucket a log lives in', () => {
  it('is an HMAC, so the store never holds a customer id', async () => {
    const bucket = await bucketFor(SECRET, 'log_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2');
    expect(bucket).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket).not.toContain('cus_');
  });

  it('is stable for one person and different for another', async () => {
    expect(await bucketFor(SECRET, 'log_f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6')).toBe(await bucketFor(SECRET, 'log_f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6'));
    expect(await bucketFor(SECRET, 'log_f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6')).not.toBe(await bucketFor(SECRET, 'log_07070707070707070707070707070707'));
  });

  it('moves when the key does, which is what rotating one is for', async () => {
    expect(await bucketFor(SECRET, 'log_f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6')).not.toBe(await bucketFor(OTHER, 'log_f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6'));
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

describe('minting one', () => {
  it('makes a token this file then accepts', async () => {
    // The property both halves exist for. They are one format, so the check is
    // a round trip rather than a string somebody typed out and believed.
    const token = await mintToken(SECRET, {
      subject: 'log_abc',
      tier: 'free',
      expiresAt: NOW + TOKEN_TTL_MS,
    });
    expect(await verifyToken(SECRET, token, NOW)).toMatchObject({
      tier: 'free',
      subject: 'log_abc',
    });
  });

  it('and one nothing else accepts', async () => {
    // A key that is merely close mints tokens that look right and are refused
    // everywhere. This is the assertion that would catch it.
    const token = await mintToken(OTHER, {
      subject: 'log_abc',
      tier: 'free',
      expiresAt: NOW + TOKEN_TTL_MS,
    });
    expect(readClaim(token, NOW)).not.toBeNull();
    expect(await verifyToken(SECRET, token, NOW)).toBeNull();
  });

  it('writes the expiry in seconds, which is what the grammar says', async () => {
    // A factor of a thousand, and therefore about fifty years if it goes the
    // wrong way unnoticed. Converted here so no caller has to remember.
    const expiresAt = NOW + TOKEN_TTL_MS;
    const token = await mintToken(SECRET, { subject: 'log_abc', tier: 'free', expiresAt });
    expect(token.split('.')[0]).toBe(String(Math.floor(expiresAt / 1000)));
    expect((await verifyToken(SECRET, token, NOW))?.expiresAt).toBe(
      Math.floor(expiresAt / 1000) * 1000,
    );
  });

  it('makes one that has already expired if told to', async () => {
    const token = await mintToken(SECRET, {
      subject: 'log_abc',
      tier: 'free',
      expiresAt: NOW - 1000,
    });
    expect(await verifyToken(SECRET, token, NOW)).toBeNull();
  });
});

describe('the subject for an address', () => {
  const EMAIL = 'player@example.com';

  it('is the same one every time, so the same person gets the same log', async () => {
    expect(await subjectForEmail(SECRET, EMAIL)).toBe(await subjectForEmail(SECRET, EMAIL));
  });

  it('and the same one however the address was typed', async () => {
    // One inbox is one person. Two subjects for one inbox is a second, empty
    // history and nothing on screen to explain it.
    for (const spelling of ['Player@Example.com', 'PLAYER@EXAMPLE.COM', '  player@example.com  ']) {
      expect(normalizeEmail(spelling)).toBe(EMAIL);
      expect(await subjectForEmail(SECRET, spelling)).toBe(await subjectForEmail(SECRET, EMAIL));
    }
  });

  it('is a different one for a different address', async () => {
    expect(await subjectForEmail(SECRET, EMAIL)).not.toBe(
      await subjectForEmail(SECRET, 'other@example.com'),
    );
  });

  it('cannot be mistaken for a customer or for the shared passcode', async () => {
    // A subject names a bucket. Two schemes that could ever collide are two
    // people who could ever share a poker history.
    const subject = await subjectForEmail(SECRET, EMAIL);
    expect(subject.startsWith(SUBJECT_PREFIX)).toBe(true);
    expect(subject.startsWith('cus_')).toBe(false);
    expect(subject).not.toBe(SUBJECT_PASSCODE);
    expect(hasOwnBucket({ expiresAt: NOW, tier: 'free', subject })).toBe(true);
  });

  it('fits the grammar, which is what the parser will hold it to', async () => {
    const subject = await subjectForEmail(SECRET, EMAIL);
    expect(subject).toMatch(/^[A-Za-z0-9_]{1,64}$/);
    const token = await mintToken(SECRET, { subject, tier: 'free', expiresAt: NOW + 1000 });
    expect(readClaim(token, NOW)?.subject).toBe(subject);
  });

  it('moves when the key does, exactly as a bucket does', async () => {
    expect(await subjectForEmail(SECRET, EMAIL)).not.toBe(await subjectForEmail(OTHER, EMAIL));
  });

  it('does not leak the address it came from', async () => {
    const subject = await subjectForEmail(SECRET, EMAIL);
    expect(subject).not.toContain('player');
    expect(subject).not.toContain('example');
  });
});
