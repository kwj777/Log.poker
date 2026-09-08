/**
 * The free door, run rather than read.
 *
 * This endpoint mails codes to anybody who asks, which is the whole point of
 * it and also the whole risk in it. Everything worth asserting is a bound: how
 * much mail one address can be sent, how many guesses a code survives, whether
 * a spent code is really spent, and what the store would say if it leaked. All
 * of those fail silently in production, so they are checked against a store
 * that records everything and a mailer that can be told to fail.
 *
 * The token it mints is checked with `verifyToken` rather than by reading the
 * string, because minting and checking are two halves of one format and a test
 * that types the expected output out by hand only proves the author and the
 * implementation agree.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readClaim, SUBJECT_PASSCODE } from '../token';
import { SUBJECT_PREFIX, mintToken, subjectForEmail, verifyToken } from '../../sync/verify';
import { fakeStore as blobStore, snapshot, type Fake } from './fakeStore';
import {
  CALLER_LIMIT,
  CODE_TTL_MS,
  COOLDOWN_MS,
  DAILY_LIMIT,
  DAY_MS,
  MAX_ATTEMPTS,
  handleSignIn,
  type CodeStore,
  type Surroundings,
} from '../signinEndpoint';

const source = readFileSync(
  join(__dirname, '..', '..', '..', 'netlify', 'functions', 'signin.mts'),
  'utf8',
);

const SECRET = 'a-key-only-the-server-has';
const NOW = 1_700_000_000_000;
const EMAIL = 'player@example.com';
const CODE = '424242';

/* ------------------------------------------------------------------- a store */

// Shared with `signinSweep.test.ts`. The fake this file used to carry was a
// plain `Map`: linearizable, always answering with the latest value, and with
// no notion of a conditional write. Every race below was invisible under it,
// which is how three of them shipped. See the header of `fakeStore.ts`.
const fakeStore = (over: Partial<Fake> = {}): Fake => Object.assign(blobStore(NOW).store, over);

/* ------------------------------------------------------------------- a world */

interface Sent {
  to: string;
  code: string;
}

const world = (
  store: CodeStore | null,
  over: Partial<Surroundings> & { sent?: Sent[]; failMail?: boolean } = {},
): Surroundings & { sent: Sent[] } => {
  const sent: Sent[] = over.sent ?? [];
  return {
    secret: SECRET,
    store: () => store,
    mail: async (to, code) => {
      if (over.failMail) return false;
      sent.push({ to, code });
      return true;
    },
    now: () => NOW,
    code: () => CODE,
    ...over,
    sent,
  };
};

const ask = (body: unknown, surroundings: Surroundings, headers: Record<string, string> = {}) =>
  handleSignIn(
    new Request('https://log.poker/api/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    surroundings,
  );

const trade = (body: unknown, surroundings: Surroundings, headers: Record<string, string> = {}) =>
  handleSignIn(
    new Request('https://log.poker/api/signin/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    surroundings,
  );

/** A world whose clock can be moved, for the caps that are about time. */
const clocked = (store: CodeStore, start = NOW) => {
  let at = start;
  const surroundings = world(store, { now: () => at });
  return { surroundings, tick: (by: number) => (at += by), get sent() { return surroundings.sent; } };
};

/* --------------------------------------------------------------------- shape */

describe('what it answers at all', () => {
  it('refuses every request with no key, and says which one in the log only', async () => {
    const said: unknown[] = [];
    const logged = jest.spyOn(console, 'error').mockImplementation((...args) => said.push(args));
    try {
      const answer = await ask({ email: EMAIL }, world(fakeStore(), { secret: '' }));
      expect(answer.status).toBe(503);
      expect(JSON.stringify(said)).toContain('GATE_SECRET');
      // The name of the variable, never a value, and never in the body.
      expect(await answer.text()).not.toContain('GATE_SECRET');
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses a method it does not answer', async () => {
    const answer = await handleSignIn(
      new Request('https://log.poker/api/signin', { method: 'GET' }),
      world(fakeStore()),
    );
    expect(answer.status).toBe(405);
  });

  it('refuses a path it does not answer', async () => {
    const answer = await handleSignIn(
      new Request('https://log.poker/api/signin/anything', { method: 'POST', body: '{}' }),
      world(fakeStore()),
    );
    expect(answer.status).toBe(404);
  });

  it('says so rather than pretending when there is nowhere to write', async () => {
    const answer = await ask({ email: EMAIL }, world(null));
    expect(answer.status).toBe(503);
  });

  it('and the file itself stays thin, because anything in it cannot be run', () => {
    // The runner will not transform a `.mts` module. Every rule that moves back
    // into it is a rule with no executed test, which is how the sync endpoint
    // came to be answering 200 for writes its store had rejected.
    const code = source
      .split('\n')
      .filter(
        (line) =>
          line.trim() !== '' &&
          !line.trim().startsWith('*') &&
          !line.trim().startsWith('/*') &&
          !line.trim().startsWith('//'),
      );
    // Larger than `sync.mts`, because a mailer lives here and cannot live
    // anywhere a test can reach it. Still small enough that a rule arriving
    // would show.
    expect(code.length).toBeLessThan(50);
    expect(source).toContain(
      "export const config = { path: ['/api/signin', '/api/signin/code', '/api/signin/renew'] };",
    );
    expect(source).toContain('handleSignIn(request, {');
    // Named individually rather than by counting braces: these are the things
    // that would be untested if they moved, and the list is the point.
    for (const rule of ['mintToken', 'subjectForEmail', 'safeEqual', 'MAX_ATTEMPTS', 'attempts']) {
      expect(source).not.toContain(rule);
    }
  });
});

/* ----------------------------------------------------------------- asking */

describe('asking for a code', () => {
  it('mails one and answers 202', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    const answer = await ask({ email: EMAIL }, surroundings);
    expect(answer.status).toBe(202);
    expect(surroundings.sent).toEqual([{ to: EMAIL, code: CODE }]);
  });

  it('refuses a string that is not an address, and mails nothing', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    for (const email of ['', 'player', 'player@', '@example.com', 'a b@example.com', 'a@b']) {
      expect((await ask({ email }, surroundings)).status).toBe(400);
    }
    expect(surroundings.sent).toEqual([]);
    expect(store.held.size).toBe(0);
  });

  it('refuses a body that is not an object, and one that is too big', async () => {
    const surroundings = world(fakeStore());
    expect((await ask(['player@example.com'], surroundings)).status).toBe(400);
    expect((await ask({ email: 'a'.repeat(300) + '@example.com' }, surroundings)).status).toBe(400);
  });

  it('draws six digits when nothing hands it a code', async () => {
    const surroundings = world(fakeStore(), { code: undefined });
    await ask({ email: EMAIL }, surroundings);
    expect(surroundings.sent[0].code).toMatch(/^\d{6}$/);
  });

  it('writes down neither the address nor the code', async () => {
    // The one property that matters if this store is ever read by somebody who
    // should not have it: it can say how many people have signed in, and
    // nothing whatever about who or how to become them.
    const store = fakeStore();
    await ask({ email: EMAIL }, world(store), { 'x-nf-client-connection-ip': '203.0.113.7' });
    const written = JSON.stringify(snapshot(store));
    // Both records: the address's pending code and the caller's counter.
    expect(store.held.size).toBe(2);
    expect(written).not.toContain(EMAIL);
    expect(written).not.toContain('example.com');
    expect(written).not.toContain('player');
    expect(written).not.toContain(CODE);
    expect(written).not.toContain('203.0.113.7');
  });
});

describe('how much mail one address can be sent', () => {
  it('sends one and then waits out the cooldown', async () => {
    const store = fakeStore();
    const { surroundings, tick, sent } = clocked(store);
    await ask({ email: EMAIL }, surroundings);
    expect(sent).toHaveLength(1);

    // Still 202. Saying "not sent" here would report that this address has
    // been asked for recently, which is the disclosure the whole shape avoids.
    tick(COOLDOWN_MS - 1);
    expect((await ask({ email: EMAIL }, surroundings)).status).toBe(202);
    expect(sent).toHaveLength(1);

    tick(2);
    await ask({ email: EMAIL }, surroundings);
    expect(sent).toHaveLength(2);
  });

  it('stops at the daily cap, still without saying so', async () => {
    const store = fakeStore();
    const { surroundings, tick, sent } = clocked(store);
    for (let i = 0; i < DAILY_LIMIT + 3; i += 1) {
      expect((await ask({ email: EMAIL }, surroundings)).status).toBe(202);
      tick(COOLDOWN_MS + 1);
    }
    expect(sent).toHaveLength(DAILY_LIMIT);
  });

  it('and starts again when the window has rolled', async () => {
    const store = fakeStore();
    const { surroundings, tick, sent } = clocked(store);
    for (let i = 0; i < DAILY_LIMIT + 2; i += 1) {
      await ask({ email: EMAIL }, surroundings);
      tick(COOLDOWN_MS + 1);
    }
    expect(sent).toHaveLength(DAILY_LIMIT);

    tick(DAY_MS + 1);
    await ask({ email: EMAIL }, surroundings);
    expect(sent).toHaveLength(DAILY_LIMIT + 1);
  });

  it('counts one address once however it is spelled', async () => {
    // Otherwise the cap is worth nothing: the same inbox can be mailed five
    // times per capitalization, and there are a lot of capitalizations.
    const store = fakeStore();
    const { surroundings, tick, sent } = clocked(store);
    for (const spelling of ['Player@Example.com', 'PLAYER@EXAMPLE.COM', ' player@example.com ']) {
      await ask({ email: spelling }, surroundings);
      tick(COOLDOWN_MS + 1);
    }
    for (let i = 0; i < DAILY_LIMIT; i += 1) {
      await ask({ email: EMAIL }, surroundings);
      tick(COOLDOWN_MS + 1);
    }
    expect(sent).toHaveLength(DAILY_LIMIT);
  });
});

describe('when the mail does not go', () => {
  it('says so rather than leaving somebody waiting for it', async () => {
    const answer = await ask({ email: EMAIL }, world(fakeStore(), { failMail: true }));
    expect(answer.status).toBe(503);
  });

  it('and undoes the record, so the retry a person makes straight away works', async () => {
    // The bug this is here for: a failed send that left the record behind
    // would spend one of the day's five and start a cooldown, so the obvious
    // thing to do next is silently ignored.
    const store = fakeStore();
    await ask({ email: EMAIL }, world(store, { failMail: true }));

    // What is left behind is a record that counts nothing and opens nothing,
    // rather than no record at all. The rollback used to delete the key, which
    // deletes whatever is there *now*: a second request that had written its
    // own record in between lost the live code it had just mailed. So it
    // writes, conditionally on still owning the key, and what it writes is
    // expired and has spent none of the day's five.
    const [[, left]] = snapshot(store);
    expect((left as { sent: number }).sent).toBe(0);
    expect((left as { expiresAt: number }).expiresAt).toBeLessThanOrEqual(NOW);

    // Which is the whole point: the obvious thing to do next still works.
    const surroundings = world(store);
    expect((await ask({ email: EMAIL }, surroundings)).status).toBe(202);
    expect(surroundings.sent).toHaveLength(1);
  });

  it('and puts back the record that was already there', async () => {
    const store = fakeStore();
    const { surroundings, tick } = clocked(store);
    await ask({ email: EMAIL }, surroundings);
    const before = JSON.stringify(snapshot(store));

    tick(COOLDOWN_MS + 1);
    await ask({ email: EMAIL }, world(store, { failMail: true, now: surroundings.now }));
    expect(JSON.stringify(snapshot(store))).toBe(before);
  });
});

/* -------------------------------------------------------------- redeeming */

describe('trading a code for a token', () => {
  const signedIn = async (email = EMAIL) => {
    const store = fakeStore();
    const surroundings = world(store);
    await ask({ email }, surroundings);
    return { store, surroundings };
  };

  it('answers with a token the server itself accepts', async () => {
    const { surroundings } = await signedIn();
    const answer = await trade({ email: EMAIL, code: CODE }, surroundings);
    expect(answer.status).toBe(200);

    const { token } = (await answer.json()) as { token: string };
    // Verified rather than read. Minting and checking are one format, and a
    // hand-written expectation only proves the author agreed with themselves.
    const claim = await verifyToken(SECRET, token, NOW);
    expect(claim).not.toBeNull();
    expect(claim?.tier).toBe('free');
    expect(claim?.subject).toBe(await subjectForEmail(SECRET, EMAIL));
    expect(claim?.expiresAt).toBeGreaterThan(NOW);
  });

  it('and the subject is this app’s own, not a customer and not the passcode', async () => {
    // A subject names a bucket, so two schemes that could collide are two
    // people who could share a poker history.
    const subject = await subjectForEmail(SECRET, EMAIL);
    expect(subject.startsWith(SUBJECT_PREFIX)).toBe(true);
    expect(subject.startsWith('cus_')).toBe(false);
    expect(subject).not.toBe(SUBJECT_PASSCODE);
    expect(subject).toMatch(/^[A-Za-z0-9_]{1,64}$/);
    // And the grammar has to be able to read it back off a real token.
    const { surroundings } = await signedIn();
    const answer = await trade({ email: EMAIL, code: CODE }, surroundings);
    const { token } = (await answer.json()) as { token: string };
    expect(readClaim(token, NOW)?.subject).toBe(subject);
  });

  it('gives the same subject however the address was spelled', async () => {
    // The same inbox is the same person and has to be the same log. Getting
    // this wrong hands somebody a second, empty history and no way to tell why.
    expect(await subjectForEmail(SECRET, 'Player@Example.com')).toBe(
      await subjectForEmail(SECRET, EMAIL),
    );
    const { surroundings } = await signedIn('Player@Example.com');
    const answer = await trade({ email: ' PLAYER@example.com ', code: CODE }, surroundings);
    expect(answer.status).toBe(200);
  });

  it('spends the code, so the same one twice is refused', async () => {
    const { surroundings } = await signedIn();
    expect((await trade({ email: EMAIL, code: CODE }, surroundings)).status).toBe(200);
    expect((await trade({ email: EMAIL, code: CODE }, surroundings)).status).toBe(400);
  });

  it('refuses a wrong code and an address it never mailed identically', async () => {
    // Byte for byte, because the difference is which addresses have asked.
    const { surroundings } = await signedIn();
    const wrong = await trade({ email: EMAIL, code: '000000' }, surroundings);
    const stranger = await trade({ email: 'nobody@example.com', code: CODE }, surroundings);
    expect(wrong.status).toBe(stranger.status);
    expect(await wrong.text()).toBe(await stranger.text());
    expect(wrong.status).toBe(400);
  });

  it('refuses a code that has expired', async () => {
    const store = fakeStore();
    const { surroundings, tick } = clocked(store);
    await ask({ email: EMAIL }, surroundings);
    tick(CODE_TTL_MS + 1);
    expect((await trade({ email: EMAIL, code: CODE }, surroundings)).status).toBe(400);
  });

  it('kills a code that has been guessed at, rather than leaving it to them', async () => {
    const { store, surroundings } = await signedIn();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      expect((await trade({ email: EMAIL, code: '000000' }, surroundings)).status).toBe(400);
    }
    expect((await trade({ email: EMAIL, code: '000000' }, surroundings)).status).toBe(429);
    // Dead, so the right code no longer works either. That is the point: a
    // code somebody is working on is a code worth losing.
    expect((await trade({ email: EMAIL, code: CODE }, surroundings)).status).toBe(400);
    expect([...store.held.keys()].some((key) => key.startsWith('code/'))).toBe(false);
  });

  it('refuses a body with the fields missing', async () => {
    const { surroundings } = await signedIn();
    expect((await trade({ email: EMAIL }, surroundings)).status).toBe(400);
    expect((await trade({ code: CODE }, surroundings)).status).toBe(400);
  });

  it('hands out no token when the code cannot be spent', async () => {
    // A delete that failed is a code that is still live. Answering with the
    // token anyway would hand out a credential and leave the way to it open.
    const { store, surroundings } = await signedIn();
    store.deleteThrows = true;
    const answer = await trade({ email: EMAIL, code: CODE }, surroundings);
    expect(answer.status).toBe(503);
    expect(await answer.text()).not.toContain('token');
  });
});

/* ------------------------------------------------------- all at once */

describe('what happens when requests arrive together', () => {
  /**
   * Every one of these fails on a bare read-modify-write, which is what all
   * three counters here were until an audit put twelve simultaneous requests
   * through them. A lost update does not cost one request past the limit; it
   * costs the whole limit, because everybody who read the same number also
   * passes the same check. Five a day meant five per round trip.
   *
   * The gate is what makes that reproducible rather than a matter of luck:
   * every reader stops until it opens, so the reads genuinely all precede the
   * writes.
   */
  const together = async <T>(count: number, store: Fake, run: () => Promise<T>): Promise<T[]> => {
    let open = () => {};
    store.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const all = Array.from({ length: count }, run);
    // Let each one get as far as its read before any of them is let through.
    await Promise.resolve();
    store.gate = null;
    open();
    return Promise.all(all);
  };

  it('mails once for one address, not once per request', async () => {
    // Twelve at once used to be twelve mails, against a cap of five, and the
    // record left behind said `sent: 1`.
    const store = fakeStore();
    const surroundings = world(store);
    const answers = await together(12, store, () => ask({ email: EMAIL }, surroundings));

    expect(answers.every((one) => one.status === 202)).toBe(true);
    expect(surroundings.sent).toHaveLength(1);
  });

  it('and a burst never gets more than the day allows, however many bursts', async () => {
    // The bound the sweep next door exists to protect, stated as the thing it
    // actually promises: an address cannot be mailed more than five times in a
    // day by anybody, at any concurrency.
    const store = fakeStore();
    let at = NOW;
    const surroundings = world(store, { now: () => at });
    for (let burst = 0; burst < 8; burst += 1) {
      await together(6, store, () => ask({ email: EMAIL }, surroundings));
      at += COOLDOWN_MS + 1;
    }
    expect(surroundings.sent.length).toBeLessThanOrEqual(DAILY_LIMIT);
  });

  it('counts a caller once per request, so twenty an hour is not twenty a round trip', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    const from = { 'x-nf-client-connection-ip': '198.51.100.4' };
    // Well past the limit, all at once. Every one of them has to be counted or
    // refused; what must not happen is all of them passing on the same count.
    const answers = await together(CALLER_LIMIT * 2, store, () =>
      ask({ email: EMAIL }, surroundings, from),
    );
    expect(answers.filter((one) => one.status === 429).length).toBeGreaterThan(0);
  });

  it('and a burst of guesses kills the code, rather than counting as one guess', async () => {
    // Twenty simultaneous wrong guesses used to leave `attempts` at one,
    // because each of them read zero and each of them wrote one. The code then
    // had thirteen minutes of life left and no working counter in front of it,
    // which against six digits and a rotated pool of callers is a way in.
    //
    // Counting the guess before comparing it is what fixes that, and the
    // property to hold is the one somebody attacking this cares about: a burst
    // cannot leave the code alive. Not the number of 400s, which counts
    // refusals after the code is already dead and there is nothing left to
    // guess at.
    const store = fakeStore();
    const surroundings = world(store);
    await ask({ email: EMAIL }, surroundings);

    const answers = await together(20, store, () =>
      trade({ email: EMAIL, code: '000000' }, surroundings),
    );
    expect(answers.some((one) => one.status === 200)).toBe(false);
    expect([...store.held.keys()].some((key) => key.startsWith('code/'))).toBe(false);
    // And it stays dead: the right code cannot rescue it either.
    expect((await trade({ email: EMAIL, code: CODE }, surroundings)).status).not.toBe(200);
  });

  it('and the right code still works after a burst of wrong ones has been refused', async () => {
    // The other side of that: refusing to compare must not lock out the person
    // whose code it is, so long as the counter has not really run out.
    const store = fakeStore();
    const surroundings = world(store);
    await ask({ email: EMAIL }, surroundings);
    await together(3, store, () => trade({ email: EMAIL, code: '000000' }, surroundings));
    expect((await trade({ email: EMAIL, code: CODE }, surroundings)).status).toBe(200);
  });

  it('and a failed send never takes away a code another request just mailed', async () => {
    // The rollback used to delete the key outright. Two requests arrive, the
    // first mails and answers 202, the second's mailer fails, and the second
    // deletes the record holding the first one's live code: the person reads
    // the code off their phone and is told it is wrong.
    const store = fakeStore();
    const good = world(store);
    const bad = world(store, { failMail: true });

    let open = () => {};
    store.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const both = [ask({ email: EMAIL }, good), ask({ email: EMAIL }, bad)];
    await Promise.resolve();
    store.gate = null;
    open();
    await Promise.all(both);

    expect(good.sent).toHaveLength(1);
    expect((await trade({ email: EMAIL, code: CODE }, world(store))).status).toBe(200);
  });

  it('and refuses a caller whose own counter it can never write, rather than waving them through', async () => {
    // Losing every round on your own rate-limit record means you are
    // generating that contention yourself, which is the burst the limit is
    // for. Answering 429 is the conservative direction; the alternative is
    // that hammering hard enough is the way past the limit.
    const store = fakeStore();
    store.loses.add('caller/');
    const surroundings = world(store);
    const from = { 'x-nf-client-connection-ip': '198.51.100.7' };
    expect((await ask({ email: EMAIL }, surroundings, from)).status).toBe(429);
    expect(surroundings.sent).toEqual([]);
    // And the same on the other path, which shares the counter.
    expect((await trade({ email: EMAIL, code: CODE }, surroundings, from)).status).toBe(429);
  });

  it('and every read it makes is a strongly consistent one', async () => {
    // The default read is served from a cache that can lag by up to a minute,
    // which on this path means deciding a cap against a count from before the
    // last mail, and on the redemption path means telling somebody their code
    // is wrong because the record holding it has not arrived yet.
    const store = fakeStore();
    const surroundings = world(store);
    await ask({ email: EMAIL }, surroundings, { 'x-nf-client-connection-ip': '198.51.100.9' });
    await trade({ email: EMAIL, code: CODE }, surroundings);

    expect(store.reads.length).toBeGreaterThan(2);
    for (const read of store.reads) {
      expect(read.options).toEqual({ type: 'json', consistency: 'strong' });
    }
  });

  it('and does not believe a write that came back without a tag', async () => {
    // The client reports `modified: true` for every status except a 412, so a
    // 429 after its own retries is indistinguishable from a write that landed.
    // Mailing on one of those hands somebody a code the store never kept.
    const store = fakeStore();
    const surroundings = world(store);
    const key = [...store.held.keys()];
    expect(key).toHaveLength(0);

    // Every write to the pending record comes back tagless, so no round can
    // confirm itself and nothing may be mailed.
    const original = store.setJSON.bind(store);
    store.setJSON = async (k, v, o) => {
      const written = await original(k, v, o);
      return k.startsWith('code/') ? { modified: written.modified } : written;
    };

    expect((await ask({ email: EMAIL }, surroundings)).status).toBe(202);
    expect(surroundings.sent).toEqual([]);
  });
});

/* ------------------------------------------------------------ the caller */

describe('how often one caller can ask', () => {
  const from = (ip: string) => ({ 'x-nf-client-connection-ip': ip });

  it('stops a caller past the limit, before anything is generated', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    for (let i = 0; i < CALLER_LIMIT; i += 1) {
      expect((await ask({ email: `p${i}@example.com` }, surroundings, from('1.2.3.4'))).status)
        .toBe(202);
    }
    const stopped = await ask({ email: 'p99@example.com' }, surroundings, from('1.2.3.4'));
    expect(stopped.status).toBe(429);
    expect(surroundings.sent).toHaveLength(CALLER_LIMIT);
  });

  it('and stops them on the redemption path too', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    for (let i = 0; i < CALLER_LIMIT; i += 1) {
      await ask({ email: `p${i}@example.com` }, surroundings, from('5.6.7.8'));
    }
    expect((await trade({ email: EMAIL, code: CODE }, surroundings, from('5.6.7.8'))).status)
      .toBe(429);
  });

  it('counts callers apart', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    for (let i = 0; i < CALLER_LIMIT; i += 1) {
      await ask({ email: `p${i}@example.com` }, surroundings, from('1.2.3.4'));
    }
    expect((await ask({ email: EMAIL }, surroundings, from('9.9.9.9'))).status).toBe(202);
  });

  it('reads the forwarded header when there is no Netlify one', async () => {
    const store = fakeStore();
    const surroundings = world(store);
    const headers = { 'x-forwarded-for': '4.4.4.4, 8.8.8.8' };
    for (let i = 0; i < CALLER_LIMIT; i += 1) {
      await ask({ email: `p${i}@example.com` }, surroundings, headers);
    }
    expect((await ask({ email: EMAIL }, surroundings, headers)).status).toBe(429);
  });

  it('does not refuse a caller it cannot identify', async () => {
    // Refusing would break every deployment that sets neither header. The
    // per-address caps are what hold for them, and they are the ones that
    // bound the mail.
    const store = fakeStore();
    const surroundings = world(store);
    for (let i = 0; i < CALLER_LIMIT + 5; i += 1) {
      expect((await ask({ email: `p${i}@example.com` }, surroundings)).status).toBe(202);
    }
  });

  it('writes down no address for the caller either', async () => {
    const store = fakeStore();
    await ask({ email: EMAIL }, world(store), from('203.0.113.7'));
    expect(JSON.stringify([...store.held.keys()])).not.toContain('203.0.113.7');
  });
});

/* ------------------------------------------------------- a store that fails */

describe('when the store cannot be read or written', () => {
  it('says unreachable rather than mailing into the dark', async () => {
    const store = fakeStore({ readThrows: true });
    const surroundings = world(store);
    expect((await ask({ email: EMAIL }, surroundings)).status).toBe(503);
    expect(surroundings.sent).toEqual([]);
  });

  it('and does not mail a code it could not write down', async () => {
    // The other order is worse than either failure: a person reading a code
    // off their phone that this endpoint has never heard of.
    const store = fakeStore();
    const surroundings = world(store);
    store.writeThrows = true;
    expect((await ask({ email: EMAIL }, surroundings)).status).toBe(503);
    expect(surroundings.sent).toEqual([]);
  });

  it('and refuses to read a record it cannot reach on the way in', async () => {
    const store = fakeStore();
    await ask({ email: EMAIL }, world(store));
    store.readThrows = true;
    expect((await trade({ email: EMAIL, code: CODE }, world(store))).status).toBe(503);
  });
});

/* ------------------------------------------------------------------ renewing */

/**
 * The half nobody asks for.
 *
 * A token is good for thirty days, and until this existed it was good for
 * exactly thirty days: on the thirty-first the app cleared it, went back to the
 * local database, and said nothing. Most of what is asserted here is what it
 * refuses, because a renewal that is too willing is worse than none at all.
 */
describe('renewing a token', () => {
  const CALLER = { 'x-nf-client-connection-ip': '203.0.113.42' };

  const tokenFor = async (email = EMAIL): Promise<string> => {
    const surroundings = world(fakeStore());
    await ask({ email }, surroundings);
    const answer = await trade({ email, code: CODE }, surroundings);
    return ((await answer.json()) as { token: string }).token;
  };

  const renewWith = (
    token: string | null,
    surroundings: Surroundings = world(fakeStore()),
    headers: Record<string, string> = {},
  ): Promise<Response> =>
    handleSignIn(
      new Request('https://log.poker/api/signin/renew', {
        method: 'POST',
        headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...headers },
        body: '{}',
      }),
      surroundings,
    );

  it('hands back a token the server accepts, for the same person, lasting longer', async () => {
    const held = await tokenFor();
    const before = readClaim(held, NOW);

    // A fortnight on, which is inside nothing in particular: the server does
    // not care how close to the end this is, only that it is not past it.
    const later = NOW + 14 * DAY_MS;
    const answer = await renewWith(held, world(fakeStore(), { now: () => later }));
    expect(answer.status).toBe(200);

    const { token } = (await answer.json()) as { token: string };
    const claim = await verifyToken(SECRET, token, later);
    expect(claim).not.toBeNull();
    expect(claim?.subject).toBe(before?.subject);
    expect(claim?.tier).toBe('free');
    expect(claim?.expiresAt).toBeGreaterThan(before?.expiresAt ?? 0);
  });

  it('refuses one signed with another key, and says which half in the log only', async () => {
    const said: unknown[] = [];
    const logged = jest.spyOn(console, 'error').mockImplementation((...args) => said.push(args));
    try {
      const answer = await renewWith(
        await tokenFor(),
        world(fakeStore(), { secret: 'a-different-key' }),
      );
      expect(answer.status).toBe(401);
      expect(JSON.stringify(said)).toContain('signature');
      expect(await answer.text()).not.toContain('signature');
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses an expired one, or the thirty days never meant anything', async () => {
    const held = await tokenFor();
    const after = (readClaim(held, NOW)?.expiresAt ?? NOW) + 1000;
    expect((await renewWith(held, world(fakeStore(), { now: () => after }))).status).toBe(401);
  });

  it('refuses a request carrying no token, and writes nothing down for it', async () => {
    // A public URL. A line per unauthenticated poke is a log nobody can read
    // on the day they need to.
    const said: unknown[] = [];
    const logged = jest.spyOn(console, 'error').mockImplementation((...args) => said.push(args));
    try {
      expect((await renewWith(null)).status).toBe(401);
      expect(said).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses a passcode, which names a door rather than a person', async () => {
    // Properly signed, so that what is being refused is the subject and not
    // the token: everybody who typed one shares it, and a bucket for it would
    // be one bucket for every preview visitor.
    const passcode = await mintToken(SECRET, {
      subject: SUBJECT_PASSCODE,
      tier: 'free',
      expiresAt: NOW + DAY_MS,
    });
    // 403 rather than 401: the token is fine and the subject is not, which is
    // the difference between "sign in again" and "not you".
    expect((await renewWith(passcode)).status).toBe(403);
  });

  it('will not extend a paid claim, because it cannot ask whether it is still true', async () => {
    // Log mints the free tier and has no way to find out who has bought. A paid
    // claim is Untilt's to renew, and renewing it here would be a way to hold
    // one alive forever without the check that grants it. Downgrading it to
    // free would be worse: access taken away somewhere this cannot see.
    const paid = await mintToken(SECRET, {
      subject: await subjectForEmail(SECRET, EMAIL),
      tier: 'full',
      expiresAt: NOW + DAY_MS,
    });
    expect((await renewWith(paid)).status).toBe(403);
  });

  it('and works on a day the blob store does not', async () => {
    // A signature check and a mint, both pure. Worth having on the one request
    // every launch makes.
    expect((await renewWith(await tokenFor(), world(null))).status).toBe(200);
  });

  it('and never spends the mail budget a real sign-in needs', async () => {
    // That limit exists to bound mail. Spending it on launches would let a few
    // devices behind one office network refuse a colleague's sign-in, so the
    // renewals below carry the same caller as the ask that follows them.
    const surroundings = world(fakeStore());
    const held = await tokenFor();

    for (let round = 0; round < CALLER_LIMIT + 5; round += 1) {
      expect((await renewWith(held, surroundings, CALLER)).status).toBe(200);
    }

    expect((await ask({ email: 'someone@example.com' }, surroundings, CALLER)).status).toBe(202);
  });
});
