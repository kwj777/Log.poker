/**
 * Taking delivery of a purchase made at another one of the family's apps.
 *
 * One purchase covers all three, and `log.poker`, `untilt.poker` and
 * `tiltproof.poker` are three registrable domains: no cookie crosses them and
 * no storage is shared. So somebody who paid at Untilt's door arrives here a
 * stranger, however much the three apps agree about who they are. Untilt's
 * `HANDOFF.md` is the protocol that fixes it; this file is Log's end of it.
 *
 * The whole exchange:
 *
 *     Untilt redirects to  https://log.poker/app/claim#code=<43 chars>
 *     this posts           POST https://untilt.poker/api/family/claim
 *                          { code }             -> 200 { token }
 *                                                  403 | 404 | 429 | 503
 *     the token goes to    SessionManager.signIn
 *
 * ## The code is in the fragment, and that is load bearing
 *
 * A fragment is never sent to a server. It is not in this site's access log,
 * not in Netlify's, not in any proxy between them, and not in the `Referer` of
 * anything the page loads afterward. A query string is in all four. The screen
 * that calls this reads it and replaces the URL in the same breath, so it is
 * not left in history either.
 *
 * ## Nothing that fails here signs anybody out
 *
 * This is the property worth stating rather than inferring, and it is the same
 * one `renewToken` states next door. A hand-off that does not work is a person
 * who is exactly as signed in as they were a moment ago -- which for most of
 * them is not at all, and the ordinary sign-in is one screen away. Untilt's
 * endpoint is built to make that easy to honor: it answers 503 rather than a
 * free token when Stripe is unreachable, precisely so that an outage is never
 * read here as somebody not having paid.
 *
 * ## What this does not do
 *
 * **It does not store the token.** That is `SessionManager`'s job, and this
 * file has no business knowing where a token lives -- the same division
 * `redeemCode` keeps.
 *
 * **It does not decide what to do about a session already held.** A change of
 * subject is a change of bucket on this side, so swapping quietly would move
 * somebody's history out from under them. The screen asks. See `app/claim.tsx`.
 *
 * **It is web only.** A code in a URL fragment is a browser mechanism, and
 * `HANDOFF.md` says in as many words that native has its own way across and
 * its own threat model. Nothing here is reachable from the native app.
 */

import { REQUEST_TIMEOUT_MS, type Fetch } from './signin';

/**
 * Where the hand-off is spent. Untilt's, because it is the only app in the
 * family that can turn a person into a tier: it holds the Stripe customers and
 * the mark tying an address to one.
 */
export const HANDOFF_ORIGIN = 'https://untilt.poker';

export const HANDOFF_PATH = '/api/family/claim';

/**
 * What a code looks like: 32 bytes as base64url, which is 43 characters and no
 * padding. Checked before anything is sent, so a fragment somebody typed
 * cannot make this app post arbitrary text to another origin.
 *
 * Copied from `CODE_PATTERN` in Untilt's `lib/handoff.js`. A shape, not a
 * credential -- being right about it saves a round trip and being wrong about
 * it costs one, which is why it is safe to keep a copy rather than share one.
 */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type HandoffFailure =
  /** There was nothing to hand over: unknown, expired, spent, or wrong door. */
  | 'none'
  /** Untilt has nothing to hand over for this person yet, or refused us. */
  | 'refused'
  /** Asked too often. */
  | 'throttled'
  /** Switched off, an outage, or a dead network. Never a statement about money. */
  | 'unreachable';

export type Handoff = { ok: true; token: string } | { ok: false; reason: HandoffFailure };

interface Options {
  fetch?: Fetch;
  origin?: string;
  timeoutMs?: number;
}

/**
 * The code in a URL fragment, or null.
 *
 * Takes the whole fragment as the browser reports it, leading `#` and all,
 * because that is what `location.hash` is and the caller should not have to
 * remember to trim it. Anything that is not exactly one well-formed `code` is
 * null: a fragment with other parameters in it is not one of ours.
 */
export const codeFromFragment = (fragment: string): string | null => {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (raw === '') return null;

  let code: string | null = null;
  try {
    code = new URLSearchParams(raw).get('code');
  } catch {
    return null;
  }
  return code !== null && CODE_PATTERN.test(code) ? code : null;
};

const failureFor = (status: number): HandoffFailure => {
  if (status === 404) return 'none';
  if (status === 429) return 'throttled';
  // 403 is Untilt saying this person has nothing for us -- a passcode holder,
  // a closed account, or one with no address to derive a family name from.
  // Everything else in the 4xx range is a caller error and reads the same to
  // somebody looking at a screen. A 5xx is theirs, not the person's.
  return status >= 400 && status < 500 ? 'refused' : 'unreachable';
};

/**
 * Trade a hand-off code for a family token.
 *
 * Cross-origin, so the browser sends a preflight first and Untilt's endpoint
 * answers it. **No credentials**, deliberately and doubly: this app has no
 * cookie on that origin to send, and Untilt's answer carries no
 * `Access-Control-Allow-Credentials`, so asking for them would fail the
 * exchange rather than improve it. The code in the body is the whole of what
 * proves anything.
 *
 * Every way of failing collapses into four outcomes, because a screen has one
 * sentence to spend and none of the finer distinctions is something the person
 * on the other end can act on differently.
 */
export const claimHandoff = async (code: string, options: Options = {}): Promise<Handoff> => {
  const {
    fetch = globalThis.fetch,
    origin = HANDOFF_ORIGIN,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options;

  if (!CODE_PATTERN.test(code)) return { ok: false, reason: 'none' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${origin}${HANDOFF_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }

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
