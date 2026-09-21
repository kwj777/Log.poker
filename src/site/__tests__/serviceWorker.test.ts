/**
 * The worker, run rather than read.
 *
 * `site.test.ts` holds `public/sw.js` to a handful of strings -- the shell URL,
 * the `/api/` exclusion, the cache version -- which is what stops the file
 * drifting away from the build around it. None of it executes the fetch
 * handler, so what the worker actually answers with was covered by nothing, on
 * the one file whose whole job is what a player sees when the network is not
 * there.
 *
 * Offline is a hard requirement here: this app is used in card rooms, and every
 * read and write it makes goes to IndexedDB. The only thing the network is for
 * is the shell.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const SOURCE = readFileSync(join(__dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8');

const SHELL = '<!doctype html><title>Log</title><body>the app</body>';

interface Worker {
  navigate: (url: string) => Promise<Response>;
  cached: () => Promise<string[]>;
}

/**
 * The worker in a context of its own, over a cache it can really read.
 *
 * A fake `CacheStorage` rather than a stub of the worker: the branch under test
 * is "what does it do when the cache has something", and a stub that answered
 * that question would be answering it on the worker's behalf.
 */
const workerOver = (
  seeded: Record<string, string>,
  answer: () => Promise<Response>,
): Worker => {
  const stores = new Map<string, Map<string, Response>>();
  const shellCache = new Map<string, Response>();
  for (const [url, body] of Object.entries(seeded)) {
    shellCache.set(url, new Response(body, { status: 200 }));
  }

  const open = async (name: string) => {
    if (name.includes('shell')) stores.set(name, shellCache);
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name) as Map<string, Response>;
    return {
      match: async (key: string | Request) => {
        const url = typeof key === 'string' ? key : new URL(key.url).pathname;
        const found = store.get(url);
        return found ? found.clone() : undefined;
      },
      put: async (key: string | Request, value: Response) => {
        const url = typeof key === 'string' ? key : new URL(key.url).pathname;
        store.set(url, value);
      },
      add: async () => undefined,
      addAll: async () => undefined,
    };
  };

  const handlers = new Map<string, (event: unknown) => void>();
  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers.set(type, handler);
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    location: { origin: 'https://log.poker' },
  };

  runInNewContext(SOURCE, {
    self,
    caches: { open, keys: async () => [...stores.keys()], delete: async () => true },
    fetch: answer,
    Request,
    Response,
    URL,
    console,
  });

  return {
    navigate: async (url: string) => {
      let answered: Promise<Response> | null = null;
      const request = new Request(url);
      Object.defineProperty(request, 'mode', { value: 'navigate' });
      (handlers.get('fetch') as (event: unknown) => void)({
        request,
        respondWith: (value: Promise<Response>) => {
          answered = value;
        },
      });
      if (answered === null) throw new Error('the worker did not answer');
      return answered;
    },
    cached: async () => [...shellCache.keys()],
  };
};

const dead = () => Promise.reject(new Error('Failed to fetch'));
const answering = (status: number, body: string) => async () => new Response(body, { status });

describe('a navigation to the app', () => {
  it('serves the network when the network is there', async () => {
    const worker = workerOver({ '/app/index.html': SHELL }, answering(200, 'a fresher shell'));
    expect(await (await worker.navigate('https://log.poker/app/')).text()).toBe('a fresher shell');
  });

  it('serves the shell it has when the network is gone', async () => {
    const worker = workerOver({ '/app/index.html': SHELL }, dead);
    const answer = await worker.navigate('https://log.poker/app/');

    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe(SHELL);
  });

  it('and when the network answers and says no', async () => {
    // The case that was missing. Only a throw reached the shell, so a 502 from
    // the origin or an intermediary was handed over verbatim -- for the length
    // of the incident, on an app that needs no network at all.
    for (const status of [500, 502, 503, 504, 404]) {
      const worker = workerOver(
        { '/app/index.html': SHELL },
        answering(status, '<html><body>Bad Gateway</body></html>'),
      );
      const answer = await worker.navigate('https://log.poker/app/');

      expect(await answer.text()).toBe(SHELL);
      expect(answer.status).toBe(200);
    }
  });

  it('but hands the error over when it has no shell to offer instead', async () => {
    // Then the error is the only account of itself anybody can get, and a
    // blank page would be worse than a bad one.
    const worker = workerOver({}, answering(502, 'Bad Gateway'));
    const answer = await worker.navigate('https://log.poker/app/');

    expect(answer.status).toBe(502);
    expect(await answer.text()).toBe('Bad Gateway');
  });

  it('and says something rather than nothing on a first visit with no network', async () => {
    const worker = workerOver({}, dead);
    const answer = await worker.navigate('https://log.poker/app/');

    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('Open Log once while online');
  });

  it('does not store an answer that said no', async () => {
    // A cache that took a 502 would serve it back after the incident ended.
    const worker = workerOver({ '/app/index.html': SHELL }, answering(502, 'Bad Gateway'));
    await worker.navigate('https://log.poker/app/');

    expect(await worker.cached()).toEqual(['/app/index.html']);
  });
});
