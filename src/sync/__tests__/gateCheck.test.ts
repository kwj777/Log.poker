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

import { verifyToken } from '../verify';

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
    expect(claim).toMatchObject({ tier: 'full', subject: 'gatecheck' });
  });

  it('and is refused under any other key, or the check would pass on a wrong one', async () => {
    expect(await verifyToken('another-gate-secret', printToken(SECRET), Date.now())).toBeNull();
  });

  it('names a subject of its own, so a check never writes into somebody real', async () => {
    const claim = await verifyToken(SECRET, printToken(SECRET), Date.now());
    expect(claim?.subject).toBe('gatecheck');
    expect(claim?.subject).not.toBe('passcode');
  });
});

/* ------------------------------------------------------------- signing in */

/** One server standing in for both halves: Untilt's sign-in and Log's sync. */
const stubs = (code: string, refuseSignIn: { status: number; body: string } | null = null) => {
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
        const payload = `${Math.floor(Date.now() / 1000) + 3600}.full.cus_somebody`;
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
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"cursor":0}');
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

describe('signing in for a token Untilt actually minted', () => {
  const CODE = '123456';
  let server: Server;
  let seen: { method: string; path: string; accept?: string; body: string }[];
  let origin: string;

  const stand = async (refuse: { status: number; body: string } | null = null) => {
    server.close();
    ({ server, seen } = stubs(CODE, refuse));
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
    expect(said).toContain('The key on the site is the key Untilt signs with');
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

  it('and names GATE_SECRET when that is the one the endpoint says is missing', async () => {
    await stand({ status: 503, body: '{"error":"off"}' });
    const said = await run(CODE);
    expect(said).toContain('GATE_SECRET is not set');
    // Not the mailer. The endpoint said which, so the check should not guess.
    expect(said).not.toContain('RESEND_API_KEY');
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
