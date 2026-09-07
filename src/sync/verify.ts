/**
 * Checking a token, which only the server can do.
 *
 * `src/auth/token.ts` parses one and says so loudly: it has no key and proves
 * nothing. This is the other half, and it lives apart because the difference
 * matters more than the duplication. Anything importing this file needs a
 * secret to call it, and a secret that reached the app bundle would be a secret
 * anybody could download.
 *
 * The secret is a parameter rather than an environment read, so this stays a
 * pure function with a test suite and the one place that knows where the key
 * comes from is the Netlify function.
 *
 * The signature is Untilt's, re-derived rather than reimplemented: HMAC-SHA256
 * over the first three fields, base64url, no padding.
 */

import { readClaim, SUBJECT_PASSCODE, type Claim } from '../auth/token';
import type { Timestamp } from '../domain/types';

/** Length-independent, so a wrong guess leaks no timing signal. */
const safeEqual = (a: string, b: string): boolean => {
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

const sign = async (secret: string, payload: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
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
export const bucketFor = async (secret: string, subject: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode('log.sync.' + subject));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** The bearer token on a request, or null. Case-insensitive, as the header is. */
export const bearerFrom = (authorization: string | null | undefined): string | null => {
  if (typeof authorization !== 'string') return null;
  const found = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return found ? found[1] : null;
};
