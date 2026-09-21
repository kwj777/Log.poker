/**
 * The sign-in client, against a fake `fetch`.
 *
 * These prove the client handles the answers the contract in `signin.ts`
 * describes. They prove nothing about whether the server gives them: the
 * endpoint lives in another repository, and the two are held together by that
 * written contract rather than by anything either side can check alone.
 */

import { redeemCode, renewToken, requestCode, SIGNIN_ORIGIN, type Fetch } from '../signin';

const answering = (status: number, body?: unknown): { fetch: Fetch; calls: Request[] } => {
  const calls: Request[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init } as unknown as Request);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError('no body');
        return body;
      },
    } as Response;
  }) as unknown as Fetch;
  return { fetch, calls };
};

const dead = (): Fetch =>
  (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as Fetch;

/**
 * Headers, and then a body that never arrives.
 *
 * A captive portal or a proxy that answers 200 and stops sending. `fetch`
 * settles on the headers, so only the body read is left hanging and the abort
 * signal is the one thing that can end it.
 */
const stallingBody = (): Fetch =>
  (async (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    return {
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    } as unknown as Response;
  }) as unknown as Fetch;

describe('asking for a code', () => {
  it('posts the address to the family sign-in', async () => {
    const { fetch, calls } = answering(202);
    expect(await requestCode('player@example.com', { fetch })).toEqual({ ok: true });

    const [call] = calls as unknown as { url: string; init: RequestInit }[];
    expect(call.url).toBe(`${SIGNIN_ORIGIN}/api/signin`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body as string)).toEqual({ email: 'player@example.com' });
  });

  it('asks for JSON, which is the whole of what makes it a token and not a page', async () => {
    // The same request without this header is answered the way a browser is
    // answered, with a page and a cookie that cannot cross a registrable
    // domain: a 200 that carries nothing this app can use.
    const { fetch, calls } = answering(202);
    await requestCode('player@example.com', { fetch });
    const [call] = calls as unknown as { init: RequestInit }[];
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('trims what was typed, because a mail app will have added a space', async () => {
    const { fetch, calls } = answering(202);
    await requestCode('  player@example.com  ', { fetch });
    const [call] = calls as unknown as { init: RequestInit }[];
    expect(JSON.parse(call.init.body as string)).toEqual({ email: 'player@example.com' });
  });

  it('reads a rate limit as its own answer, since retrying is the wrong move', async () => {
    const { fetch } = answering(429, { error: 'too-many' });
    expect(await requestCode('player@example.com', { fetch })).toEqual({
      ok: false,
      reason: 'throttled',
    });
  });

  it('reads a dead network as unreachable rather than as a rejection', async () => {
    expect(await requestCode('player@example.com', { fetch: dead() })).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('reads a server error as unreachable, which is what it looks like', async () => {
    const { fetch } = answering(503);
    expect(await requestCode('a@b.com', { fetch })).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('trading a code for a token', () => {
  it('returns the token rather than storing it', async () => {
    const { fetch, calls } = answering(200, { token: '1700000000.full.log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.sig' });
    expect(await redeemCode('player@example.com', '123456', { fetch })).toEqual({
      ok: true,
      token: '1700000000.full.log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.sig',
    });
    const [call] = calls as unknown as { url: string; init: RequestInit }[];
    expect(call.url).toBe(`${SIGNIN_ORIGIN}/api/signin/code`);
    expect(JSON.parse(call.init.body as string)).toEqual({
      email: 'player@example.com',
      code: '123456',
    });
  });

  it('sends the Accept header on the redemption too', async () => {
    const { fetch, calls } = answering(200, { token: 'x' });
    await redeemCode('a@b.com', '1', { fetch });
    const [call] = calls as unknown as { init: RequestInit }[];
    expect((call.init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('reads a wrong code as rejected, so the screen can ask again', async () => {
    // 400 rather than 401: it is the status the page carries for the same
    // condition, and one status per outcome beats matching a convention.
    const { fetch } = answering(400, { error: 'refused' });
    expect(await redeemCode('a@b.com', '000000', { fetch })).toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('refuses a success that carries no token', async () => {
    // A server that changed under us. Handing a non-token onward as a token
    // would fail later and somewhere less obvious.
    for (const body of [{}, { token: '' }, { token: 42 }, null]) {
      const { fetch } = answering(200, body);
      expect(await redeemCode('a@b.com', '1', { fetch })).toEqual({
        ok: false,
        reason: 'unreachable',
      });
    }
  });

  it('refuses a success that is not JSON at all', async () => {
    const { fetch } = answering(200);
    expect(await redeemCode('a@b.com', '1', { fetch })).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('can be pointed somewhere else, which is how it gets tested against a branch', async () => {
    const { fetch, calls } = answering(200, { token: 'x' });
    await redeemCode('a@b.com', '1', { fetch, origin: 'https://deploy-preview.untilt.poker' });
    const [call] = calls as unknown as { url: string }[];
    expect(call.url).toBe('https://deploy-preview.untilt.poker/api/signin/code');
  });
});

/**
 * Trading a token that still works for one that lasts another thirty days.
 *
 * The property worth proving is the one about failure: none of these may leave
 * the caller thinking the token it passed in is gone. It answers with a reason
 * and nothing else, and the caller keeps what it had.
 */
describe('renewing a token', () => {
  const HELD = '1800000000.free.log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.signature';

  it('sends the token it is renewing, as a bearer, and asks for JSON', async () => {
    const { fetch, calls } = answering(200, { token: 'fresher' });
    expect(await renewToken(HELD, { fetch })).toEqual({ ok: true, token: 'fresher' });

    const [call] = calls as unknown as { url: string; init: RequestInit }[];
    expect(call.url).toBe(`${SIGNIN_ORIGIN}/api/signin/renew`);
    expect(call.init.method).toBe('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${HELD}`);
    // Without this the endpoint answers the way it answers a browser.
    expect(headers.Accept).toBe('application/json');
  });

  it('reads a refusal as a refusal rather than as a dead network', async () => {
    // 401 is a token the server will not renew; 403 is one it will not renew
    // for this subject. Neither is worth retrying and both leave the token.
    expect(await renewToken(HELD, { fetch: answering(401).fetch })).toEqual({
      ok: false,
      reason: 'rejected',
    });
    expect(await renewToken(HELD, { fetch: answering(403).fetch })).toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('and a dead network as unreachable', async () => {
    expect(await renewToken(HELD, { fetch: dead() })).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('and a 200 with no token in it as unreachable, rather than passing it on', async () => {
    // A server that changed under us. Handing a non-token onward as a token
    // would replace a working credential with something that is not one.
    expect(await renewToken(HELD, { fetch: answering(200, {}).fetch })).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(await renewToken(HELD, { fetch: answering(200).fetch })).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });
});

describe('an answer whose body never finishes', () => {
  it('gives up on a redemption rather than spinning the button for good', async () => {
    // The timeout used to be cleared the moment `fetch` settled, which is when
    // the headers arrive and before a byte of the body has been read. Nothing
    // was left to cancel the read, so this promise never settled and the
    // sign-in card sat on its spinner for the rest of the session.
    const outcome = await redeemCode('a@b.com', '123456', {
      fetch: stallingBody(),
      timeoutMs: 20,
    });
    expect(outcome).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('and on a renewal, which is awaited at launch', async () => {
    // Worse than the one above, because nobody is watching it: `renewIfDue`
    // awaits this on every launch, so the renewal never finished and never
    // failed, and the token quietly ran out thirty days later.
    const outcome = await renewToken('a.b.c.d', { fetch: stallingBody(), timeoutMs: 20 });
    expect(outcome).toEqual({ ok: false, reason: 'unreachable' });
  });
});
