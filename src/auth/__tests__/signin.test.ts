/**
 * The sign-in client, against a fake `fetch`.
 *
 * These prove the client handles the answers the contract in `signin.ts`
 * describes. They prove nothing about whether the server gives them, because
 * the endpoint they describe is not built: Untilt's sign-in currently ends in
 * a redirect carrying an HttpOnly cookie, which Log cannot read from another
 * registrable domain or on a device with no cookie jar. See SYNC.md.
 */

import { redeemCode, requestCode, SIGNIN_ORIGIN, type Fetch } from '../signin';

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

describe('asking for a code', () => {
  it('posts the address to the family sign-in', async () => {
    const { fetch, calls } = answering(202);
    expect(await requestCode('player@example.com', { fetch })).toEqual({ ok: true });

    const [call] = calls as unknown as { url: string; init: RequestInit }[];
    expect(call.url).toBe(`${SIGNIN_ORIGIN}/api/signin`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body as string)).toEqual({ email: 'player@example.com' });
  });

  it('trims what was typed, because a mail app will have added a space', async () => {
    const { fetch, calls } = answering(202);
    await requestCode('  player@example.com  ', { fetch });
    const [call] = calls as unknown as { init: RequestInit }[];
    expect(JSON.parse(call.init.body as string)).toEqual({ email: 'player@example.com' });
  });

  it('reads a rate limit as its own answer, since retrying is the wrong move', async () => {
    const { fetch } = answering(429);
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
    const { fetch, calls } = answering(200, { token: '1700000000.full.cus_1.sig' });
    expect(await redeemCode('player@example.com', '123456', { fetch })).toEqual({
      ok: true,
      token: '1700000000.full.cus_1.sig',
    });
    const [call] = calls as unknown as { url: string; init: RequestInit }[];
    expect(call.url).toBe(`${SIGNIN_ORIGIN}/api/signin/code`);
    expect(JSON.parse(call.init.body as string)).toEqual({
      email: 'player@example.com',
      code: '123456',
    });
  });

  it('reads a wrong code as rejected, so the screen can ask again', async () => {
    const { fetch } = answering(401, { error: 'no' });
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
