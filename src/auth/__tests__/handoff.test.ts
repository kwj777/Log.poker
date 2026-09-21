/**
 * Taking delivery of a purchase made at another app's door.
 *
 * Two properties carry most of the weight here, and neither is about the happy
 * path.
 *
 * **Nothing that fails signs anybody out.** This file cannot assert that on
 * its own -- the storing is `SessionManager`'s -- so what it asserts is the
 * half that makes it possible: every failure answers a reason and never a
 * token, so there is nothing for a caller to accidentally store.
 *
 * **An outage is never read as "they did not pay".** Untilt answers 503 rather
 * than a free token when Stripe is unreachable, and this has to carry that
 * through as `unreachable` rather than flattening it into a refusal, or the
 * screen above tells a buyer the wrong thing during somebody else's outage.
 */

import {
  CODE_PATTERN,
  HANDOFF_ORIGIN,
  HANDOFF_PATH,
  claimHandoff,
  codeFromFragment,
} from '../handoff';

const CODE = 'dkbiLReh_P_zqqLzPxrHqSpOx_netFX_FoLM9Od52xg';
const TOKEN = '1792069846.full.log_335f91907e84facba84e2a3cefc8e846.c2ln';

const answering = (
  status: number,
  body: unknown = null,
): { fetch: jest.Mock; sent: () => { url: string; init: RequestInit } } => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new Error('not json');
        return body;
      },
    } as unknown as Response;
  });
  return { fetch, sent: () => seen as unknown as { url: string; init: RequestInit } };
};

describe('reading the code out of the fragment', () => {
  it('takes one the way the browser reports it, hash and all', () => {
    expect(codeFromFragment(`#code=${CODE}`)).toBe(CODE);
  });

  it('and without the hash, so a caller need not remember which it has', () => {
    expect(codeFromFragment(`code=${CODE}`)).toBe(CODE);
  });

  it('refuses anything that is not the shape a code comes in', () => {
    // The shape check is what stops a fragment somebody typed from making this
    // app post arbitrary text to another origin.
    expect(codeFromFragment('#code=hello')).toBeNull();
    expect(codeFromFragment(`#code=${CODE}x`)).toBeNull();
    expect(codeFromFragment(`#code=${CODE.slice(0, 42)}`)).toBeNull();
    expect(codeFromFragment('#code=' + '.'.repeat(43))).toBeNull();
  });

  it('and anything that is not a hand-off at all', () => {
    expect(codeFromFragment('')).toBeNull();
    expect(codeFromFragment('#')).toBeNull();
    expect(codeFromFragment('#play=intro')).toBeNull();
    expect(codeFromFragment('#code=')).toBeNull();
  });

  it('agrees with the shape Untilt mints', () => {
    // 32 bytes as base64url is 43 characters and no padding. The pattern is a
    // copy of Untilt's rather than a shared import, so it is worth pinning.
    expect(CODE).toHaveLength(43);
    expect(CODE_PATTERN.test(CODE)).toBe(true);
  });
});

describe('trading the code for a token', () => {
  it('asks the app that can answer, at the path it answers on', async () => {
    const { fetch, sent } = answering(200, { token: TOKEN });
    await claimHandoff(CODE, { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(sent().url).toBe(`${HANDOFF_ORIGIN}${HANDOFF_PATH}`);
    expect(sent().init.method).toBe('POST');
    expect(JSON.parse(String(sent().init.body))).toEqual({ code: CODE });
  });

  it('and sends no credentials, which is what the other end allows', async () => {
    // Untilt's answer carries no Access-Control-Allow-Credentials, so asking
    // for them would fail the exchange rather than improve it. There is also
    // nothing to send: this app holds no cookie on that origin.
    const { fetch, sent } = answering(200, { token: TOKEN });
    await claimHandoff(CODE, { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(sent().init.credentials).toBe('omit');
  });

  it('answers the token and nothing else', async () => {
    const { fetch } = answering(200, { token: TOKEN });
    await expect(
      claimHandoff(CODE, { fetch: fetch as unknown as typeof globalThis.fetch }),
    ).resolves.toEqual({ ok: true, token: TOKEN });
  });

  it('never sends a code that is not one, and never asks', async () => {
    const { fetch } = answering(200, { token: TOKEN });
    await expect(
      claimHandoff('nonsense', { fetch: fetch as unknown as typeof globalThis.fetch }),
    ).resolves.toEqual({ ok: false, reason: 'none' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('what a refusal means, and what it must never mean', () => {
  const reasonFor = async (status: number, body: unknown = {}) => {
    const { fetch } = answering(status, body);
    return claimHandoff(CODE, { fetch: fetch as unknown as typeof globalThis.fetch });
  };

  it('reads a 404 as nothing to hand over', async () => {
    // Unknown, expired, already spent, minted for another door, or an account
    // closed since. Untilt says one thing for all of them on purpose.
    await expect(reasonFor(404)).resolves.toEqual({ ok: false, reason: 'none' });
  });

  it('reads a 403 as this person having nothing for us yet', async () => {
    await expect(reasonFor(403)).resolves.toEqual({ ok: false, reason: 'refused' });
  });

  it('reads a 429 as asking too often', async () => {
    await expect(reasonFor(429)).resolves.toEqual({ ok: false, reason: 'throttled' });
  });

  it('reads a 503 as an outage and never as a refusal', async () => {
    // The one that matters. Untilt answers 503 rather than a free token when
    // Stripe is unreachable, precisely so this end does not tell somebody who
    // paid ninety-nine dollars that they did not. Flattening it into `refused`
    // would throw that away at the last step.
    await expect(reasonFor(503)).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('reads a dead network the same way', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('no route to host');
    });
    await expect(
      claimHandoff(CODE, { fetch: fetch as unknown as typeof globalThis.fetch }),
    ).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('and a 200 carrying something that is not a token', async () => {
    // A server that changed under us. Safer to read as unreachable than to
    // hand a non-token onward as a token.
    await expect(reasonFor(200, { token: 42 })).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
    await expect(reasonFor(200, { token: '' })).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
    await expect(reasonFor(200, undefined)).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('answers a token on no path but the one that worked', async () => {
    // The property the screen above rests on: there is never anything to store
    // unless the exchange actually succeeded, so no failure can sign anybody
    // out or sign them in as somebody else.
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const answer = await reasonFor(status);
      expect(answer.ok).toBe(false);
      expect(answer).not.toHaveProperty('token');
    }
  });
});

describe('an answer whose body never finishes', () => {
  it('gives up rather than leaving the hand-off screen waiting for good', async () => {
    // The timeout covered the fetch and not the body, and `fetch` settles on
    // the headers. A server that answered 200 and then stopped sending left
    // this read pending with nothing to cancel it, and `app/claim.tsx` awaits
    // it: the link a player followed from another app simply never finishes.
    const fetch = jest.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      } as unknown as Response;
    });

    const answer = await claimHandoff(CODE, { fetch: fetch as never, timeoutMs: 20 });
    expect(answer).toEqual({ ok: false, reason: 'unreachable' });
  });
});
