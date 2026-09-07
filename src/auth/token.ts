/**
 * Reading the family's access token.
 *
 * Pure and platform-free. The token is minted by Untilt's sign-in and is the
 * same string in all three apps, which is the point: `log.poker`,
 * `untilt.poker` and `tiltproof.poker` are three registrable domains, so a
 * cookie cannot cross them, and on iOS and Android there is no cookie at all.
 * A signed bearer string crosses both gaps unchanged. See SYNC.md.
 *
 * The grammar, which is Untilt's `lib/access.js` and is not ours to change:
 *
 *     <expiry>.<tier>.<subject>.<signature>
 *
 *     expiry     seconds since the epoch, not milliseconds
 *     tier       "full" or "free"
 *     subject    [A-Za-z0-9_]{1,64}, a Stripe customer id or "passcode"
 *     signature  base64url HMAC-SHA256 of the first three fields, under a key
 *                this app does not have and must never be given
 *
 * ## This file does not verify anything
 *
 * It parses. Nothing here checks the signature, because checking it needs the
 * gate secret, and a secret shipped inside an app that anybody can download is
 * not a secret. **A claim read here proves only that somebody typed something
 * shaped like a token.** The server re-derives the signature on every request
 * and is the only thing whose answer counts.
 *
 * That is not a weakness as long as nothing on this side is load bearing. What
 * a parsed claim is good for is deciding what to show and what to bother
 * sending: an expired token means sign in again rather than a round trip that
 * will fail, and a passcode subject means there is no log of its own to carry.
 * Both are courtesies. The gate is at the other end.
 */

import type { Timestamp } from '../domain/types';

/**
 * What Untilt's tokens can say. Anything else is not a token we understand.
 *
 * Parsed and then read by nothing. **Cross-device history is free**, so what a
 * person has paid for decides nothing on this side of the family. The field
 * stays in the grammar because the grammar is Untilt's and not ours to trim:
 * dropping it here would make this accept a shape Untilt does not mint.
 */
export const TIERS = ['full', 'free'] as const;

export type Tier = (typeof TIERS)[number];

/**
 * The subject on a token earned by typing a passcode rather than by paying.
 *
 * Every passcode holder shares it, so it identifies a door rather than a
 * person. Untilt's sync endpoint refuses it by name, because syncing them
 * together would pour every preview visitor's history into one bucket. Log
 * inherits that refusal here, explicitly, rather than by never happening to
 * meet one.
 */
export const SUBJECT_PASSCODE = 'passcode';

const SUBJECT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

export interface Claim {
  /** In milliseconds, converted at the boundary. The token says seconds. */
  expiresAt: Timestamp;
  tier: Tier;
  subject: string;
}

const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value);

/**
 * What a token says, or null if it says nothing usable.
 *
 * Anything malformed, expired or carrying a field this build does not
 * recognize returns null, so every caller fails closed without having to
 * remember to. `now` is injected rather than read, so a test can sit either
 * side of an expiry without sleeping.
 */
export const readClaim = (token: string | null, now: Timestamp): Claim | null => {
  if (token === null) return null;

  const parts = token.split('.');
  // Four fields exactly. A subject cannot contain a dot, which is what stops a
  // crafted one from shifting the fields along and being read as another claim.
  if (parts.length !== 4) return null;

  const [expiry, tier, subject] = parts;
  if (!/^\d{1,12}$/.test(expiry)) return null;
  if (!isTier(tier)) return null;
  if (!SUBJECT_PATTERN.test(subject)) return null;

  const expiresAt = Number(expiry) * 1000;
  if (expiresAt <= now) return null;

  return { expiresAt, tier, subject };
};

/**
 * Whether this claim names somebody with a log of their own to carry.
 *
 * One condition, where there were two. The tier used to be the other one, and
 * removing it is the whole of making sync free: what is valuable in a tracker
 * is the player's own record, and an app that charges to read that back on a
 * second device is charging rent on their work rather than selling them
 * anything. There is no `log_plus`, there is no entitlement to check later,
 * and this function is not a gate waiting for a better one.
 *
 * What is left was never about money. **A passcode holder has no subject of
 * their own**: everybody who typed one shares the literal string, so carrying
 * their histories together would pour every preview visitor's log into a
 * single one.
 */
export const hasOwnSubject = (claim: Claim | null): boolean =>
  claim !== null && claim.subject !== SUBJECT_PASSCODE;
