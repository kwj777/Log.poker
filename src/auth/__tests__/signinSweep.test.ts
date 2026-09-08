/**
 * The sweep, and the one thing it must not collect.
 *
 * Most of this suite is about a single hazard. The records under `code/` carry
 * `sent` and `windowStartedAt`, which are the whole of what holds one address
 * to five mails a day, so **a record collected too early hands that budget
 * back**: somebody pointing the free door at a stranger would only have to
 * wait for the nightly run to send five more. Nothing about that failure shows
 * up at the time. The endpoint keeps answering 202, the mail keeps arriving,
 * and the bound the header of `signinEndpoint.ts` promises has quietly stopped
 * existing.
 *
 * So the tests are written against the rule in its strong form: **a record is
 * collectable exactly when neither request path would read anything from it**,
 * and against the thing the first version of this suite did not test at all,
 * which is whether the sweep is looking at the record it deletes.
 *
 * ## What the first version of this file got wrong
 *
 * An audit mutated the sweep a line at a time and ran this suite against each
 * mutation. Four of them went green, which is the failure `SYNC.md` records of
 * the tombstone work: *the test that was supposed to prove it worked was
 * passing for another reason.*
 *
 *   Collect nothing at all.       The two "equivalence" tests, the ones the
 *                                 header called the proof of the whole rule,
 *                                 passed. They compare a swept store against a
 *                                 virgin one and never checked that the sweep
 *                                 had done anything, so they held in both
 *                                 directions and constrained neither.
 *   Collect twelve minutes into   Passed. Only the roll boundary was pinned to
 *   a code's fifteen-minute life. the millisecond; the expiry side was pinned
 *                                 to within a quarter of an hour.
 *   Collect unknown prefixes.     Passed, because the fake store's `list`
 *                                 filtered the key out before the guard could
 *                                 be asked about it. The test was named for a
 *                                 branch it never reached.
 *   Count a vanished record as    Passed. Nothing looked at that branch, so
 *   collected.                    the daily log could overstate what it did.
 *
 * Each of those has a test below written to fail on that exact mutation, and
 * the mutations were re-run against them.
 */

import {
  CALLER_WINDOW_MS,
  CODE_TTL_MS,
  DAILY_LIMIT,
  DAY_MS,
  MAX_ATTEMPTS,
  handleSignIn,
  type CodeStore,
  type Pending,
  type Surroundings as EndpointSurroundings,
} from '../signinEndpoint';
import { SWEEP_BATCH, SWEEP_BUDGET_MS, sweepSignIn, type SweepStore } from '../signinSweep';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '..', '..', '..', 'netlify', 'functions', 'signin-sweep.mts'),
  'utf8',
);

const SECRET = 'a-key-only-the-server-has';
const NOW = 1_700_000_000_000;
const EMAIL = 'player@example.com';
const CODE = '424242';

/* --------------------------------------------------------- a store and a clock */

/** What the fake keeps, which is a value and the tag that says which value. */
interface Held {
  value: unknown;
  etag: string;
}

interface Fake extends CodeStore, SweepStore {
  held: Map<string, Held>;
  /** Milliseconds each read costs, for the runs that are about the budget. */
  slow: number;
  /** Keys whose read never answers, for the runs that are about one bad key. */
  hangs: Set<string>;
  /** Keys the read makes vanish, as a redemption between listing and read does. */
  vanishes: Set<string>;
  /** Keys the read rewrites underneath itself, which is the race the etag is for. */
  rewrites: Set<string>;
  /** Keys whose read answers with no etag at all. */
  tagless: Set<string>;
  /** Extra rows the listing invents, for guards the prefix filter hides. */
  invents: { key: string; etag: string }[];
  getThrows: Set<string>;
  deleteThrows: Set<string>;
  listThrows: boolean;
  /** Every options object the sweep read with, so the consistency can be checked. */
  reads: { key: string; options: unknown }[];
}

const build = () => {
  let at = NOW;
  const clock = { now: () => at, to: (when: number) => (at = when), by: (ms: number) => (at += ms) };
  let written = 0;

  const put = (key: string, value: unknown) => {
    written += 1;
    store.held.set(key, { value: JSON.parse(JSON.stringify(value)), etag: `v${written}` });
  };

  const store: Fake = {
    held: new Map(),
    slow: 0,
    hangs: new Set(),
    vanishes: new Set(),
    rewrites: new Set(),
    tagless: new Set(),
    invents: [],
    getThrows: new Set(),
    deleteThrows: new Set(),
    listThrows: false,
    reads: [],

    // The endpoint's half of the interface.
    async get(key) {
      if (store.getThrows.has(key)) throw new Error('unreachable');
      return store.held.get(key)?.value ?? null;
    },
    async setJSON(key, value) {
      put(key, value);
      return null;
    },
    async delete(key) {
      if (store.deleteThrows.has(key)) throw new Error('unreachable');
      store.held.delete(key);
    },

    // The sweep's half.
    async getWithMetadata(key, options) {
      at += store.slow;
      store.reads.push({ key, options });
      if (store.hangs.has(key)) return new Promise(() => {});
      if (store.getThrows.has(key)) throw new Error('unreachable');
      if (store.vanishes.has(key)) {
        store.held.delete(key);
        return null;
      }
      const found = store.held.get(key);
      if (found === undefined) return null;
      // A write landing between the listing and this read. The record handed
      // back is the new one, and its tag is what gives that away.
      if (store.rewrites.has(key)) put(key, found.value);
      const now = store.held.get(key) as Held;
      return { data: now.value, etag: store.tagless.has(key) ? undefined : now.etag };
    },
    async list({ prefix }) {
      if (store.listThrows) throw new Error('unreachable');
      return {
        blobs: [
          ...[...store.held.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, one]) => ({ key, etag: one.etag })),
          ...store.invents,
        ],
      };
    },
  };

  return { store, clock, put };
};

const sweep = (store: SweepStore | null, now: () => number) =>
  sweepSignIn({ store: () => store, now });

/* ------------------------------------------------------------------ the endpoint */

const endpoint = (
  store: CodeStore,
  now: () => number,
): EndpointSurroundings & { sent: string[] } => {
  const sent: string[] = [];
  return {
    secret: SECRET,
    store: () => store,
    mail: async (to) => {
      sent.push(to);
      return true;
    },
    now,
    code: () => CODE,
    sent,
  };
};

const ask = (surroundings: EndpointSurroundings, email = EMAIL) =>
  handleSignIn(
    new Request('https://log.poker/api/signin', { method: 'POST', body: JSON.stringify({ email }) }),
    surroundings,
  );

const trade = (surroundings: EndpointSurroundings, code = CODE, email = EMAIL) =>
  handleSignIn(
    new Request('https://log.poker/api/signin/code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
    surroundings,
  );

/** The one code record in the store, whatever its key turned out to be. */
const codeKeys = (store: Fake): string[] =>
  [...store.held.keys()].filter((key) => key.startsWith('code/'));

const only = (store: Fake): Pending => {
  const keys = codeKeys(store);
  expect(keys).toHaveLength(1);
  return (store.held.get(keys[0]) as Held).value as Pending;
};

const rewrite = (store: Fake, over: Partial<Pending>): void => {
  const held = { ...only(store), ...over };
  void store.setJSON(codeKeys(store)[0], held);
};

/** The store as two comparable snapshots: what is under each key, tags aside. */
const snapshot = (store: Fake) =>
  [...store.held.entries()].map(([key, one]) => [key, one.value] as const).sort();

/* ------------------------------------------------------------------ quiet logs */

let said: string[] = [];

beforeEach(() => {
  said = [];
  jest.spyOn(console, 'log').mockImplementation((...args) => said.push(args.join(' ')));
  jest.spyOn(console, 'error').mockImplementation((...args) => said.push(args.join(' ')));
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ============================================================== the equivalence */

describe('a record it collects is a record nothing was reading', () => {
  /** Ask for a code, then let the clock run past everything. */
  const spent = async () => {
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    clock.to(NOW + DAY_MS + CODE_TTL_MS + 1);
    return { store, clock };
  };

  it('collects it once the window has rolled and the code has expired', async () => {
    const { store, clock } = await spent();
    const report = await sweep(store, clock.now);
    expect(report.collected).toBe(1);
    expect(store.held.size).toBe(0);
  });

  it('and the endpoint cannot tell the swept store from one that never held it', async () => {
    // The rule in its strong form. Anything the sweep takes has to be
    // something both paths already treat as absent, and the way to know that
    // is to run them rather than to reason about it.
    //
    // The assertion that the store is empty is not decoration: without it this
    // test passes on a sweep that collects nothing, which is what it did.
    const { store, clock } = await spent();
    await sweep(store, clock.now);
    expect(store.held.size).toBe(0);

    const fresh = build();
    fresh.clock.to(clock.now());

    const swept = endpoint(store, clock.now);
    const virgin = endpoint(fresh.store, fresh.clock.now);
    expect((await ask(swept)).status).toBe((await ask(virgin)).status);
    expect(swept.sent).toEqual(virgin.sent);
    expect(snapshot(store)).toEqual(snapshot(fresh.store));
  });

  it('and an old code is refused the same way on both', async () => {
    const { store, clock } = await spent();
    await sweep(store, clock.now);
    expect(store.held.size).toBe(0);
    const fresh = build();
    fresh.clock.to(clock.now());
    expect((await trade(endpoint(store, clock.now))).status).toBe(
      (await trade(endpoint(fresh.store, fresh.clock.now))).status,
    );
  });

  it('and where a record IS still being read, the two stores differ, which is the direction that constrains it', async () => {
    // The other half of an equivalence, and the half the first version left
    // out. Swept-equals-virgin holds trivially for a sweep that collects
    // everything; what pins the rule is that a live record survives and the
    // two stores are then NOT the same.
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    clock.by(CODE_TTL_MS + 1); // code dead, window very much alive

    expect((await sweep(store, clock.now)).collected).toBe(0);

    const fresh = build();
    fresh.clock.to(clock.now());
    expect(snapshot(store)).not.toEqual(snapshot(fresh.store));

    // And the difference is one the endpoint can feel: the surviving record is
    // still counting this address's mail.
    const swept = endpoint(store, clock.now);
    const virgin = endpoint(fresh.store, fresh.clock.now);
    await ask(swept);
    await ask(virgin);
    expect(only(store).sent).toBe(2);
    expect(only(fresh.store).sent).toBe(1);
  });
});

/* ================================================================= the hazard */

describe('what it must not collect, because the mail budget lives there', () => {
  it('leaves an address that has spent its five, inside the day', async () => {
    // The failure this suite exists for. Collect this and the next request
    // starts a fresh count, so five mails a day becomes five mails a day plus
    // five more whenever the sweep happens to run.
    const { store, clock } = build();
    const surroundings = endpoint(store, clock.now);
    for (let i = 0; i < DAILY_LIMIT; i += 1) {
      await ask(surroundings);
      clock.by(60 * 1000);
    }
    expect(surroundings.sent).toHaveLength(DAILY_LIMIT);
    expect(only(store).sent).toBe(DAILY_LIMIT);

    // Well past the code's fifteen minutes, and well inside the day.
    clock.by(CODE_TTL_MS + 1);
    expect((await sweep(store, clock.now)).collected).toBe(0);

    await ask(surroundings);
    expect(surroundings.sent).toHaveLength(DAILY_LIMIT);
  });

  it('and does not free the budget a moment before the window is up', async () => {
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    rewrite(store, { sent: DAILY_LIMIT, expiresAt: NOW });

    clock.to(NOW + DAY_MS);
    expect((await sweep(store, clock.now)).collected).toBe(0);
    clock.by(1);
    expect((await sweep(store, clock.now)).collected).toBe(1);
  });

  it('and does not collect a code a millisecond before it expires', async () => {
    // The expiry horizon to the millisecond, matching `redeem`'s own
    // `expiresAt <= now`. Without this the suite tolerated collecting a code
    // twelve minutes into its fifteen-minute life: long enough to delete one
    // out from under somebody reading it, and green.
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    const dies = NOW + CODE_TTL_MS;
    rewrite(store, { windowStartedAt: NOW - DAY_MS - 1, expiresAt: dies });

    clock.to(dies - 1);
    expect((await sweep(store, clock.now)).collected).toBe(0);
    clock.by(1);
    expect((await sweep(store, clock.now)).collected).toBe(1);
  });

  it('and leaves a code that is still live past the roll, which is the case a window alone gets wrong', async () => {
    // A code asked for at the very end of a window outlives the window by up
    // to fifteen minutes. Collecting on `windowRolled` alone would kill it
    // while somebody was reading it off their phone: rare, silent, and a
    // sign-in that simply says the code is wrong.
    const { store, clock } = build();
    const surroundings = endpoint(store, clock.now);
    await ask(surroundings);
    rewrite(store, { windowStartedAt: NOW - DAY_MS + 60 * 1000 });

    clock.by(2 * 60 * 1000);
    expect((await sweep(store, clock.now)).collected).toBe(0);
    expect((await trade(endpoint(store, clock.now))).status).toBe(200);
  });

  it('and leaves a dead code that is still answering 429, rather than turning it into a 400', async () => {
    // Five wrong guesses arms a refusal that lasts the rest of the code's
    // life. Collecting it would answer 400 instead, which is a quieter answer
    // to somebody who is guessing.
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    rewrite(store, { windowStartedAt: NOW - DAY_MS - 1, attempts: MAX_ATTEMPTS });

    expect((await sweep(store, clock.now)).collected).toBe(0);
    expect((await trade(endpoint(store, clock.now), '000000')).status).toBe(429);
  });
});

/* ====================================================== looking at what it deletes */

describe('whether it is looking at the record it deletes', () => {
  const stale = async () => {
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    rewrite(store, { windowStartedAt: NOW - DAY_MS - 1, expiresAt: NOW - 1 });
    return { store, clock };
  };

  it('reads strongly, because the default read can be a minute out of date', async () => {
    // The whole of the practical exposure. An eventual read is served from a
    // cache that can lag by up to a minute, so a sweep at midnight can be
    // handed the record as it was at 23:59, judge that collectable, and delete
    // what replaced it: a live code, and a mail budget back to zero.
    // `src/sync/endpoint.ts` learned this first and says so in its header.
    const { store, clock } = await stale();
    await sweep(store, clock.now);
    expect(store.reads).not.toHaveLength(0);
    for (const read of store.reads) {
      expect(read.options).toEqual({ type: 'json', consistency: 'strong' });
    }
  });

  it('and refuses a record that was rewritten between the listing and the read', async () => {
    // The residual race, closed as far as the platform allows. `Store.delete`
    // takes no precondition, so the only guard available is to check that the
    // record still carries the tag the listing gave, and to leave anything
    // else for tomorrow.
    const { store, clock } = await stale();
    store.rewrites.add(codeKeys(store)[0]);
    const report = await sweep(store, clock.now);
    expect(report.collected).toBe(0);
    expect(report.examined).toBe(1);
    expect(codeKeys(store)).toHaveLength(1);
  });

  it('and refuses one it cannot get a tag for at all', async () => {
    // Same instinct as `guardFor` in the sync endpoint refusing a tagless
    // read: an unverifiable delete is the unguarded delete this check exists
    // to avoid, wearing a check's clothes.
    const { store, clock } = await stale();
    store.tagless.add(codeKeys(store)[0]);
    expect((await sweep(store, clock.now)).collected).toBe(0);
  });

  it('and treats one that vanished between the listing and the read as nothing to do', async () => {
    // A redemption is the other way a record leaves. Counting this as
    // collected would make the daily log overstate the sweep: a run that
    // emptied nothing could print the same numbers as one that emptied the
    // head of the store.
    const { store, clock } = await stale();
    store.vanishes.add(codeKeys(store)[0]);
    const report = await sweep(store, clock.now);
    expect(report).toMatchObject({ found: 1, examined: 1, collected: 0, failed: 0, finished: true });
  });
});

/* ================================================================== the callers */

describe('the caller records', () => {
  const from = { 'x-nf-client-connection-ip': '203.0.113.7' };

  const counted = async () => {
    const { store, clock } = build();
    await handleSignIn(
      new Request('https://log.poker/api/signin', {
        method: 'POST',
        headers: from,
        body: JSON.stringify({ email: EMAIL }),
      }),
      endpoint(store, clock.now),
    );
    return { store, clock };
  };

  it('are kept while the hour is still running', async () => {
    const { store, clock } = await counted();
    clock.by(CALLER_WINDOW_MS - 1);
    const report = await sweep(store, clock.now);
    expect([...store.held.keys()].some((key) => key.startsWith('caller/'))).toBe(true);
    expect(report.collected).toBe(0);
  });

  it('and collected once it is not', async () => {
    const { store, clock } = await counted();
    clock.by(CALLER_WINDOW_MS);
    await sweep(store, clock.now);
    expect([...store.held.keys()].some((key) => key.startsWith('caller/'))).toBe(false);
  });
});

/* ================================================================ what it skips */

describe('what it will not touch', () => {
  it('a key under neither prefix, even when the listing hands it one anyway', async () => {
    // Named for the guard at the bottom of `collectable`, and now actually
    // reaching it. The first version of this test put the key in the store,
    // where the fake's own prefix filter removed it before the sweep saw it:
    // inverting the guard left the suite green. The listing invents the row
    // instead, which is the shape a cursor-based rewrite would produce.
    const { store, clock } = build();
    store.invents.push({ key: 'something/else', etag: 'v1' });
    void store.setJSON('something/else', { whatever: true });

    const report = await sweep(store, clock.now);
    expect(report.found).toBeGreaterThan(0);
    expect(report.collected).toBe(0);
    expect(store.held.has('something/else')).toBe(true);
  });

  it('and it never writes, because deleting is the only thing it is trusted with', async () => {
    // `SweepStore` has no `setJSON` on it, so this is really the type's claim
    // rather than the test's. What the run adds is that a record it decided to
    // keep comes out of the pass byte for byte as it went in: a sweep that
    // rewrote what it kept would be a second author of the mail budget.
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    const before = JSON.stringify(snapshot(store));
    expect((await sweep(store, clock.now)).collected).toBe(0);
    expect(JSON.stringify(snapshot(store))).toBe(before);
  });

  it('and it collects a value it cannot read, because the endpoint ignores that too', async () => {
    // `isPending` is the same predicate on both sides. A value it says no to
    // is one `askFor` overwrites and `redeem` refuses, so there is nothing
    // left to protect.
    const { store, clock } = build();
    void store.setJSON('code/deadbeef', { nonsense: true });
    void store.setJSON('caller/deadbeef', 'not an object');
    expect((await sweep(store, clock.now)).collected).toBe(2);
    expect(store.held.size).toBe(0);
  });
});

/* ================================================================== the budget */

describe('when there is more store than time', () => {
  const fill = (store: Fake, count: number, prefix = 'code/') => {
    for (let i = 0; i < count; i += 1) {
      void store.setJSON(
        `${prefix}${String(i).padStart(4, '0')}`,
        prefix === 'code/'
          ? ({
              hash: 'x',
              issuedAt: 0,
              expiresAt: 1,
              attempts: 0,
              sent: 1,
              windowStartedAt: 0,
            } satisfies Pending)
          : { count: 1, resetAt: 1 },
      );
    }
  };

  it('stops on the budget rather than being cut off by the platform', async () => {
    const { store, clock } = build();
    fill(store, SWEEP_BATCH * 4);
    // Each read costs a twentieth of the budget, so one batch spends all of it.
    store.slow = SWEEP_BUDGET_MS / SWEEP_BATCH;

    // One short of the batch: the twentieth read is the one that spends the
    // last of the budget, so by the time it is raced there is nothing left to
    // race it against and its verdict is dropped. Discarding a decision the
    // run no longer has time to stand behind is the conservative direction.
    const report = await sweep(store, clock.now);
    expect(report.found).toBe(SWEEP_BATCH * 4);
    expect(report.examined).toBe(SWEEP_BATCH - 1);
    expect(report.finished).toBe(false);
  });

  it('and says how much it did not get to, rather than looking finished', async () => {
    // A sweep that stopped halfway and a sweep with nothing left to do produce
    // the same store. The log is the only thing that tells them apart.
    const { store, clock } = build();
    fill(store, SWEEP_BATCH * 4);
    store.slow = SWEEP_BUDGET_MS / SWEEP_BATCH;
    await sweep(store, clock.now);
    const left = SWEEP_BATCH * 4 - (SWEEP_BATCH - 1);
    expect(said.join('\n')).toMatch(new RegExp(`out of time with ${left} records unexamined`));
  });

  it('and gives up on one key that will not answer, rather than letting it eat the run', async () => {
    // The blobs client retries a 429 or a 5xx five times with five seconds
    // between attempts, so a single unlucky key can sleep for twenty-five
    // seconds. Checking the clock only between batches let that overrun the
    // platform's thirty and the run was killed with nothing logged, which is
    // the exact outcome the budget exists to prevent. Every operation is now
    // raced against the time left.
    const { store, clock } = build();
    fill(store, 1);
    store.hangs.add(codeKeys(store)[0]);
    store.slow = SWEEP_BUDGET_MS - 5;

    const report = await sweep(store, clock.now);
    expect(report.finished).toBe(false);
    expect(report.examined).toBe(0);
    expect(said.join('\n')).toMatch(/out of time with 1 records unexamined/);
  });

  it('and truncating costs both kinds of record alike, rather than every caller record', async () => {
    // Listing the addresses and then the callers put every caller record
    // behind every address record, so the first store big enough to truncate
    // would have stopped collecting caller records altogether. Round-robin
    // costs nothing and makes a short run bite proportionally.
    const { store, clock } = build();
    fill(store, SWEEP_BATCH * 4, 'code/');
    fill(store, SWEEP_BATCH * 4, 'caller/');
    store.slow = SWEEP_BUDGET_MS / SWEEP_BATCH;

    const report = await sweep(store, clock.now);
    expect(report.finished).toBe(false);
    expect(codeKeys(store).length).toBeLessThan(SWEEP_BATCH * 4);
    expect([...store.held.keys()].filter((k) => k.startsWith('caller/')).length).toBeLessThan(
      SWEEP_BATCH * 4,
    );
  });

  it('and finishes, saying so, when there is time', async () => {
    const { store, clock } = build();
    fill(store, SWEEP_BATCH * 4);
    const report = await sweep(store, clock.now);
    expect(report).toEqual({
      found: SWEEP_BATCH * 4,
      examined: SWEEP_BATCH * 4,
      collected: SWEEP_BATCH * 4,
      failed: 0,
      finished: true,
    });
  });
});

/* ================================================================= what fails */

describe('when the store will not answer', () => {
  it('reports nowhere to sweep rather than throwing into a scheduler', async () => {
    const report = await sweep(null, () => NOW);
    expect(report.found).toBe(0);
    expect(said.join('\n')).toContain('no blob store configured');
  });

  it('gives up on a listing it cannot read, and does not claim to have finished', async () => {
    const { store, clock } = build();
    store.listThrows = true;
    const report = await sweep(store, clock.now);
    expect(report.finished).toBe(false);
    expect(report.examined).toBe(0);
  });

  it('counts a record it could not read and carries on with the rest', async () => {
    const { store, clock } = build();
    for (const key of ['code/a', 'code/b']) void store.setJSON(key, { nonsense: true });
    store.getThrows.add('code/a');

    const report = await sweep(store, clock.now);
    expect(report).toMatchObject({ examined: 2, collected: 1, failed: 1, finished: true });
    expect(store.held.has('code/a')).toBe(true);
  });

  it('and a delete that fails leaves the record for tomorrow rather than losing count', async () => {
    const { store, clock } = build();
    void store.setJSON('code/a', { nonsense: true });
    store.deleteThrows.add('code/a');
    expect(await sweep(store, clock.now)).toMatchObject({ collected: 0, failed: 1 });
    expect(store.held.has('code/a')).toBe(true);
  });
});

/* =================================================================== the wiring */

describe('the scheduled function around it', () => {
  // The file with its explanation taken off. Asserted against rather than the
  // whole text, because the header's job is to name the things that are
  // deliberately not in the code, and a test reading both cannot tell a
  // sentence about `GATE_SECRET` from a line that reads it.
  const code = source
    .split('\n')
    .filter(
      (line) =>
        line.trim() !== '' &&
        !line.trim().startsWith('*') &&
        !line.trim().startsWith('/*') &&
        !line.trim().startsWith('//'),
    )
    .join('\n');

  it('runs daily, which is the cadence the collection window implies', () => {
    // Nothing becomes collectable sooner than a day and a quarter of an hour
    // after it was written, so anything more often is work for nothing.
    expect(code).toContain("export const config = { schedule: '@daily' };");
  });

  it('holds no key, because it has nothing to sign or verify', () => {
    // The records are already keyed by an HMAC and this only asks whether one
    // is spent. A sweep that could mint would be a second place to get that
    // wrong for no gain at all, and the header says so; this is the half of
    // that claim a test can hold.
    expect(code).not.toContain('GATE_SECRET');
    expect(code).not.toContain('process.env');
  });

  it('and catches the store, because getStore throws where the sweep expects a null', () => {
    // Without this the "no blob store configured" line and the empty report
    // beside it are unreachable, and a site with no Blobs context fails the
    // scheduled run with a stack trace instead.
    expect(code).toMatch(/try \{[\s\S]*getStore\('log-signin'\)[\s\S]*catch[\s\S]*return null/);
  });

  it('and stays thin, because a rule in a .mts file is a rule with no test', () => {
    expect(code.split('\n').length).toBeLessThan(20);
    expect(code).toContain('sweepSignIn({');
    for (const rule of ['windowRolled', 'expiresAt', 'resetAt', 'DAY_MS', 'consistency']) {
      expect(code).not.toContain(rule);
    }
  });
});
