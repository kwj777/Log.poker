/**
 * Asking for a token.
 *
 * ## Which sign-in this talks to, and why it moved
 *
 * Untilt's. Then Log's, on `log.poker`, and the switch is the whole of what
 * made cross-device history actually free rather than free on paper.
 *
 * Untilt's `/api/signin` will not mail a code to an address Stripe has no
 * customer for -- *only somebody who has bought can be reached* -- which was
 * right while sync was sold and wrong the moment it was not. Removing Log's
 * tier check let a free tier sync; it did not let a free player get a token to
 * sync with. `netlify/functions/signin.mts` is the door that does, it mints the
 * free tier for anybody who can read their mail, and Untilt's endpoint is
 * untouched.
 *
 * **The contract is Untilt's, deliberately.** The same two paths, the same
 * bodies, the same statuses, so this file did not change shape and neither did
 * the screen above it. What changed is one constant.
 *
 * The contract:
 *
 *     POST /api/signin            { email }          -> 202, no body
 *     POST /api/signin/code       { email, code }    -> 200 { token }
 *                                                       400 { error }
 *                                                       429 { error }
 *
 * `Accept: application/json` is sent on both and is no longer what makes the
 * difference: Log's endpoint answers JSON to everybody, having no page and no
 * cookie to answer with. It stays because the header is honest and because a
 * deploy pointed back at Untilt would need it. A refusal is 400 rather than
 * 401 for the same reason it always was: it is the status the family's other
 * representation carries for the same condition.
 *
 * The first mails a code and answers 202 whether or not one was sent, because
 * the rate limits would otherwise report how much mail an address has had. The
 * second trades a code for the token, and cannot tell a wrong code from an
 * address it never issued one for. See `signinEndpoint.ts` for both.
 *
 * **The code, and not the link.** A link cannot reach an installed app: mail
 * opens links in the browser, always, and an installed app keeps its own
 * storage, so a player who tapped one would be signed in to Safari and come
 * back to an app as signed out as they left it. Untilt learned that and built
 * the code flow for it. Log's mails no link at all.
 *
 * ## What this is still not
 *
 * It is tested against a fake `fetch` rather than a live server, which proves
 * it handles the answers the contract describes and proves nothing about
 * whether the server gives them. `signinEndpoint.test.ts` is the other half and
 * runs the server's rules; `scripts/check-gate.mjs` is the only thing that puts
 * the two together against a deploy. See SYNC.md.
 */

/**
 * Where Log's sign-in lives.
 *
 * Absolute rather than relative, because this app also runs natively, where a
 * path means nothing. On web the app is served from `log.poker/app` and this
 * answers on `log.poker`, so it is same-origin there and there is no preflight
 * to answer, exactly as with `/api/sync`.
 */
export const SIGNIN_ORIGIN = 'https://log.poker';

/** Long enough for a cold serverless start, short enough to fail on a dead network. */
export const REQUEST_TIMEOUT_MS = 15_000;

export type SignInFailure =
  /** The address or the code was not accepted. Say so and let them retry. */
  | 'rejected'
  /** Asked too often. The endpoint rate limits ahead of anything expensive. */
  | 'throttled'
  /** No network, a timeout, or an answer that was not the shape promised. */
  | 'unreachable';

export type CodeRequest = { ok: true } | { ok: false; reason: SignInFailure };

export type Redemption = { ok: true; token: string } | { ok: false; reason: SignInFailure };

/** Injected so the tests do not need a network and the app does not need a mock. */
export type Fetch = typeof globalThis.fetch;

interface Options {
  fetch?: Fetch;
  origin?: string;
  timeoutMs?: number;
}

/**
 * A response, or null if asking did not work.
 *
 * Every network failure collapses to one outcome on purpose. A caller cannot
 * do anything different about DNS than about a socket closing, and the screen
 * that reads this has one sentence to spend.
 */
const post = async (
  path: string,
  body: unknown,
  { fetch = globalThis.fetch, origin = SIGNIN_ORIGIN, timeoutMs = REQUEST_TIMEOUT_MS }: Options,
): Promise<Response | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${origin}${path}`, {
      method: 'POST',
      // Accept is what the endpoint keys on. Without it the server answers the
      // way it answers a browser, with a page and a cookie that cannot cross a
      // registrable domain, and every call here would fail on a 200.
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const failureFor = (status: number): SignInFailure => {
  if (status === 429) return 'throttled';
  // 4xx is the caller's problem and is worth showing; 5xx is not, and reads as
  // the same dead end to somebody staring at a form.
  return status >= 400 && status < 500 ? 'rejected' : 'unreachable';
};

/**
 * Ask for a code to be mailed.
 *
 * A 202 does not mean an address exists, and the screen must not imply that it
 * does. Anything else would let anybody test whether a given person has bought.
 */
export const requestCode = async (email: string, options: Options = {}): Promise<CodeRequest> => {
  const response = await post('/api/signin', { email: email.trim() }, options);
  if (response === null) return { ok: false, reason: 'unreachable' };
  if (!response.ok) return { ok: false, reason: failureFor(response.status) };
  return { ok: true };
};

/**
 * Trade a mailed code for the token.
 *
 * The token is returned rather than stored: keeping it is `SessionManager`'s
 * job, and this file has no business knowing where a token lives.
 */
export const redeemCode = async (
  email: string,
  code: string,
  options: Options = {},
): Promise<Redemption> => {
  const response = await post(
    '/api/signin/code',
    { email: email.trim(), code: code.trim() },
    options,
  );
  if (response === null) return { ok: false, reason: 'unreachable' };
  if (!response.ok) return { ok: false, reason: failureFor(response.status) };

  // A 200 carrying something else is a server that changed under us, and it is
  // safer to read as unreachable than to hand a non-token onward as a token.
  try {
    const body: unknown = await response.json();
    const token = (body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || token === '') return { ok: false, reason: 'unreachable' };
    return { ok: true, token };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
};
