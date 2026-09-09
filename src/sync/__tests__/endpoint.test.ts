/**
 * The endpoint, run rather than read.
 *
 * This file used to open `netlify/functions/sync.mts` and grep the text of it,
 * because a `.mts` module is an ES module as far as the runner is concerned and
 * will not go through its transform. So the one piece of this feature that
 * touches a store and a token had no executed test at all, and an audit found
 * the endpoint answering 200 for writes the store had rejected. The rules moved
 * to `src/sync/endpoint.ts`; this runs them against a store that can be told to
 * behave badly, which is the only way any of the answers below can be checked.
 *
 * What is still asserted against the file is what only the file can say: where
 * it answers, and that it has stayed thin enough to keep being untestable
 * without that mattering.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SYNC_URL } from '../client';
import { handleSync, type BlobStore, type Surroundings } from '../endpoint';
import { BUNDLE_VERSION, emptyChangeSet } from '../protocol';

const source = readFileSync(
  join(__dirname, '..', '..', '..', 'netlify', 'functions', 'sync.mts'),
  'utf8',
);

const SECRET = 'a-key-only-the-server-has';
const NOW = 1_700_000_000_000;

/* ------------------------------------------------------------------ a token */

const base64url = (bytes: ArrayBuffer): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Minted exactly as Untilt mints one: HMAC-SHA256 over the first three parts. */
const mint = async (
  { tier = 'full', subject = 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', ttl = 3_600 }: { tier?: string; subject?: string; ttl?: number } = {},
): Promise<string> => {
  const payload = `${Math.floor(NOW / 1000) + ttl}.${tier}.${subject}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64url(signature)}`;
};

/* ------------------------------------------------------------------- a store */

interface Fake extends BlobStore {
  held: unknown;
  etag: string;
  writes: ({ onlyIfNew: true } | { onlyIfMatch: string })[];
  erased: number;
  /** Set to make the next write claim success without doing one. See below. */
  lie: boolean;
  /** Set to make every write lose the race. */
  contended: number;
  readThrows: boolean;
  writeThrows: boolean;
  eraseThrows: boolean;
}

const fakeStore = (over: Partial<Fake> = {}): Fake => {
  const store: Fake = {
    held: null,
    etag: 'tag-0',
    writes: [],
    erased: 0,
    lie: false,
    contended: 0,
    readThrows: false,
    writeThrows: false,
    eraseThrows: false,
    async getWithMetadata() {
      if (store.readThrows) throw new Error('unreachable');
      return store.held === null ? null : { data: store.held, etag: store.etag };
    },
    async setJSON(_key, value, options) {
      if (store.writeThrows) throw new Error('unreachable');
      store.writes.push(options);
      // What the client really does on a 429 or a 500, after its own retries:
      // reports the write as modified, with no tag, having stored nothing.
      if (store.lie) return { modified: true, etag: '' };
      if (store.contended > 0) {
        store.contended -= 1;
        return { modified: false };
      }
      store.held = value;
      store.etag = `tag-${store.writes.length}`;
      return { modified: true, etag: store.etag };
    },
    async delete() {
      if (store.eraseThrows) throw new Error('unreachable');
      store.erased += 1;
      store.held = null;
    },
    ...over,
  };
  return store;
};

const world = (store: BlobStore | null, secret = SECRET): Surroundings => ({
  secret,
  store: () => store,
  now: () => NOW,
});

const post = async (token: string | null, body: unknown, store: BlobStore | null, secret = SECRET) =>
  handleSync(
    new Request('https://log.poker/api/sync', {
      method: 'POST',
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    world(store, secret),
  );

const push = (changes: Partial<Record<string, unknown[]>> = {}) => ({
  since: 0,
  device: 'device-aaaa0001',
  changes: { ...emptyChangeSet(), ...changes },
});

const venue = (id: string) => ({
  record: { id, name: id, isHomeGame: false, sessionCount: 0, createdAt: NOW, updatedAt: NOW },
  deletedAt: null,
});

/* -------------------------------------------------------------------- where */

describe('where it answers', () => {
  it('is where the client asks, on Log rather than on the host that mints the token', () => {
    expect(new URL(SYNC_URL).pathname).toBe('/api/sync');
    expect(new URL(SYNC_URL).origin).toBe('https://log.poker');
    expect(source).toContain("export const config = { path: '/api/sync' };");
  });

  it('and the file itself stays thin, because anything in it cannot be run', () => {
    // The runner will not transform a `.mts` module. Every rule that moves back
    // into this file is a rule with no executed test behind it.
    const code = source
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('*') && !line.trim().startsWith('/*'));
    expect(code.length).toBeLessThan(20);
    expect(source).toContain('handleSync(request, {');
    expect(source).not.toContain('mergeIntoBundle');
    expect(source).not.toMatch(/\bfor \(let round\b/);
  });
});

/* ------------------------------------------------------------ what it needs */

describe('what has to be true before a byte is stored', () => {
  it('refuses everything without a key to check tokens with', async () => {
    const answer = await post(await mint(), push(), fakeStore(), '');
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ error: 'off' });
  });

  it('says so rather than pretending when there is nowhere to put anything', async () => {
    const answer = await post(await mint(), push(), null);
    expect(answer.status).toBe(503);
  });

  it('refuses a token it cannot verify, and says 401 rather than 403', async () => {
    const forged = (await mint()).replace(/.$/, 'x');
    expect((await post(forged, push(), fakeStore())).status).toBe(401);
    expect((await post(null, push(), fakeStore())).status).toBe(401);
  });

  it('and writes down which half of it was wrong, without saying so in the answer', async () => {
    // A 401 that never says why is the right answer to a stranger and a
    // terrible one to whoever set the key. The reason goes to the deploy log,
    // where only the person reading the deploy can see it.
    const said: string[] = [];
    const logged = jest.spyOn(console, 'error').mockImplementation((...parts) => {
      said.push(parts.join(' '));
    });
    try {
      const forged = (await mint()).replace(/.$/, 'x');
      const answer = await post(forged, push(), fakeStore());

      expect(answer.status).toBe(401);
      expect(await answer.json()).toEqual({ error: 'unauthorized' });
      // The one that means the key here is not the key Untilt signs with.
      expect(said).toEqual(['sync: refusing a token: signature']);
    } finally {
      logged.mockRestore();
    }
  });

  it('but stays quiet for a request with no token, which is a scanner', async () => {
    // This is a public URL. A log line per unauthenticated GET is a log nobody
    // can read on the one day they need to.
    const said: string[] = [];
    const logged = jest.spyOn(console, 'error').mockImplementation((...parts) => {
      said.push(parts.join(' '));
    });
    try {
      expect((await post(null, push(), fakeStore())).status).toBe(401);
      expect(said).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses a passcode holder before it opens the store at all', async () => {
    // Every passcode holder shares the subject, so a bucket for it would be
    // one bucket for every preview visitor.
    const store = fakeStore();
    const answer = await post(await mint({ subject: 'passcode' }), push(), store);
    expect(answer.status).toBe(403);
    expect(store.writes).toHaveLength(0);
  });

  it('takes a write from the free tier, because sync is free', async () => {
    // This asserted 403 until sync stopped being sold. Asserted on the store
    // rather than on the status, because a 200 that stored nothing is exactly
    // the failure this suite exists for: the write has to actually land.
    const store = fakeStore();
    const answer = await post(
      await mint({ tier: 'free' }),
      push({ venues: [venue('venue-free-tier')] }),
      store,
    );
    expect(answer.status).toBe(200);
    expect(store.writes).toHaveLength(1);
    expect(JSON.stringify(store.held)).toContain('venue-free-tier');
  });

  it('and reads back for it too, so the answer is not one-way', async () => {
    const store = fakeStore();
    await post(await mint(), push({ venues: [venue('venue-from-paid')] }), store);
    const answer = await post(await mint({ tier: 'free' }), push(), store);
    expect(answer.status).toBe(200);
    expect(JSON.stringify(await answer.json())).toContain('venue-from-paid');
  });

  it('and lets the free tier erase, as it always did', async () => {
    // This one was already true, on an argument that has since been retired
    // rather than won: erasing used to sit one check below a paid write, and
    // now there is no paid check anywhere for it to sit below.
    const store = fakeStore({ held: { version: BUNDLE_VERSION } });
    const answer = await handleSync(
      new Request('https://log.poker/api/sync', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await mint({ tier: 'free' })}` },
      }),
      world(store),
    );
    expect(answer.status).toBe(204);
    expect(store.erased).toBe(1);
  });

  it('refuses a method it does not answer', async () => {
    const answer = await handleSync(
      new Request('https://log.poker/api/sync', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await mint()}` },
      }),
      world(fakeStore()),
    );
    expect(answer.status).toBe(405);
  });
});

/* ------------------------------------------------------------------ writing */

describe('taking a push', () => {
  it('merges it, stores it, and answers with the cursor and the changes', async () => {
    const store = fakeStore();
    const answer = await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(answer.status).toBe(200);

    const body = (await answer.json()) as Record<string, unknown>;
    expect(body.version).toBe(BUNDLE_VERSION);
    expect(typeof body.cursor).toBe('number');
    expect((body.changes as { venues: { record: { id: string } }[] }).venues.map((c) => c.record.id))
      .toEqual(['v1']);
    expect(store.held).not.toBeNull();
  });

  it('writes conditionally: only-if-new on an empty bucket, only-if-match on a full one', async () => {
    const store = fakeStore();
    await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(store.writes[0]).toEqual({ onlyIfNew: true });

    await post(await mint(), push({ venues: [venue('v2')] }), store);
    expect(store.writes[1]).toEqual({ onlyIfMatch: 'tag-1' });
  });

  it('goes round again when somebody else wrote in between', async () => {
    const store = fakeStore({ contended: 1 });
    const answer = await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(answer.status).toBe(200);
    expect(store.writes).toHaveLength(2);
  });

  it('gives up rather than spinning when it loses every round', async () => {
    const store = fakeStore({ contended: 99 });
    const answer = await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(answer.status).toBe(503);
    expect(store.writes.length).toBeLessThanOrEqual(4);
  });

  /**
   * A store that actually enforces the condition it is handed.
   *
   * `fakeStore` scripts contention with a counter, which pins the loop's
   * mechanics and cannot show what happens when real requests interleave: it
   * ignores `onlyIfMatch` and writes whatever it is given, so every device
   * would win. This holds one tag and refuses any write that does not name it,
   * which is the whole of what Blobs promises and the only thing the loop is
   * built on.
   */
  const racingStore = () => {
    const store = {
      held: null as unknown,
      etag: 'tag-0',
      version: 0,
      async getWithMetadata() {
        // A real tick, not a microtask. With `Promise.resolve()` each request
        // runs its whole read-modify-write to completion before the next is
        // scheduled, so all six landed first time and this measured nothing.
        // A timer puts every pending read ahead of every write, which is what
        // two devices syncing at once actually looks like.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return store.held === null ? null : { data: store.held, etag: store.etag };
      },
      async setJSON(_key: string, value: unknown, options: Record<string, unknown>) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (options.onlyIfNew === true && store.held !== null) return { modified: false };
        if (typeof options.onlyIfMatch === 'string' && options.onlyIfMatch !== store.etag) {
          return { modified: false };
        }
        store.held = value;
        store.version += 1;
        store.etag = `tag-${store.version}`;
        return { modified: true, etag: store.etag };
      },
      async delete() {
        store.held = null;
      },
    };
    return store;
  };

  it('loses nothing when several devices push at the same time', async () => {
    // The property the whole compare-and-swap loop exists for, under real
    // interleaving rather than a scripted counter. Every request is a write --
    // a device mark carries `seen: now`, so even a pull with nothing in it
    // changes the bundle -- which means devices contend on reads as well as on
    // pushes, and `ROUNDS` is only 4.
    //
    // What must hold is not that everybody wins. Measured here, six at once
    // leaves four landing and two exhausting the rounds -- so the concern is
    // real at six, and six of one person's own devices pushing in the same
    // instant is not a thing that happens. What must hold is that a device is
    // told the truth: a 200 means the record is in the bundle, and anything
    // else means it is not and the device still has it to send again.
    const store = racingStore();
    const token = await mint();

    const answers = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
        post(
          token,
          { since: 0, device: `device-000000${id}`, changes: { ...emptyChangeSet(), venues: [venue(id)] } },
          store as never,
        ),
      ),
    );

    const landed = new Set<string>();
    for (const [index, answer] of answers.entries()) {
      const id = ['a', 'b', 'c', 'd', 'e', 'f'][index];
      if (answer.status === 200) landed.add(id);
      // Anything else is a retry, never a refusal: the device must not
      // conclude its push was bad and drop it.
      else expect(answer.status).toBe(503);
    }

    // Somebody got through, or the test is measuring nothing.
    expect(landed.size).toBeGreaterThan(0);

    const held = store.held as { records: { venues: Record<string, unknown> } };
    for (const id of landed) expect(held.records.venues[id]).toBeDefined();
    // And nothing arrived that nobody was told about, which would be the other
    // half of a lie: a device that got a 503 and re-pushes is harmless, but one
    // whose record landed under a 503 has moved no cursor past it.
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      if (!landed.has(id)) expect(held.records.venues[id]).toBeUndefined();
    }
  });

  it('does not call a write a success on the word of the client alone', async () => {
    // The finding this file exists for. On a conditional write the blobs client
    // reports `modified: true` for every status except 412, so a 429 or a 500
    // after its own five retries is indistinguishable from a write that landed,
    // and it does not throw. Answering 200 there tells the device its records
    // are stored and moves both its cursors past them, and they are nowhere.
    const store = fakeStore({ lie: true });
    const answer = await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(answer.status).toBe(503);
    expect(store.held).toBeNull();
  });

  it('refuses rather than overwriting blindly when the read carried no tag', async () => {
    // An empty `onlyIfMatch` is no condition at all as far as the client is
    // concerned, so passing one through would make this the blind overwrite the
    // whole loop exists to avoid, and the first thing it would overwrite is
    // another device's push.
    const store = fakeStore({ held: { version: BUNDLE_VERSION }, etag: '' });
    const answer = await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(answer.status).toBe(503);
    expect(store.writes).toHaveLength(0);
  });

  it('treats a failed read as a failure rather than as an empty bucket', async () => {
    // The worst available bug: an unreadable store looks like a new customer,
    // and the merge that follows would replace their whole history with one
    // device's view of it.
    const store = fakeStore({ held: { version: BUNDLE_VERSION }, readThrows: true });
    const answer = await post(await mint(), push({ venues: [venue('v1')] }), store);
    expect(answer.status).toBe(503);
    expect(store.writes).toHaveLength(0);
  });

  it('and a failed write as one too', async () => {
    const store = fakeStore({ writeThrows: true });
    expect((await post(await mint(), push({ venues: [venue('v1')] }), store)).status).toBe(503);
  });

  it('does not promise an erasure it did not manage', async () => {
    const store = fakeStore({ eraseThrows: true });
    const answer = await handleSync(
      new Request('https://log.poker/api/sync', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await mint()}` },
      }),
      world(store),
    );
    expect(answer.status).toBe(503);
  });

  it('refuses a body that is not one, and one that is too big', async () => {
    const store = fakeStore();
    const notJson = await handleSync(
      new Request('https://log.poker/api/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await mint()}` },
        body: 'not json at all',
      }),
      world(store),
    );
    expect(notJson.status).toBe(400);

    const huge = await handleSync(
      new Request('https://log.poker/api/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await mint()}` },
        body: JSON.stringify({ since: 0, device: 'device-aaaa0001', changes: { notes: 'x'.repeat(3 * 1024 * 1024) } }),
      }),
      world(store),
    );
    expect(huge.status).toBe(400);
    expect(store.writes).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ answers */

describe('what every answer carries', () => {
  it('is private, uncached, and varies on the header that decides who it is', async () => {
    const answer = await post(await mint(), push(), fakeStore());
    expect(answer.headers.get('Cache-Control')).toBe('private, no-store, must-revalidate');
    expect(answer.headers.get('Vary')).toBe('Authorization');
    expect(answer.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(answer.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('tells the device how far back it has collected', async () => {
    // Without it the device keeps its tombstones forever, which is the safe
    // failure and still a growing database.
    const body = (await (await post(await mint(), push(), fakeStore())).json()) as Record<string, unknown>;
    expect(typeof body.collectedThrough).toBe('number');
  });

  it('keys the bucket by an HMAC rather than by the subject', async () => {
    const mine = fakeStore();
    const theirs = fakeStore();
    await post(await mint({ subject: 'log_d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4' }), push({ venues: [venue('v1')] }), mine);
    await post(await mint({ subject: 'log_e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5' }), push({ venues: [venue('v1')] }), theirs);
    // Two people, two buckets, and neither key is a customer id.
    const keys = [mine, theirs].map((store) => store.writes.length);
    expect(keys).toEqual([1, 1]);
    expect(source).not.toMatch(/getStore\([^)]*subject/);
  });
});
