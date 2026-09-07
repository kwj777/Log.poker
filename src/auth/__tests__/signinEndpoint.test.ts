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
import { SUBJECT_PREFIX, subjectForEmail, verifyToken } from '../../sync/verify';
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

interface Fake extends CodeStore {
  held: Map<string, unknown>;
  reads: number;
  readThrows: boolean;
  writeThrows: boolean;
  deleteThrows: boolean;
}

const fakeStore = (over: Partial<Fake> = {}): Fake => {
  const store: Fake = {
    held: new Map(),
    reads: 0,
    readThrows: false,
    writeThrows: false,
    deleteThrows: false,
    async get(key) {
      store.reads += 1;
      if (store.readThrows) throw new Error('unreachable');
      return store.held.get(key) ?? null;
    },
    async setJSON(key, value) {
      if (store.writeThrows) throw new Error('unreachable');
      store.held.set(key, JSON.parse(JSON.stringify(value)));
      return null;
    },
    async delete(key) {
      if (store.deleteThrows) throw new Error('unreachable');
      store.held.delete(key);
    },
    ...over,
  };
  return store;
};

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
    expect(source).toContain("export const config = { path: ['/api/signin', '/api/signin/code'] };");
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
    const written = JSON.stringify([...store.held.entries()]);
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
    // Nothing at all: no caller was identifiable, so the pending record is the
    // only thing that could have been written and it was taken back.
    expect(store.held.size).toBe(0);

    const surroundings = world(store);
    expect((await ask({ email: EMAIL }, surroundings)).status).toBe(202);
    expect(surroundings.sent).toHaveLength(1);
  });

  it('and puts back the record that was already there', async () => {
    const store = fakeStore();
    const { surroundings, tick } = clocked(store);
    await ask({ email: EMAIL }, surroundings);
    const before = JSON.stringify([...store.held.entries()]);

    tick(COOLDOWN_MS + 1);
    await ask({ email: EMAIL }, world(store, { failMail: true, now: surroundings.now }));
    expect(JSON.stringify([...store.held.entries()])).toBe(before);
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
