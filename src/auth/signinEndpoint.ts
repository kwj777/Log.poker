/**
 * The rules behind POST /api/signin and /api/signin/code.
 *
 * Log mints its own tokens. Untilt's sign-in is the family's and stays exactly
 * as it is, but it will not mail a code to an address Stripe has no customer
 * for -- *only somebody who has bought can be reached*, in its own words -- and
 * cross-device history is free now, so the door that opens it cannot be the
 * paid one. This is the free door, in the repository that wanted it.
 *
 * Lifted out of `netlify/functions/signin.mts` for the reason `endpoint.ts` was
 * lifted out of `sync.mts`: a `.mts` module is an ES module as far as the test
 * runner is concerned and will not go through its transform, so anything left
 * in that file has no executed test. What is left there is the key, the store
 * and the mailer.
 *
 * **This file needs the secret and must never be imported by the app.** It
 * mints. See the header of `src/sync/verify.ts`.
 *
 * ## What it does not know
 *
 * There is no user table, and this adds none. An address is never stored: the
 * record for one is keyed by an HMAC of it and holds an HMAC of the code, so a
 * store that leaked would say how many people have signed in and nothing about
 * who. The subject on the token is derived from the address the same way, so
 * the same person always gets the same log back without anything having
 * remembered them.
 *
 * ## What it refuses, and what it refuses to say
 *
 * Untilt answers 202 whether or not it has heard of an address, because an
 * endpoint that says *no customer* is a way to ask which addresses have bought.
 * **Here there is nothing to disclose**, since anybody may sign in, and the
 * property is kept anyway: the cooldown and the daily cap would otherwise
 * answer differently for an address somebody had been mailing, which is the
 * same leak wearing a different hat.
 *
 * The redemption path cannot tell a wrong code from an address it has never
 * issued one for. Both are 400 and the copy in `src/features/account/copy.ts`
 * is written not to guess between them.
 *
 * ## What it is for the abuse of
 *
 * A sign-in that mails anybody is a sign-in that can be pointed at somebody
 * who did not ask. That is the cost of the free door and it is bounded rather
 * than argued away: at most one mail a minute and five a day to any one
 * address, at most twenty requests an hour from any one caller, both counted
 * before anything is generated or sent. A code is six digits, single use, good
 * for fifteen minutes, and dies after five wrong guesses.
 *
 * ## What is exported for the sweep, and why
 *
 * `signinSweep.ts` collects records this file has stopped reading, and the
 * only way it can know which those are is to share the predicates that decide.
 * So `isPending`, `isCaller` and `windowRolled` are exported and used on both
 * sides rather than restated over there: a sweep that disagreed with this file
 * about when a window has rolled would hand back mail budget, which is the one
 * bound that matters here. The key prefixes are exported for the same reason.
 */

import {
  TOKEN_TTL_MS,
  hmacHex,
  mintToken,
  normalizeEmail,
  safeEqual,
  subjectForEmail,
} from '../sync/verify';

/** What this needs from a blob store, and nothing more. */
export interface CodeStore {
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/**
 * Everything outside the rules: the key, the store, the mailer and the clock.
 *
 * `code` is here so a test can know what was mailed. Production leaves it out
 * and gets the one below, which is the only thing in this file that has to be
 * unguessable.
 */
export interface Surroundings {
  secret: string;
  store: () => CodeStore | null;
  mail: (to: string, code: string) => Promise<boolean>;
  now: () => number;
  code?: () => string;
}

/** Long enough to fetch mail on another device, short enough to be worth little. */
export const CODE_TTL_MS = 15 * 60 * 1000;

/** Between mails to one address. A person who lost the first one waits a minute. */
export const COOLDOWN_MS = 60 * 1000;

/** Mails to one address in a day, which is the bound on pointing this at somebody. */
export const DAILY_LIMIT = 5;

/** The window that cap is counted in. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Wrong guesses before a code dies rather than merely being wrong. */
export const MAX_ATTEMPTS = 5;

/** Requests from one caller per hour, counted before anything is generated. */
export const CALLER_LIMIT = 20;

export const CALLER_WINDOW_MS = 60 * 60 * 1000;

/** Two short strings. Anything larger is not this endpoint's request. */
const MAX_BODY = 4 * 1024;

/**
 * Where the two kinds of record live.
 *
 * Exported because the sweep lists by them. Neither prefix is a secret and
 * neither carries anything about who: what follows is an HMAC.
 */
export const CODE_PREFIX = 'code/';

export const CALLER_PREFIX = 'caller/';

/**
 * Permissive on purpose.
 *
 * The only thing this has to rule out is a string that cannot be mailed, so
 * that the mailer is never handed one. Deciding what a valid address is beyond
 * that is a thing every implementation gets wrong in a different direction,
 * and the mail either arrives or it does not.
 */
const looksLikeEmail = (value: string): boolean =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Six digits, uniformly.
 *
 * Rejection sampling rather than a modulo, which would make the low 296 codes
 * fractionally likelier than the rest. That bias is far too small to be worth
 * an attack and the correct version is two extra lines, which is the wrong
 * trade to lose.
 */
const randomCode = (): string => {
  const ceiling = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const draw = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(draw);
    if (draw[0] < ceiling) return String(draw[0] % 1_000_000).padStart(6, '0');
  }
};

/** What is written down about an address, none of which identifies one. */
export interface Pending {
  /** An HMAC of the code. Storing the code would make the store a way in. */
  hash: string;
  issuedAt: number;
  expiresAt: number;
  attempts: number;
  /** Mails sent in the current window, which is what bounds the abuse. */
  sent: number;
  windowStartedAt: number;
}

export interface Caller {
  count: number;
  resetAt: number;
}

/**
 * Whether a stored value is a record at all.
 *
 * Anything that is not is treated as absent, here and by the sweep, which is
 * why both of these are exported rather than inlined: the sweep's license to
 * collect a record is precisely that this file would ignore it.
 */
export const isPending = (value: unknown): value is Pending =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Pending).hash === 'string' &&
  typeof (value as Pending).expiresAt === 'number' &&
  typeof (value as Pending).windowStartedAt === 'number';

export const isCaller = (value: unknown): value is Caller =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Caller).count === 'number' &&
  typeof (value as Caller).resetAt === 'number';

/**
 * Whether the day this record counts mail in has run out.
 *
 * The one predicate the sweep most needs to agree with, so it is written once.
 * A rolled window is the same as never having asked: the count starts again
 * below, and the sweep may take the record away entirely once the code on it
 * has also expired.
 */
export const windowRolled = (record: Pending, now: number): boolean =>
  now - record.windowStartedAt > DAY_MS;

const json = (body: unknown, status: number): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Cache-Control': 'private, no-store, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/**
 * The body, or null, without believing the declared length.
 *
 * The same read `sync` does and for the same reason: `content-length` is a
 * number the caller chose. The cap here is far smaller, because the largest
 * honest request is an address and six digits.
 */
const bodyOf = async (request: Request): Promise<Record<string, unknown> | null> => {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Who is asking, as far as anything here can tell.
 *
 * Netlify sets the first of these and it is the one to trust. **The second is
 * a header the caller wrote**, so on any host that does not set the first, the
 * per-caller limit is advisory: somebody rotating it is not counted. That is
 * worth saying rather than implying, and it is not the load-bearing bound
 * anyway. What stops an address being mailed is the cooldown and the daily
 * cap, and those are keyed by the address rather than by whoever asked.
 *
 * A caller that cannot be identified at all is not refused, because refusing
 * would break every deployment that sets neither header.
 */
const callerOf = (request: Request): string | null =>
  request.headers.get('x-nf-client-connection-ip') ||
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  null;

/**
 * Whether this caller has asked too often, counting this ask.
 *
 * Deliberately not a read-modify-write with a compare-and-swap. Two requests
 * racing can each read the same count and one of them goes uncounted, which
 * costs one request past the limit and is not worth a retry loop in front of a
 * mailer: the number that matters is twenty an hour, not exactly twenty.
 */
const overCallerLimit = async (
  store: CodeStore,
  secret: string,
  caller: string | null,
  now: number,
): Promise<boolean> => {
  if (caller === null) return false;
  const key = `${CALLER_PREFIX}${await hmacHex(secret, 'log.signin.caller.' + caller)}`;
  const found = await store.get(key, { type: 'json' });
  // Anything that is not a live record is nothing: an hour that has run out
  // and an unreadable value both start the count again. The sweep collects on
  // the same reading, which is what makes collecting one safe.
  const held = isCaller(found) && found.resetAt > now ? found : null;
  const count = (held === null ? 0 : held.count) + 1;
  if (count > CALLER_LIMIT) return true;
  await store.setJSON(key, {
    count,
    resetAt: held === null ? now + CALLER_WINDOW_MS : held.resetAt,
  } satisfies Caller);
  return false;
};

/** Where an address's record lives, which is not anywhere the address is. */
const pendingKey = async (secret: string, email: string): Promise<string> =>
  `${CODE_PREFIX}${await hmacHex(secret, 'log.signin.address.' + normalizeEmail(email))}`;

/** What is compared against, which is never the code itself. */
const hashOf = (secret: string, email: string, code: string): Promise<string> =>
  hmacHex(secret, `log.signin.code.${normalizeEmail(email)}.${code}`);

/**
 * Ask for a code.
 *
 * Answers 202 to everything it did not refuse outright, whether a mail was
 * sent or the caps quietly stopped one. A caller cannot tell those apart and
 * that is the point: the alternative is an endpoint that reports whether an
 * address has been active, which is most of what hiding the customer list was
 * for.
 */
const askFor = async (
  request: Request,
  { secret, store: open, mail, now: clock, code: draw = randomCode }: Surroundings,
): Promise<Response> => {
  const body = await bodyOf(request);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  // The one refusal that can be specific, because it is about the string in
  // front of somebody rather than about anything this knows.
  if (!looksLikeEmail(email)) return json({ error: 'rejected' }, 400);

  const store = open();
  if (store === null) {
    console.error('signin: no blob store configured');
    return json({ error: 'off' }, 503);
  }

  const now = clock();
  if (await overCallerLimit(store, secret, callerOf(request), now)) {
    return json({ error: 'throttled' }, 429);
  }

  const key = await pendingKey(secret, email);
  let held: Pending | null = null;
  try {
    const found = await store.get(key, { type: 'json' });
    held = isPending(found) ? found : null;
  } catch {
    console.error('signin: could not read the pending record');
    return json({ error: 'unreachable' }, 503);
  }

  // A window that has rolled is the same as never having asked, so the record
  // is overwritten and the count starts again. `signinSweep.ts` takes such a
  // record away once its code has also expired, which is the point at which
  // neither path here would read anything from it.
  const current = held !== null && !windowRolled(held, now) ? held : null;
  const sent = current === null ? 0 : current.sent;
  const windowStartedAt = current === null ? now : current.windowStartedAt;

  // Both caps answer 202 without mailing. Telling somebody which one they hit
  // would say how much mail that address has had, which is not their business
  // unless it is their address, and this cannot tell.
  if (current !== null && now - current.issuedAt < COOLDOWN_MS) return json(null, 202);
  if (sent >= DAILY_LIMIT) return json(null, 202);

  const code = draw();
  const record: Pending = {
    hash: await hashOf(secret, email, code),
    issuedAt: now,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    sent: sent + 1,
    windowStartedAt,
  };

  // Written before the mail goes, so a code that reaches somebody is always
  // one this will accept. The other order loses the race in the direction that
  // matters: a person reading a code that was never stored.
  try {
    await store.setJSON(key, record);
  } catch {
    console.error('signin: could not write the pending record');
    return json({ error: 'unreachable' }, 503);
  }

  if (!(await mail(email, code))) {
    // Put back what was there, or take away what was not. Leaving the record
    // would spend one of the day's five and start a cooldown for a mail that
    // was never sent, so the retry a person makes straight away would be
    // silently ignored.
    console.error('signin: the code was not mailed');
    try {
      if (held === null) await store.delete(key);
      else await store.setJSON(key, held);
    } catch {
      console.error('signin: could not undo the pending record');
    }
    return json({ error: 'unreachable' }, 503);
  }

  return json(null, 202);
};

/**
 * Trade a code for a token.
 *
 * Every refusal that is not a rate limit is the same 400: a code that is
 * wrong, expired, already spent, or was never issued for that address are one
 * answer, because telling them apart tells somebody which addresses have asked.
 */
const redeem = async (
  request: Request,
  { secret, store: open, now: clock }: Surroundings,
): Promise<Response> => {
  const body = await bodyOf(request);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (email === '' || code === '') return json({ error: 'rejected' }, 400);

  const store = open();
  if (store === null) {
    console.error('signin: no blob store configured');
    return json({ error: 'off' }, 503);
  }

  const now = clock();
  if (await overCallerLimit(store, secret, callerOf(request), now)) {
    return json({ error: 'throttled' }, 429);
  }

  const key = await pendingKey(secret, email);
  let held: Pending | null = null;
  try {
    const found = await store.get(key, { type: 'json' });
    held = isPending(found) ? found : null;
  } catch {
    console.error('signin: could not read the pending record');
    return json({ error: 'unreachable' }, 503);
  }

  if (held === null || held.expiresAt <= now) return json({ error: 'rejected' }, 400);
  if (held.attempts >= MAX_ATTEMPTS) {
    // Dead rather than merely refused: a code that has been guessed at five
    // times is a code somebody is working on, and leaving it alive for the
    // rest of its fifteen minutes is leaving them to it.
    await store.delete(key).catch(() => {});
    return json({ error: 'throttled' }, 429);
  }

  if (!safeEqual(held.hash, await hashOf(secret, email, code))) {
    await store
      .setJSON(key, { ...held, attempts: held.attempts + 1 } satisfies Pending)
      .catch(() => {});
    return json({ error: 'rejected' }, 400);
  }

  // Spent before it is answered, so a code that raced itself cannot be
  // redeemed twice. A delete that fails is a code that stays live for its
  // fifteen minutes, which is worth a 503 rather than a token: the alternative
  // hands out a credential and leaves the way to it open.
  try {
    await store.delete(key);
  } catch {
    console.error('signin: could not spend the code');
    return json({ error: 'unreachable' }, 503);
  }

  const token = await mintToken(secret, {
    subject: await subjectForEmail(secret, email),
    // Nothing here can find out whether somebody has bought, and nothing in
    // this app asks any more. See `mintToken`.
    tier: 'free',
    expiresAt: now + TOKEN_TTL_MS,
  });
  return json({ token }, 200);
};

/**
 * Both halves, routed on the path.
 *
 * One function rather than two because they share every rule above the split:
 * the same key, the same store, the same caller limit and the same refusal to
 * say why.
 */
export const handleSignIn = async (
  request: Request,
  surroundings: Surroundings,
): Promise<Response> => {
  if (!surroundings.secret) {
    // Names only, never values, and in the deploy log rather than the answer.
    console.error('signin: refusing every request; unset: GATE_SECRET');
    return json({ error: 'off' }, 503);
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  const { pathname } = new URL(request.url);
  if (pathname === '/api/signin') return askFor(request, surroundings);
  if (pathname === '/api/signin/code') return redeem(request, surroundings);
  return json({ error: 'rejected' }, 404);
};
