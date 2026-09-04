/**
 * Asking Untilt's sign-in for a token.
 *
 * ## Why there is a second shape of the same endpoint
 *
 * Untilt's `/api/signin` answers a browser with a 303 carrying a `Set-Cookie`,
 * and that cookie is `__Host-` prefixed and `HttpOnly`: unreadable by script by
 * design, unreachable from another registrable domain by definition, and
 * meaningless to a native app with no browser cookie jar at all. So it answers
 * a caller that asks for JSON with the token in the body instead. Nothing about
 * how the token is minted, signed or checked differs between the two.
 *
 * The contract:
 *
 *     POST /api/signin            { email }          -> 202, no body
 *     POST /api/signin/code       { email, code }    -> 200 { token }
 *                                                       400 { error }
 *                                                       429 { error }
 *
 * Both take `Accept: application/json`, which is what makes the difference:
 * without it the same request is answered with a page and a cookie, exactly as
 * it always was. A refusal is 400 rather than 401 because that is the status
 * the page carries for the same condition, and one status per outcome across
 * both representations is worth more than matching a convention.
 *
 * The first mails a link and a code, and answers 202 whether or not the
 * address is one it has heard of, because an endpoint that says *no customer*
 * is an endpoint that tells a stranger who bought. The second trades a code
 * for the token. Both are already rate limited and both already refuse to mail
 * an address Stripe has never seen; none of that moves.
 *
 * **The code, and not the link.** A link cannot reach an installed app: mail
 * opens links in the browser, always, and an installed app keeps its own
 * storage, so a player who tapped one would be signed in to Safari and come
 * back to an app as signed out as they left it. Untilt learned that and built
 * the code flow for it. A native app has the same problem with no way around.
 *
 * ## What this is still not
 *
 * Nothing in the app calls this. It is tested against a fake `fetch` rather
 * than a live server, which proves it handles the answers the contract
 * describes and proves nothing about whether the server gives them. See
 * SYNC.md.
 */

/** Where the family's sign-in lives. One host mints for all three apps. */
export const SIGNIN_ORIGIN = 'https://untilt.poker';

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
