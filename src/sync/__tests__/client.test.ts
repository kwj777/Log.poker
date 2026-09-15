/**
 * The client, against a fake `fetch`.
 *
 * Its whole job is to turn every way a request can go wrong into one of three
 * answers, because the loop above it does something different for each and
 * nothing different within them. The one worth telling apart is `unauthorized`,
 * which means stop rather than wait: no amount of retrying fixes a token
 * somebody has to replace by signing in again.
 */

import { backoffMs, eraseRemote, sync, SYNC_URL, type Fetch } from '../client';
import { emptyChangeSet } from '../protocol';

const answering = (status: number, body?: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
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

const request = { since: 0, changes: emptyChangeSet(), device: 'device-00000001' };

describe('one round trip', () => {
  it('sends the cursor, the changes and the token', async () => {
    const { fetch, calls } = answering(200, { cursor: 5, changes: emptyChangeSet() });
    const outcome = await sync(
      { since: 3, changes: emptyChangeSet(), device: 'device-00000001' },
      'tok.en.abc.sig',
      { fetch },
    );

    expect(outcome).toEqual({
      ok: true,
      response: { cursor: 5, changes: emptyChangeSet(), more: false, collectedThrough: 0 },
    });
    expect(JSON.parse(calls[0].init.body as string).device).toBe('device-00000001');
    expect(calls[0].url).toBe(SYNC_URL);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok.en.abc.sig');
    expect(headers.Accept).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string).since).toBe(3);
  });

  it('reads an unauthorized answer as its own thing, because waiting will not fix it', async () => {
    for (const status of [401, 403]) {
      const { fetch } = answering(status, { error: 'no' });
      expect(await sync(request, 'x', { fetch })).toEqual({ ok: false, reason: 'unauthorized' });
    }
  });

  it('reads a 402 as unpaid, which signing in again would not mend', async () => {
    /**
     * Its own reason rather than folded into `unauthorized`, because the copy
     * for the two says opposite things: one tells somebody to sign in again
     * and the other must not, since they already have and it is not the
     * problem. Nothing answers 402 today; the endpoint only can once sync is
     * in the pass.
     */
    const { fetch } = answering(402, { error: 'unpaid' });
    expect(await sync(request, 'x', { fetch })).toEqual({ ok: false, reason: 'unpaid' });
  });

  it('separates our fault from theirs, because the loop treats them differently', async () => {
    const refused = answering(400, { error: 'refused' });
    expect(await sync(request, 'x', { fetch: refused.fetch })).toEqual({
      ok: false, reason: 'refused',
    });
    const broken = answering(503, { error: 'unreachable' });
    expect(await sync(request, 'x', { fetch: broken.fetch })).toEqual({
      ok: false, reason: 'unreachable',
    });
  });

  it('reads a dead network as unreachable rather than throwing at a loop', async () => {
    expect(await sync(request, 'x', { fetch: dead() })).toEqual({
      ok: false, reason: 'unreachable',
    });
  });

  it('refuses a 200 with no cursor on it', async () => {
    // A server that changed under us. Acting on half an answer is worse than
    // treating the whole thing as a failed request.
    for (const body of [{}, { cursor: 'soon' }, null]) {
      const { fetch } = answering(200, body);
      expect(await sync(request, 'x', { fetch })).toEqual({ ok: false, reason: 'unreachable' });
    }
  });

  it('refuses a 200 that is not JSON at all', async () => {
    const { fetch } = answering(200);
    expect(await sync(request, 'x', { fetch })).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('takes a cursor with no changes beside it as nothing to apply', async () => {
    const { fetch } = answering(200, { cursor: 9 });
    const outcome = await sync(request, 'x', { fetch });
    expect(outcome).toEqual({
      ok: true,
      response: { cursor: 9, changes: emptyChangeSet(), more: false, collectedThrough: 0 },
    });
  });

  it('reads a missing collection line as nothing collected', async () => {
    // Keeping a tombstone too long costs a few hundred bytes. Dropping one too
    // early costs a resurrected session, so absence has to mean keep.
    const { fetch } = answering(200, { cursor: 9, collectedThrough: 'soon' });
    const outcome = await sync(request, 'x', { fetch });
    expect(outcome.ok && outcome.response.collectedThrough).toBe(0);
  });

  it('carries the collection line through when there is one', async () => {
    const { fetch } = answering(200, { cursor: 9, collectedThrough: 5 });
    const outcome = await sync(request, 'x', { fetch });
    expect(outcome.ok && outcome.response.collectedThrough).toBe(5);
  });
});

describe('erasing what the server holds', () => {
  it('is a DELETE with the token and nothing else', async () => {
    const { fetch, calls } = answering(204);
    expect(await eraseRemote('tok', { fetch })).toBe(true);
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('says so rather than throwing when it fails', async () => {
    expect(await eraseRemote('tok', { fetch: dead() })).toBe(false);
    expect(await eraseRemote('tok', { fetch: answering(500).fetch })).toBe(false);
  });
});

describe('how long to wait after a failure', () => {
  it('doubles', () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(3)).toBe(40_000);
  });

  it('stops at five minutes, because a card room has no signal for hours', () => {
    expect(backoffMs(20)).toBe(300_000);
    expect(backoffMs(1000)).toBe(300_000);
  });

  it('never returns nothing, which would be a loop with no gap in it', () => {
    for (const attempt of [0, -1, 1]) expect(backoffMs(attempt)).toBeGreaterThanOrEqual(10_000);
  });
});
