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

import {
  OWN_SUBJECT,
  readClaim,
  SUBJECT_PASSCODE,
  SUBJECT_PREFIX,
  type Claim,
  type Tier,
} from '../auth/token';
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
 * What a token signs, which is not the same as the fields it carries.
 *
 * `family.` in front of the three fields, so that what the family passes
 * between its apps is not the credential that opens `untilt.poker`. Untilt's
 * `lib/access.js` is where this is decided and where the argument is written
 * out; the short version is that the two used to be byte-identical -- four
 * fields, one key, and Untilt's subject pattern admits a `log_` subject
 * unchanged -- so a token handed to another origin was a thirty-day
 * full-access cookie for Untilt, and tokens go places cookies do not.
 *
 * It is the trick Untilt already used for its sign-in links, and it is cheap
 * because it does not touch the wire: four dot-separated fields in the same
 * order, so `readClaim` does not change a line. Only what the signature is
 * taken over differs, which is enough that neither credential verifies as the
 * other in either direction.
 */
const FAMILY_PURPOSE = 'family';

/**
 * When this stops accepting the preimage it used to sign.
 *
 * Every token carrying the old signature is one this app's own door minted,
 * because Log has never shipped a way to receive somebody else's, and they all
 * run out within `TOKEN_TTL_MS` of the change landing. So the window only has
 * to cover thirty days from the deploy, and this date is set a couple of
 * months past the change being written, which is slack rather than a second
 * deadline.
 *
 * It closes by itself on purpose. A migration that ends when somebody
 * remembers to delete a branch is a migration that does not end, and what that
 * branch keeps alive is an acceptance of the exact signature domain separation
 * exists to stop accepting.
 *
 * Nothing is stranded by it. A device opened inside the last ten days of its
 * token renews, which mints the new preimage and costs its owner nothing; one
 * that is not signs in again, which is what an expired token already meant.
 *
 * **The window is not a hole this opened.** Taking the old preimage is taking
 * what this app took yesterday, and the containment is the one already there:
 * `hasOwnBucket` accepts only subjects this door minted, so an Untilt cookie
 * -- the other thing that preimage signs -- cannot reach a bucket during the
 * window any more than after it.
 *
 * Past this date the second branch in `checkToken` is unreachable and should
 * go, and this constant with it.
 */
export const LEGACY_SIGNATURES_UNTIL: Timestamp = Date.parse('2026-11-15T00:00:00Z');

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
 *
 * Two preimages are tried while `LEGACY_SIGNATURES_UNTIL` is open, the current
 * one first, so the ordinary case costs one HMAC and only the dying case costs
 * two. A token that satisfies neither is `signature`, which is the answer it
 * would have had before and the same 401 on the wire.
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
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual(parts[3], await sign(secret, `${FAMILY_PURPOSE}.${payload}`))) {
    if (now >= LEGACY_SIGNATURES_UNTIL) return { refused: 'signature' };
    if (!safeEqual(parts[3], await sign(secret, payload))) return { refused: 'signature' };
  }

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
 * **And a subject of one's own means one this app's own door minted**, which
 * is `OWN_SUBJECT`: the prefix and thirty-two lowercase hex characters that
 * `subjectForEmail` produces and nothing else in the family does. The rule
 * used to be the passcode line alone, which took anything Untilt signed, and
 * see `OWN_SUBJECT` for what that cost. One predicate at one call site, so
 * reading, writing and erasing tighten together and there is no method that is
 * the exception.
 *
 * Nothing is exempted, and erasing was the tempting one: refusing it leaves a
 * bucket somebody can no longer read or delete. It is exempted anyway, because
 * the exemption would be dead the moment it was needed. A foreign token cannot
 * be renewed here, so it expires; `SessionManager.current` clears an expired
 * token, which destroys the only string in the world naming that subject; and
 * the erase control lives inside the signed-in branch of the card. So the
 * exemption is reachable only by somebody who is not yet stranded and has no
 * reason to use it, and unreachable by everybody it was written for.
 *
 * **This is the whole of who this bucket belongs to, and nothing about what
 * they have paid.** The tier question came back, and it is deliberately not
 * here: this predicate answers identity, it guards reading, writing and
 * erasing alike, and erasing must never be refused to somebody whose bucket it
 * is. What sync costs is `paidForSync` in `token.ts`, asked once in
 * `endpoint.ts` and in front of the two methods that move data. Nothing in
 * this file reads `claim.tier`, and that is a division of labor rather than an
 * omission.
 */
export const hasOwnBucket = (claim: Claim | null): claim is Claim =>
  claim !== null && claim.subject !== SUBJECT_PASSCODE && OWN_SUBJECT.test(claim.subject);

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
export { SUBJECT_PREFIX } from '../auth/token';

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
 * The subject a gate check names, which is nobody.
 *
 * `scripts/check-gate.mjs` mints itself a token to see whether the endpoint
 * takes it, so it writes a real bucket and erases it again on the way out. It
 * used to name the subject `gatecheck`, which the gate refuses now that a
 * subject has to be one this door minted, so the check would have started
 * reporting a broken key on a working one.
 *
 * Derived the same way and from a different preimage, so it satisfies the
 * shape without being reachable from any address: `subjectForEmail` HMACs
 * `'log.subject.' + address` and this HMACs `'log.gatecheck'`, and no address
 * makes the first equal the second. That is the same domain-separation
 * argument the bucket names already rest on, and it means the gate keeps zero
 * named exceptions where it would otherwise need one.
 */
export const subjectForGateCheck = async (secret: string): Promise<string> =>
  SUBJECT_PREFIX + (await hmacHex(secret, 'log.gatecheck')).slice(0, 32);

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
 *
 * It signs the current preimage from the first day, rather than the old one
 * for as long as `LEGACY_SIGNATURES_UNTIL` runs. That window is for tokens
 * already sitting in people's stores; minting into it would only make more of
 * them to wait for, and would put off the day the window can close.
 */
export const mintToken = async (
  secret: string,
  { subject, tier, expiresAt }: { subject: string; tier: Tier; expiresAt: Timestamp },
): Promise<string> => {
  const payload = `${Math.floor(expiresAt / 1000)}.${tier}.${subject}`;
  return `${payload}.${await sign(secret, `${FAMILY_PURPOSE}.${payload}`)}`;
};
