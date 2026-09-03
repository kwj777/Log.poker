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
 * What a token proves, or null if it proves nothing.
 *
 * Fails closed on everything: no secret, no token, a shape this build does not
 * recognize, an expiry in the past, a signature under another key. A caller
 * that forgets to check the result gets `null` and a `TypeError`, rather than
 * an object that quietly means "anybody".
 */
export const verifyToken = async (
  secret: string,
  token: string | null,
  now: Timestamp,
): Promise<Claim | null> => {
  if (!secret || token === null) return null;

  const claim = readClaim(token, now);
  if (claim === null) return null;

  const parts = token.split('.');
  const expected = await sign(secret, parts.slice(0, 3).join('.'));
  return safeEqual(parts[3], expected) ? claim : null;
};

/**
 * Whether this claim may sync, which is two questions rather than one.
 *
 * The tier is the obvious half. The other is that **a passcode holder has no
 * subject of their own**: everybody who typed one shares the literal string,
 * so syncing them together would pour every preview visitor's log into a single
 * bucket. Untilt's sync refuses that subject by name and this refuses it here,
 * explicitly, rather than by never happening to meet one.
 */
export const maySync = (claim: Claim | null): boolean =>
  claim !== null && claim.tier === 'full' && claim.subject !== SUBJECT_PASSCODE;

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
