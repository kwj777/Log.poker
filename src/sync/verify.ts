/**
 * Making and checking a token, and everything else that needs the key.
 *
 * `src/auth/token.ts` parses one and says so loudly: it has no key and proves
 * nothing. This is the other half, and it lives apart because the difference
 * matters more than the duplication. **Anything importing this file needs a
 * secret to call it**, and a secret that reached the app bundle would be a
 * secret anybody could download. It is under `src/sync` for historical reasons
 * and is not about syncing; `signinEndpoint.ts` is the other caller.
 *
 * The secret is a parameter rather than an environment read, so this stays a
 * pure function with a test suite and the one place that knows where the key
 * comes from is the Netlify function.
 *
 * The signature is Untilt's, re-derived rather than reimplemented: HMAC-SHA256
 * over the first three fields, base64url, no padding.
 *
 * **Minting lives here rather than beside the sign-in**, next to the check it
 * has to agree with. Two files that each know half of a signature format are
 * two files that disagree about it in a year, and the failure mode is a token
 * this family mints and then refuses.
 */

import { readClaim, SUBJECT_PASSCODE, type Claim, type Tier } from '../auth/token';
import type { Timestamp } from '../domain/types';

/** Length-independent, so a wrong guess leaks no timing signal. */
export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let index = 0; index < a.length; index += 1) {
    differing |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return differing === 0;
};

const base64url = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const mac = async (secret: string, payload: string): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(payload));
};

const sign = async (secret: string, payload: string): Promise<string> =>
  base64url(await mac(secret, payload));

/**
 * A name derived from the key rather than from what it names.
 *
 * Three things are keyed this way and the argument is the same for all of
 * them: a store that holds an address, a customer id or a subject is a store
 * that identifies people if it ever leaks, and none of these need to be
 * reversible. The domain prefix keeps them from being each other.
 */
export const hmacHex = async (secret: string, payload: string): Promise<string> => {
  const bytes = new Uint8Array(await mac(secret, payload));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Why a token proved nothing.
 *
 * Four answers where there used to be one, and they exist for the deploy log
 * rather than for the caller: every one of them is still a 401 on the wire,
 * because telling somebody which part of their token is wrong is telling an
 * attacker the same thing.
 *
 * `signature` is the one worth having. It is the only symptom of the key here
 * not being the key Untilt signs with, and on the day this endpoint is turned
 * on that is the single likeliest thing to be wrong. Without it, a wrong key
 * looks exactly like nobody having signed in: silence, and a 401.
 */
export type Refusal = 'absent' | 'malformed' | 'signature' | 'expired';

export type Checked = { claim: Claim } | { refused: Refusal };

/**
 * What a token proves, and what was wrong with it if it proves nothing.
 *
 * Fails closed on everything: no secret, no token, a shape this build does not
 * recognize, a signature under another key, an expiry in the past.
 *
 * The signature is checked before the expiry, which is the other way round from
 * how this read before. Two reasons, and they agree. The useful one: a token
 * that is both expired and wrongly signed says `signature`, because the expiry
 * is one person's problem and the key is everybody's. The ordinary one: nothing
 * should act on a claim it has not verified, and an expiry is a claim.
 */
export const checkToken = async (
  secret: string,
  token: string | null,
  now: Timestamp,
): Promise<Checked> => {
  if (!secret || token === null) return { refused: 'absent' };

  // Parsed with nothing to compare the expiry against, so that an expired token
  // can be told apart from a malformed one. `readClaim` takes the moment rather
  // than exposing the shape check separately, and this is the only caller that
  // needs the two answers apart.
  const claim = readClaim(token, Number.NEGATIVE_INFINITY);
  if (claim === null) return { refused: 'malformed' };

  const parts = token.split('.');
  const expected = await sign(secret, parts.slice(0, 3).join('.'));
  if (!safeEqual(parts[3], expected)) return { refused: 'signature' };

  return claim.expiresAt <= now ? { refused: 'expired' } : { claim };
};

/**
 * The same question with the reason thrown away.
 *
 * Every caller that only wants the gate goes through here, so there is one
 * place that decides what counts as a valid token and one place that has ever
 * decided it.
 */
export const verifyToken = async (
  secret: string,
  token: string | null,
  now: Timestamp,
): Promise<Claim | null> => {
  const checked = await checkToken(secret, token, now);
  return 'claim' in checked ? checked.claim : null;
};

/**
 * Whether this claim names somebody who can have a bucket at all.
 *
 * **A passcode holder has no subject of their own**: everybody who typed one
 * shares the literal string, so giving them a bucket would pour every preview
 * visitor's log into a single one. Untilt's sync refuses that subject by name
 * and this refuses it here, explicitly, rather than by never happening to meet
 * one.
 *
 * **This is the whole of who may sync.** There used to be a second question
 * below it, asking whether the tier had paid, and it is gone: cross-device
 * history is free, so a verified token with a subject of its own is the entire
 * condition for reading, writing and erasing alike. Nothing here reads
 * `claim.tier`.
 */
export const hasOwnBucket = (claim: Claim | null): claim is Claim =>
  claim !== null && claim.subject !== SUBJECT_PASSCODE;

/**
 * Which bucket this person's log lives in.
 *
 * An HMAC of the subject under the same key, so the store never holds a
 * customer id: what is in there is somebody's whole poker history, and without
 * the key a bucket cannot be tied back to a person. Rotating the secret orphans
 * every bucket, which is exactly what it already does to every token, and the
 * two are meant to move together.
 */
export const bucketFor = (secret: string, subject: string): Promise<string> =>
  hmacHex(secret, 'log.sync.' + subject);

/** The bearer token on a request, or null. Case-insensitive, as the header is. */
export const bearerFrom = (authorization: string | null | undefined): string | null => {
  if (typeof authorization !== 'string') return null;
  const found = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return found ? found[1] : null;
};

/* --------------------------------------------------------------- minting */

/**
 * How long a token this app mints is good for.
 *
 * Thirty days, which is Untilt's number and is chosen to be the same one.
 * A device that has been in a drawer for a month signs in again; a device in
 * use never notices, because a sync is what discovers the expiry and there is
 * one on every launch.
 */
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The prefix on a subject this app minted.
 *
 * Untilt's subjects are Stripe customer ids, which begin `cus_`, and the
 * shared passcode's is the literal `passcode`. This is neither, deliberately
 * and checkably: a subject is the name of a bucket, so two schemes that could
 * ever collide are two people who could ever share a poker history.
 */
export const SUBJECT_PREFIX = 'log_';

/**
 * One spelling of an address, so one person has one log.
 *
 * Untilt keeps the spelling somebody typed, because Stripe's customer filter
 * is case-sensitive and it has to find them. Nothing here looks anybody up, so
 * this can do the correct thing instead: the local part of an address is
 * case-sensitive by RFC and case-insensitive at every mail provider anybody
 * uses, and treating `Player@Example.com` as a second person would give them a
 * second, empty history and no way to tell why.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * The subject for an address, which is all this app knows about anybody.
 *
 * Derived rather than stored, so there is no user table to keep, to migrate or
 * to leak: the same address always answers with the same subject, and the
 * subject cannot be turned back into the address without the key.
 *
 * Thirty-two hex characters of an HMAC. That is 128 bits, which is far past
 * what a collision needs, and it leaves the whole thing at 36 characters
 * against the grammar's limit of 64.
 */
export const subjectForEmail = async (secret: string, email: string): Promise<string> =>
  SUBJECT_PREFIX + (await hmacHex(secret, 'log.subject.' + normalizeEmail(email))).slice(0, 32);

/**
 * A signed token, in the grammar Untilt defined.
 *
 * The counterpart of `checkToken` and the reason both live in this file. The
 * expiry is written in seconds because that is what the grammar says, and the
 * argument is in milliseconds because that is what everything in this app
 * counts in; the conversion is here so that no caller has to remember it.
 *
 * **Nothing about this decides what a token is worth.** A token minted here
 * carries the free tier, because this app has nothing to sell and no way to
 * find out whether somebody has bought elsewhere. It is a valid family token
 * by construction, since the signature is the whole of what makes one, so it
 * is worth saying what that does and does not buy: the other two apps will
 * read the tier and give it exactly what an unpaid visitor already has.
 */
export const mintToken = async (
  secret: string,
  { subject, tier, expiresAt }: { subject: string; tier: Tier; expiresAt: Timestamp },
): Promise<string> => {
  const payload = `${Math.floor(expiresAt / 1000)}.${tier}.${subject}`;
  return `${payload}.${await sign(secret, payload)}`;
};
