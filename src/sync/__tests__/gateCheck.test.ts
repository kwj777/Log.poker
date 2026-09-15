/**
 * What `scripts/check-gate.mjs` has to get right.
 *
 * The script exists to answer "is the key on the site the right key", and it
 * answers by getting hold of a token and seeing whether the endpoint takes it.
 * So a script that is wrong about the token reports a wrong key when the key is
 * fine, and the person reading it goes looking for a problem that is not there.
 * Worse, it can only fail in that direction, so nothing about the output would
 * ever look suspicious.
 *
 * Run rather than read, in both of its modes. The minted token is handed to
 * `verifyToken`, the thing that actually guards the endpoint. The signed-in
 * token is fetched from a stand-in for Untilt and pushed at a stand-in for the
 * endpoint, and the test watches what the script does to both of them.
 */

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { hasOwnBucket, subjectForEmail, subjectForGateCheck, verifyToken } from '../verify';

const SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'check-gate.mjs');
const SECRET = 'a-gate-secret';

const printToken = (secret: string): string =>
  execFileSync('node', [SCRIPT, '--print-token'], {
    encoding: 'utf8',
    env: { ...process.env, GATE_SECRET: secret },
  }).trim();

describe('the token the gate check mints', () => {
  it('is one the endpoint accepts, which is the whole of what the check means', async () => {
    const claim = await verifyToken(SECRET, printToken(SECRET), Date.now());
    expect(claim).toMatchObject({ tier: 'full' });
    // Not just that it verifies. The gate asks a second question now -- is
    // this a subject Log's own door minted -- and a check whose token cleared
    // the signature and failed the gate would report a broken key on a working
    // one, which is the one lie this script must never tell.
    expect(hasOwnBucket(claim)).toBe(true);
  });

  it('and is refused under any other key, or the check would pass on a wrong one', async () => {
    expect(await verifyToken('another-gate-secret', printToken(SECRET), Date.now())).toBeNull();
  });

  it('names a subject of its own, so a check never writes into somebody real', async () => {
    const claim = await verifyToken(SECRET, printToken(SECRET), Date.now());
    expect(claim?.subject).toBe(await subjectForGateCheck(SECRET));
    expect(claim?.subject).not.toBe('passcode');
  });

  it('and one no address can reach, so it is nobody rather than somebody unlikely', async () => {
    // The bucket this writes and erases has to be one no person could be
    // sitting in. Both derivations have the same shape now, so the only thing
    // keeping them apart is the preimage.
    const mine = await subjectForGateCheck(SECRET);
    for (const address of ['gatecheck', 'gatecheck@example.com', '', 'log.gatecheck']) {
      expect(await subjectForEmail(SECRET, address)).not.toBe(mine);
    }
  });

  it('and the script derives the same subject the app would', async () => {
    // Mirrored rather than imported, because the script runs on node with
    // nothing installed -- which is exactly the arrangement that drifts.
    const claim = await verifyToken(SECRET, printToken(SECRET), Date.now());
    expect(claim?.subject).toBe(await subjectForGateCheck(SECRET));
  });
});

/* ------------------------------------------------------------- signing in */

/** One server standing in for both halves: Untilt's sign-in and Log's sync. */
const stubs = (
  code: string,
  refuseSignIn: { status: number; body: string } | null = null,
  sync: { status: number; body: string } = { status: 200, body: '{"cursor":0}' },
) => {
  const seen: { method: string; path: string; accept?: string; body: string }[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const path = request.url ?? '';
      seen.push({
        method: request.method ?? '',
        path,
        accept: request.headers.accept,
        body: raw,
      });

      if (path === '/api/signin') {
        if (refuseSignIn !== null) {
          return void response
            .writeHead(refuseSignIn.status, { 'content-type': 'application/json' })
            .end(refuseSignIn.body);
        }
        return void response.writeHead(202).end();
      }

      if (path === '/api/signin/code') {
        if (JSON.parse(raw).code !== code) {
          return void response
            .writeHead(400, { 'content-type': 'application/json' })
            .end('{"error":"rejected"}');
        }
        const payload = `${Math.floor(Date.now() / 1000) + 3600}.full.log_c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3`;
        const signature = createHmac('sha256', SECRET)
          .update(payload)
          .digest('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        return void response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ token: `${payload}.${signature}` }));
      }

      if (request.method === 'DELETE') return void response.writeHead(204).end();
      response
        .writeHead(sync.status, { 'content-type': 'application/json' })
        .end(sync.body);
    });
  });
  return { server, seen };
};

const listening = (server: Server): Promise<string> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });

describe('signing in for a token the door actually minted', () => {
  const CODE = '123456';
  let server: Server;
  let seen: { method: string; path: string; accept?: string; body: string }[];
  let origin: string;

  const stand = async (
    refuse: { status: number; body: string } | null = null,
    sync?: { status: number; body: string },
  ) => {
    server.close();
    ({ server, seen } = stubs(CODE, refuse, sync));
    origin = await listening(server);
  };

  beforeEach(async () => {
    ({ server, seen } = stubs(CODE));
    origin = await listening(server);
  });

  afterEach(() => {
    server.close();
  });

  /**
   * Spawned rather than `execFileSync`, which is the whole reason this suite
   * can exist: a synchronous child blocks this thread's event loop, and the
   * server it is supposed to be talking to is on that loop. The deadlock is
   * total and looks exactly like a hung test.
   */
  const run = (typed: string): Promise<string> =>
    new Promise((resolve) => {
      const child = spawn('node', [
        SCRIPT,
        '--signin',
        'somebody@example.com',
        '--signin-origin',
        origin,
        '--origin',
        origin,
      ]);
      let said = '';
      child.stdout.on('data', (chunk) => {
        said += chunk;
      });
      child.on('close', () => resolve(said));
      child.stdin.end(`${typed}\n`);
    });

  it('asks for a code, trades it, and pushes what came back', async () => {
    const said = await run(CODE);

    expect(seen.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /api/signin',
      'POST /api/signin/code',
      'POST /api/sync',
    ]);
    // The default door is Log's own, and its subject is one Log's sync takes.
    expect(said).toContain('named a subject this site mints');
  });

  it('and reads a 403 as the pass when the token came from the other door', async () => {
    // The one that changed. Log's sync now takes only subjects its own door
    // minted, so a token of Untilt's reaches the gate and is turned away there
    // -- and reaching the gate at all is the whole proof, because a wrong key
    // answers 401 without ever getting to the question of who the token names.
    // Reporting that as a failure would send somebody to replace a key that is
    // correct, which is the one lie this script must never tell.
    await stand(null, { status: 403, body: '{"error":"forbidden"}' });
    const said = await run(CODE);
    expect(said).toContain('The key on the site is the key that signed this');
    expect(said).toContain('a 403 is the pass');
    expect(said).toContain('another door in the family');
    // And it does not erase anything: the token is not one this run minted.
    expect(seen.filter((request) => request.method === 'DELETE')).toEqual([]);
  });

  it('and asks for JSON, or the answer is a page and a cookie with no token in it', async () => {
    // The one header the whole flow turns on. Without it Untilt answers the way
    // it answers a browser, and a `__Host-` cookie is no use to another domain.
    await run(CODE);
    for (const request of seen.filter((one) => one.path.startsWith('/api/signin'))) {
      expect(request.accept).toBe('application/json');
    }
  });

  it('never erases a bucket behind a token it did not mint itself', async () => {
    // That token names a person, and their history is not a check's to tidy
    // away. This is the assertion that keeps the erase safe to have at all.
    await run(CODE);
    expect(seen.filter((request) => request.method === 'DELETE')).toEqual([]);
  });

  it('stops on a code the endpoint refuses rather than checking anything', async () => {
    const said = await run('000000');
    expect(said).toContain('That code was refused');
    expect(seen.map((request) => request.path)).not.toContain('/api/sync');
  });

  it('reads a 503 as the site rather than as the address', async () => {
    // The failure whoever is running this is likeliest to hit, because they are
    // running it having just configured the site. Reporting it as "would not
    // take that address" sends them to look at their own email.
    await stand({ status: 503, body: '{"error":"unreachable"}' });
    const said = await run(CODE);
    expect(said).toContain('the site rather than the address');
    expect(said).toContain('RESEND_API_KEY');
    expect(said).toContain('SIGNIN_FROM');
    expect(said).not.toContain('would not take that address');
    expect(seen.map((request) => request.path)).not.toContain('/api/sync');
  });

  it('and offers both things `off` can mean, rather than guessing at one', async () => {
    // `off` is the endpoint's word for *not configured*, and it covers two
    // causes: no key to sign with, and nowhere to put what it signs. This used
    // to report it as the key alone, which was safe only while a missing store
    // could not happen: `getStore` threw rather than returning null, so that
    // branch was unreachable. Wrapping the thunk made it reachable, and made
    // this message wrong for the case it had just enabled.
    await stand({ status: 503, body: '{"error":"off"}' });
    const said = await run(CODE);
    expect(said).toContain('GATE_SECRET is not set');
    expect(said).toContain('Blobs is not provisioned');
    // And it says how to tell them apart, which the wire cannot.
    expect(said).toContain('no blob store configured');
    // Still not the mailer: a mailer that is down does not answer `off`.
    expect(said).not.toContain('RESEND_API_KEY');
  });
});

/* ------------------------------------------- the guide to reading the log */

describe('the deploy-log lines it tells somebody to search for', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const endpoint = readFileSync(
    join(__dirname, '..', '..', 'auth', 'signinEndpoint.ts'),
    'utf8',
  );

  const table = script.slice(
    script.indexOf('const SIGNIN_LOG_LINES = ['),
    script.indexOf('];', script.indexOf('const SIGNIN_LOG_LINES = [')),
  );
  const named = [...table.matchAll(/\['([^']+)',/g)].map((match) => match[1]);

  it('are lines the endpoint actually writes', () => {
    // The anchoring rule, and the reason the list is a table rather than prose
    // inside a message. Somebody who searches a deploy log for a string that is
    // not there concludes the log is empty and goes looking somewhere else, so
    // a stale guide is worse than none.
    //
    // This is not hypothetical. A rewrite of the endpoint added six ways to
    // answer 503 while this still named two of them, and nothing noticed,
    // because the guide and the code had no relationship a test could see.
    expect(named.length).toBeGreaterThan(2);
    for (const line of named) {
      expect(endpoint).toContain(`console.error('signin: ${line}'`);
    }
  });

  it('and cover every way that endpoint answers 503', () => {
    // The other direction, which is the one that goes stale: a new failure path
    // with a log line nobody was told to look for.
    const written = [...endpoint.matchAll(/console\.error\('signin: ([^']+)'/g)].map(
      (match) => match[1],
    );
    const unlisted = [...new Set(written)].filter((line) => !named.includes(line));
    // The ones that are not a 503: a caller refused with 429, and the races,
    // which answer 202 or 429 and are about load rather than configuration.
    expect(unlisted.sort()).toEqual([
      'could not read the caller record',
      'could not undo the pending record',
      'could not write the caller record',
      'gave up after losing every attempt race',
      'gave up after losing every write race',
      'refusing a caller whose own counter it kept losing',
    ]);
  });
});

/* ------------------------------------------- and the rest of what it explains */

describe('what it says a 403 means', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const endpoint = readFileSync(join(__dirname, '..', 'endpoint.ts'), 'utf8');

  const advice = script.slice(script.indexOf('if (status === 403) {'), script.indexOf('if (status === 503'));

  it('names the one thing that endpoint actually refuses', () => {
    // The same drift the deploy-log table above exists to stop, in prose
    // instead of a table. This used to say "a free tier cannot write", which
    // was true while a write sat behind the paid tier. That check is gone --
    // cross-device history is free -- so the advice sent whoever ran it to
    // look at a tier nothing reads, past the one subject that is refused.
    expect(advice).toContain('passcode');
    expect(advice).not.toMatch(/free tier cannot/i);
  });

  it('explains the refusal that is about money, separately from the one that is not', () => {
    /**
     * The tier question came back, as a 402 in front of the two methods that
     * move data. It is a different answer from the 403 above on purpose, and
     * somebody running this from a terminal needs to be told which they got:
     * one is the key or the subject, and the other is neither.
     */
    const paid = script.slice(script.indexOf('if (status === 402) {'), script.indexOf('if (status === 503'));
    expect(paid).toContain('402');
    expect(paid).toMatch(/tier/i);
    // And the asymmetry, because it is the fastest way to tell the two apart
    // from outside: a write refused and a delete served is the tier, not them.
    expect(paid).toMatch(/204|delete/i);
  });

  it('because there is still only the one', () => {
    // If a second 403 ever appears in that endpoint, the advice above is
    // incomplete and this is what says so.
    const refusals = [...endpoint.matchAll(/return json\(\{ error: '[^']+' \}, 403\)/g)];
    expect(refusals).toHaveLength(1);
    expect(endpoint).toContain("if (!hasOwnBucket(claim)) return json({ error: 'forbidden' }, 403);");
  });
});

/* --------------------------------------------------- and what it will not do */

describe('what the gate check will never do', () => {
  const source = readFileSync(SCRIPT, 'utf8');

  it('erases only a bucket it made itself', () => {
    expect(source).toContain('if (answer.status === 200 && minted) {');
    expect(source.match(/send\('DELETE'/g)).toHaveLength(1);
    // Set in one place, and that place is the one that mints.
    expect(source.match(/minted = true/g)).toHaveLength(1);
  });

  it('and never prints the key back out', () => {
    // It is read with the echo off. Printing it into a terminal, or into
    // whatever is capturing that terminal, would undo the point of that.
    expect(source).not.toMatch(/console\.log\([^)]*secret/i);
    expect(source).not.toMatch(/say\([^)]*secret[^)]*\)/i);
  });
});
