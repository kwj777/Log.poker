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
 * So the tests below are written against the rule in its strong form: **a
 * record is collectable exactly when neither request path would read anything
 * from it**. The first block proves that equivalence by running the real
 * endpoint against a swept store and a store that never held the record, and
 * asserting they cannot be told apart. The rest are the cases where the
 * arithmetic and the rule come apart, which is where a sweep goes wrong.
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

interface Fake extends CodeStore, SweepStore {
  held: Map<string, unknown>;
  /** Milliseconds each read costs, for the runs that are about the budget. */
  slow: number;
  getThrows: Set<string>;
  deleteThrows: Set<string>;
  listThrows: boolean;
}

const build = () => {
  let at = NOW;
  const clock = { now: () => at, to: (when: number) => (at = when), by: (ms: number) => (at += ms) };

  const store: Fake = {
    held: new Map(),
    slow: 0,
    getThrows: new Set(),
    deleteThrows: new Set(),
    listThrows: false,
    async get(key) {
      at += store.slow;
      if (store.getThrows.has(key)) throw new Error('unreachable');
      return store.held.get(key) ?? null;
    },
    async setJSON(key, value) {
      store.held.set(key, JSON.parse(JSON.stringify(value)));
      return null;
    },
    async delete(key) {
      if (store.deleteThrows.has(key)) throw new Error('unreachable');
      store.held.delete(key);
    },
    async list({ prefix }) {
      if (store.listThrows) throw new Error('unreachable');
      return {
        blobs: [...store.held.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((key) => ({ key })),
      };
    },
  };

  return { store, clock };
};

const sweep = (store: SweepStore | null, now: () => number) =>
  sweepSignIn({ store: () => store, now });

/* ------------------------------------------------------------------ the endpoint */

const endpoint = (store: CodeStore, now: () => number): EndpointSurroundings & { sent: string[] } => {
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

/** The one record in the store, whatever its key turned out to be. */
const only = (store: Fake): Pending => {
  const codes = [...store.held.entries()].filter(([key]) => key.startsWith('code/'));
  expect(codes).toHaveLength(1);
  return codes[0][1] as Pending;
};

const rewrite = (store: Fake, over: Partial<Pending>): void => {
  const [key] = [...store.held.keys()].filter((one) => one.startsWith('code/'));
  store.held.set(key, { ...only(store), ...over });
};

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
  /** Ask for a code, then let both clocks run past everything. */
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
    const { store, clock } = await spent();
    await sweep(store, clock.now);

    const fresh = build();
    fresh.clock.to(clock.now());

    const swept = endpoint(store, clock.now);
    const virgin = endpoint(fresh.store, fresh.clock.now);
    expect((await ask(swept)).status).toBe((await ask(virgin)).status);
    expect(swept.sent).toEqual(virgin.sent);
    expect([...store.held.entries()].sort()).toEqual([...fresh.store.held.entries()].sort());
  });

  it('and an old code is refused the same way on both', async () => {
    const { store, clock } = await spent();
    await sweep(store, clock.now);
    const fresh = build();
    fresh.clock.to(clock.now());
    expect((await trade(endpoint(store, clock.now))).status).toBe(
      (await trade(endpoint(fresh.store, fresh.clock.now))).status,
    );
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
  it('a key under neither prefix, because deleting the unrecognized is the wrong instinct here', async () => {
    const { store, clock } = build();
    store.held.set('something/else', { whatever: true });
    const report = await sweep(store, clock.now);
    expect(report.found).toBe(0);
    expect(store.held.has('something/else')).toBe(true);
  });

  it('and it never writes, because deleting is the only thing it is trusted with', async () => {
    // `SweepStore` has no `setJSON` on it, so this is really the type's claim
    // rather than the test's. What the run adds is that a record it decided to
    // keep comes out of the pass byte for byte as it went in: a sweep that
    // rewrote what it kept would be a second author of the mail budget.
    const { store, clock } = build();
    await ask(endpoint(store, clock.now));
    const before = JSON.stringify([...store.held.entries()].sort());
    expect((await sweep(store, clock.now)).collected).toBe(0);
    expect(JSON.stringify([...store.held.entries()].sort())).toBe(before);
  });

  it('and it collects a value it cannot read, because the endpoint ignores that too', async () => {
    // `isPending` is the same predicate on both sides. A value it says no to
    // is one `askFor` overwrites and `redeem` refuses, so there is nothing
    // left to protect.
    const { store, clock } = build();
    store.held.set('code/deadbeef', { nonsense: true });
    store.held.set('caller/deadbeef', 'not an object');
    expect((await sweep(store, clock.now)).collected).toBe(2);
    expect(store.held.size).toBe(0);
  });
});

/* ================================================================== the budget */

describe('when there is more store than time', () => {
  const fill = (store: Fake, count: number) => {
    for (let i = 0; i < count; i += 1) {
      store.held.set(`code/${String(i).padStart(4, '0')}`, {
        hash: 'x',
        issuedAt: 0,
        expiresAt: 1,
        attempts: 0,
        sent: 1,
        windowStartedAt: 0,
      } satisfies Pending);
    }
  };

  it('stops on the budget rather than being cut off by the platform', async () => {
    const { store, clock } = build();
    fill(store, SWEEP_BATCH * 4);
    // Each read costs a twentieth of the budget, so one batch spends all of it.
    store.slow = SWEEP_BUDGET_MS / SWEEP_BATCH;

    const report = await sweep(store, clock.now);
    expect(report.found).toBe(SWEEP_BATCH * 4);
    expect(report.examined).toBe(SWEEP_BATCH);
    expect(report.finished).toBe(false);
  });

  it('and says how much it did not get to, rather than looking finished', async () => {
    // A sweep that stopped halfway and a sweep with nothing left to do produce
    // the same store. The log is the only thing that tells them apart.
    const { store, clock } = build();
    fill(store, SWEEP_BATCH * 4);
    store.slow = SWEEP_BUDGET_MS / SWEEP_BATCH;
    await sweep(store, clock.now);
    expect(said.join('\n')).toMatch(/out of time with 60 records unexamined/);
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
    for (const key of ['code/a', 'code/b']) store.held.set(key, { nonsense: true });
    store.getThrows.add('code/a');

    const report = await sweep(store, clock.now);
    expect(report).toMatchObject({ examined: 2, collected: 1, failed: 1, finished: true });
    expect(store.held.has('code/a')).toBe(true);
  });

  it('and a delete that fails leaves the record for tomorrow rather than losing count', async () => {
    const { store, clock } = build();
    store.held.set('code/a', { nonsense: true });
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

  it('and stays thin, because a rule in a .mts file is a rule with no test', () => {
    expect(code.split('\n')).toHaveLength(9);
    expect(code).toContain('sweepSignIn({');
    for (const rule of ['windowRolled', 'expiresAt', 'resetAt', 'DAY_MS']) {
      expect(code).not.toContain(rule);
    }
  });
});
