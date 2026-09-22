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
 *     subject    [A-Za-z0-9_]{1,64}, one this family's doors mint or "passcode"
 *     signature  base64url HMAC-SHA256 of `family.` and the first three
 *                fields, under a key this app does not have and must never be
 *                given
 *
 * The `family.` in front of what is signed is the one thing in the grammar
 * that is not visible on the wire. It is what keeps a token the family passes
 * between its apps from also being the cookie that opens `untilt.poker`, which
 * it otherwise would be, byte for byte. `src/sync/verify.ts` is where it is
 * checked and where the argument is; nothing here changes, because the fields
 * and their order did not.
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
 * **Cross-device history is free**, so what a person has paid for decides
 * nothing about who may sync: reading, writing and erasing all ask only for a
 * verified token with a subject of its own. The field stays in the grammar
 * because the grammar is Untilt's and not ours to trim: dropping it here would
 * make this accept a shape Untilt does not mint.
 *
 * One place does read it, and it is not a gate on syncing. `renew` refuses to
 * extend anything but `free`, because the token sits in a store the family
 * shares and replacing a paid one with a free one would take away access
 * somewhere Log cannot see. This comment said the field was read by nothing,
 * which was true when it was written and stopped being true one endpoint later.
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

/** What every subject Log's own door mints begins with. */
export const SUBJECT_PREFIX = 'log_';

/**
 * The exact shape of a subject Log minted, and the whole of who may sync.
 *
 * `subjectForEmail` is the only thing in the family that writes this shape:
 * the prefix and thirty-two characters of an HMAC, which `hmacHex` emits in
 * lowercase, so the character class is exact rather than approximate. The
 * grammar above it is Untilt's and is much wider on purpose -- a Stripe
 * customer id is a subject too -- and that width used to be the whole of the
 * rule.
 *
 * **It cost a person their history, quietly.** Untilt mints for a customer, so
 * its subject is `cus_...`; Log's door derives one from an address. Log took
 * both and keyed a bucket off whichever arrived, and it cannot tell that they
 * are the same person: a customer id does not carry the address, so nothing on
 * this side can link them. Somebody who arrived with Untilt's token synced into
 * one bucket, and when that token expired -- Log will not renew a paid claim,
 * rightly, because the store is shared with the family -- they signed in at
 * Log's own door under the other subject and found an empty log, with the full
 * one in a bucket nothing would ever ask for again.
 *
 * There is no way to merge the two that is not also a way to reach somebody
 * else's history, so the answer is to stop taking the second kind at all.
 *
 * **And one can arrive now**, which is the change since this was written.
 * `app/claim.tsx` takes a one-time code out of a URL fragment, trades it at
 * Untilt's claim endpoint and hands the token that comes back to `signIn`. So
 * `signIn` has two callers and one of them is holding somebody else's token,
 * and this pattern is what stands between that and a second bucket rather than
 * a belt over a door nobody could open. The clause that used to be here --
 * "refuses a token that cannot arrive" -- described the tree before the
 * hand-off shipped.
 *
 * Nothing about the containment changed with it, which is why the behavior is
 * still right: a token minted for a Stripe customer carries `cus_...`,
 * `hasOwnSubject` is false, `SessionManager` reports `syncs: false`, and
 * `data/index.ts` composes the plain local repository. The person keeps their
 * log on the device and gets no bucket at all, rather than a second one.
 */
export const OWN_SUBJECT = /^log_[0-9a-f]{32}$/;

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
 * One condition, and it is identity. The tier was the other one once, it was
 * removed, and it is back beside this rather than inside it: see
 * `paidForSync` below, which is the question about money and is asked
 * separately so that this one can go on guarding erasure too.
 *
 * The argument that removed it is worth keeping rather than quietly losing,
 * because it is still true and it is what the price has to be worth beating:
 * what is valuable in a tracker is the player's own record, and an app that
 * charges to read that back on a second device is charging rent on their work
 * rather than selling them anything. `FAMILY-PRICING.md` has ruled the other
 * way, that sync is inside the $99. What answers the argument is that the
 * whole of the tracker stays free and only the carrying is bought, and that
 * nobody is ever refused the right to empty their own bucket.
 *
 * What is left was never about money. **A passcode holder has no subject of
 * their own**: everybody who typed one shares the literal string, so carrying
 * their histories together would pour every preview visitor's log into a
 * single one.
 */
/**
 * How close to the end a token has to be before the app asks for a new one.
 *
 * Ten days of thirty, which is the number Untilt's own renewal uses. Wide
 * enough that a device opened once a week renews long before it runs out, and
 * narrow enough that a renewal is not something every launch does.
 *
 * Here rather than beside the minting, because deciding *when* to ask is the
 * app's half and this file is the half the app is allowed to import.
 */
export const RENEW_WITHIN_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * Whether the token behind this claim is close enough to expiry to replace.
 *
 * False for a claim that has already expired: a renewal cannot resurrect one,
 * the server refuses it, and asking would only be a request that fails.
 */
export const dueForRenewal = (claim: Claim | null, now: Timestamp): boolean =>
  claim !== null && claim.expiresAt > now && claim.expiresAt - now <= RENEW_WITHIN_MS;

/**
 * Whether this claim has a log of its own to carry.
 *
 * The client's half of the rule the server enforces in `hasOwnBucket`, and the
 * two have to say the same thing: this decides whether the data layer builds a
 * syncing wrapper at all, so a device that answered yes here and no there
 * would sync into a wall of 403s and halt.
 *
 * The passcode line stays although the shape test already excludes it. Log
 * inherits that refusal explicitly rather than by luck, and a rule that happens
 * to exclude a passcode is not the same as one that refuses it.
 */
export const hasOwnSubject = (claim: Claim | null): boolean =>
  claim !== null && claim.subject !== SUBJECT_PASSCODE && OWN_SUBJECT.test(claim.subject);

/**
 * Whether cross-device sync sits behind the pass.
 *
 * `FAMILY-PRICING.md` rules that Log's sync and goals are inside the $99. This
 * is the switch that makes that true here, and it is off, because this app
 * cannot yet find out who has paid.
 *
 * `signinEndpoint` mints `tier: 'free'` for every sign-in made at this app's
 * own door, and says why in as many words: a paid claim is Untilt's to extend,
 * because Untilt is the one that can ask Stripe whether it is still true. It
 * also refuses to renew anything but free. So a live gate today would refuse
 * sync to everybody who signed in here, the people who have paid included, and
 * would hold them to a token this door will not renew. That is not the feature,
 * it is the feature with its own front door shut.
 *
 * What has to exist first is the shared entitlement the family brief makes step
 * 4: a way for this app to learn, for an address that just signed in here, that
 * somebody bought. Until then everything that reads this is built, wired and
 * tested against both answers, and the answer is false.
 *
 * Annotated `boolean` rather than left to infer `false`, so both branches stay
 * code the compiler checks.
 */
export const SYNC_NEEDS_PASS: boolean = false;

/**
 * Whether the person behind this claim has bought the family pass.
 *
 * The tier, asked as a question, so that the one place the word `full` appears
 * is here. Two callers now read it and they are asking different things:
 * `syncIsPaidFor` asks whether to open a feature, and the after-session card
 * asks which of two sentences to put on the screen. Neither should have to
 * know the grammar.
 *
 * **It is false for everybody who signs in at Log's own door, and not because
 * nobody has paid.** `signinEndpoint` mints `tier: 'free'` for every one of
 * those. What would make it true for them is the shared entitlement the family
 * brief makes step 4 and `SYNC_NEEDS_PASS` describes: a way for this app to
 * learn, for an address that just signed in here, that somebody bought.
 *
 * **It is already true for anybody who came through a hand-off.**
 * `src/auth/handoff.ts` exists to take delivery of a purchase made at another
 * of the family's apps, `app/claim.tsx` hands what it gets to `signIn`, and a
 * paid claim is the ordinary answer on that path -- Untilt answers 503 rather
 * than a free token when it cannot reach Stripe, precisely so an outage is
 * never read here as somebody not having paid. So the branches reading this
 * are live rather than written-and-waiting, which is what this said until the
 * claim screen shipped.
 *
 * Nothing here is a gate, and nothing here may become one. See the top of this
 * file: a claim read on the client proves only that somebody typed something
 * shaped like a token. Deciding which sentence to show is exactly the kind of
 * courtesy this side is allowed to decide.
 */
export const hasPass = (claim: Claim | null): boolean =>
  claim !== null && claim.tier === 'full';

/**
 * The rule, given whether sync is gated. One rule, one place.
 *
 * One place because two sides read it and they are not allowed to disagree:
 * `hasOwnSubject` above already explains what a device that answers yes on the
 * client and no on the server does, which is sync into a wall of refusals and
 * halt. The client reads this to decide whether to wrap the repository at all,
 * and `endpoint.ts` reads it to decide whether to serve the request, so there
 * is no gap between what the app promises and what the server answers.
 */
export const syncIsPaidFor = (gated: boolean, claim: Claim | null): boolean =>
  !gated || hasPass(claim);

/**
 * The same rule with the switch applied, which is what both sides call.
 *
 * Split from `syncIsPaidFor` above so the gated answer can be tested without
 * mocking a constant: a test that mocked the export would not change what this
 * function reads, because the binding it closes over is the module's own.
 */
export const paidForSync = (claim: Claim | null): boolean =>
  syncIsPaidFor(SYNC_NEEDS_PASS, claim);
