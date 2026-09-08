/**
 * Did `GATE_SECRET` land, and is it the right one?
 *
 * Setting it is a form on Netlify, and the way it goes wrong is quiet. A key
 * that is a newline longer than Untilt's, or truncated by a paste, or simply a
 * different key, answers 401 to every request forever, and 401 is also what the
 * endpoint says to somebody who has not signed in. There is no way to tell
 * those apart from outside, which is the whole reason the deploy log now says
 * which one it was.
 *
 * This asks the endpoint the question directly, from a terminal, before
 * `ALLOW_SIGN_IN` flips and a wrong key becomes a dead form in front of real
 * people.
 *
 *   npm run check:gate                   mint a token from a key you type
 *   npm run check:gate -- --signin <you@example.com>
 *   npm run check:gate -- --token <t>    one you already have
 *   npm run check:gate -- --print-token
 *   npm run check:gate -- --origin https://deploy-preview-1--log.netlify.app
 *   npm run check:gate -- --signin-origin https://untilt.poker
 *
 * Two different questions, and it is worth being clear which one is being
 * asked, because the answer changed when Log started minting its own tokens.
 *
 * **Minting proves paste damage and nothing else.** The key stored on the site
 * is byte for byte the key you typed here.
 *
 * **`--signin` walks the path the app walks**: ask `/api/signin` for a code,
 * read it out of the mail, trade it at `/api/signin/code`, spend the token at
 * `/api/sync`. Two endpoints and no browser, which beats reading
 * `localStorage` out of a dev build. It is the end-to-end check, and it is now
 * the one that has a hole in it: **Log signs and verifies under the same key,
 * so a wrong key that is wrong consistently passes this.** Everything agrees
 * with itself.
 *
 * The hole is closed by pointing `--signin-origin` at `https://untilt.poker`.
 * A token Untilt signed is the only one that proves the key is *Untilt's*, and
 * that is worth knowing even though nothing in Log depends on it any more:
 * subjects and bucket names are HMACs under this key, so it is effectively
 * write once, and finding out it was the wrong one later means orphaning every
 * bucket. Untilt only mails an address that has bought, so that run needs an
 * address that has.
 *
 * The token this mints names the subject `gatecheck`, so a successful run
 * writes a bucket, and the run erases it again on the way out. A token that
 * came from signing in belongs to a person, and nothing is ever erased in that
 * mode.
 */

import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

/** Untilt's format, and the same one `src/sync/verify.ts` re-derives. */
const TTL_SECONDS = 3600;
const SUBJECT = 'gatecheck';

const base64url = (bytes) =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** `<expiry>.<tier>.<subject>.<signature>`, HMAC-SHA256 over the first three. */
const mint = (secret) => {
  const payload = `${Math.floor(Date.now() / 1000) + TTL_SECONDS}.full.${SUBJECT}`;
  return `${payload}.${base64url(createHmac('sha256', secret).update(payload).digest())}`;
};

/* --------------------------------------------------------------- arguments */

const args = process.argv.slice(2);
const valueOf = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};

const origin = valueOf('--origin') ?? 'https://log.poker';
const given = valueOf('--token');
const email = valueOf('--signin');
const printing = args.includes('--print-token');

/**
 * Where the family's sign-in lives. One host mints for all three apps.
 *
 * Overridable for the same reason `--origin` is: a deploy preview of one half
 * has to be checkable against the other. It is also what makes this flow
 * testable end to end, which matters more than it sounds, because the sign-in
 * path is the half that cannot be checked by reading it.
 */
const SIGNIN_ORIGIN = valueOf('--signin-origin') ?? 'https://log.poker';

/* ------------------------------------------------------------- the reading */

const ENTER = ['\n', '\r'];
const END_OF_INPUT = '\u0004';
const INTERRUPT = '\u0003';
const BACKSPACE = ['\u007f', '\b'];

/**
 * Typed rather than passed, so the key never reaches shell history.
 *
 * Echo off where there is a terminal to turn it off on. Piped input still
 * works, which is what lets another script drive this one.
 */
const readSecret = () =>
  new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let piped = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => {
        piped += chunk;
      });
      stdin.on('end', () => resolve(piped.replace(/\r?\n$/, '')));
      stdin.on('error', reject);
      return;
    }

    process.stdout.write('Paste GATE_SECRET (it will not be shown), then press Enter: ');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let typed = '';
    const onData = (chunk) => {
      for (const character of chunk) {
        if (ENTER.includes(character) || character === END_OF_INPUT) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(typed);
          return;
        }
        // Raw mode means the terminal has stopped handling this one for us.
        if (character === INTERRUPT) {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (BACKSPACE.includes(character)) typed = typed.slice(0, -1);
        else typed += character;
      }
    };
    stdin.on('data', onData);
  });

/* ----------------------------------------------------------- what it means */

/** A push of nothing, which is the smallest thing the endpoint will answer. */
const EMPTY = {
  since: 0,
  device: 'device-gatecheck',
  changes: { venues: [], sessions: [], rebuys: [], hands: [], moodEntries: [] },
};

const say = (...lines) => {
  for (const line of lines) console.log(line);
};

/**
 * The lines the sign-in endpoint writes to the deploy log, and what each means.
 *
 * A 503 from `/api/signin` says nothing about which of half a dozen things
 * would not answer, deliberately: a public endpoint that reports *the mailer is
 * down* is a public endpoint reporting infrastructure. The deploy log says
 * which, so this is a guide to reading it.
 *
 * **Every string here is asserted to exist in `src/auth/signinEndpoint.ts`** by
 * `gateCheck.test.ts`. A guide that names lines the code no longer writes is
 * worse than no guide: somebody searching a log for a string that is not there
 * concludes the log is empty and goes looking somewhere else. That test caught
 * this list going stale once already, when a rewrite of the endpoint added six
 * ways to answer 503 and this still named two of them.
 */
const SIGNIN_LOG_LINES = [
  ['no blob store configured', 'Blobs is not provisioned for the site'],
  ['refusing every request; unset: GATE_SECRET', 'the key, and not the store'],
  ['could not read the pending record', 'the blob store, before anything was written'],
  ['could not write the pending record', 'the blob store'],
  ['pending record read carried no tag to write against', 'the store answered with no etag'],
  ['the code was not mailed', 'RESEND_API_KEY, or SIGNIN_FROM is off a verified domain'],
  ['could not count the guess', 'the blob store, on the redemption path'],
  ['could not spend the code', 'the blob store, after the code was accepted'],
];

/** The table above, as aligned columns somebody can scan. */
const logGuide = () => {
  const width = Math.max(...SIGNIN_LOG_LINES.map(([line]) => line.length));
  return SIGNIN_LOG_LINES.map(([line, means]) => `  "${line}"${' '.repeat(width - line.length)}  ${means}`);
};

const explain = (status, body, minted) => {
  if (status === 200) {
    return minted
      ? [
          'The key on the site is exactly the key you typed.',
          '',
          'That rules out a mangled paste. It does not yet prove the key is the one',
          'Untilt signs with, which is the half that matters, because the two apps',
          'agreeing is the whole feature. For that:',
          '',
          '  npm run check:gate -- --signin <your email>',
        ]
      : [
          'That token verified. The key on the site is the key Untilt signs with,',
          'and cross-device history will work for whoever holds this token.',
          '',
          'Nothing was erased: this token names a real person, and their bucket is',
          'theirs. It now holds an empty push, which is a no-op.',
        ];
  }

  if (status === 401) {
    return minted
      ? [
          'The site refused the token, so the key stored there is not the key you',
          'typed here.',
          '',
          'The Netlify function log for this request says which way. `signature`',
          'means the key is simply a different one; `malformed` means what arrived',
          'was not a token at all. The usual cause is a paste that carried a',
          'trailing newline or lost a character at one end.',
        ]
      : [
          'The site refused that token.',
          '',
          'The function log says which half was wrong. `signature` means the key on',
          'the site is not the key Untilt signed this with, which is the thing to',
          'fix. `expired` means the token is old: sign in again and retry.',
          '`malformed` means what was passed to --token is not a token.',
        ];
  }

  if (status === 403) {
    return [
      'The key is right and the token is real: it got past the gate. What it was',
      'refused for is who it names. A free tier cannot write, and the shared',
      '`passcode` subject has no bucket of its own by design.',
    ];
  }

  if (status === 503 && body?.error === 'off') {
    return [
      'The site says this is not configured, which is one of two things and the',
      'answer does not say which:',
      '',
      '  GATE_SECRET is unset, or set to an empty string',
      '  the blob store is not provisioned for the site',
      '',
      'The deploy log says which: "no blob store configured" is the store, and',
      '"refusing every request; unset: GATE_SECRET" is the key.',
      '',
      'For the key: Netlify UI, Site configuration, Environment variables. A',
      'variable added after the last deploy does not reach a running function',
      'until the site is deployed again.',
    ];
  }

  if (status === 503) {
    return [
      'The key is fine and the store is not. The blob store is unconfigured or was',
      'unreachable for this request, and the function log says which.',
    ];
  }

  return [`Unexpected: ${status}. The body is above.`];
};

/* -------------------------------------------------------------- signing in */

/** Echoed, unlike the key: a mailed code is not a secret once it is used. */
const readLine = async (question) => {
  const asking = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await asking.question(question)).trim();
  } finally {
    asking.close();
  }
};

const askSignIn = async (path, body) => {
  try {
    return await fetch(`${SIGNIN_ORIGIN}${path}`, {
      method: 'POST',
      // Log's endpoint answers JSON to everybody, having no page to answer
      // with. Untilt's keys on this header: without it, it answers the way it
      // answers a browser, with a page and a cookie that cannot cross a
      // registrable domain, and there would be no token in the body at all.
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
};

const stop = (...lines) => {
  say(...lines);
  process.exit(1);
};

/**
 * Why a sign-in refused, said as the thing to go and fix.
 *
 * Worth more than the status alone, because the statuses overlap with the
 * reason somebody is running this in the first place. **A 503 is the site, not
 * the address**, and reporting it as "would not take that address" sends
 * whoever just finished setting the site up to look at their own email.
 *
 * The two 503s are told apart by the body, which is the endpoint's own word
 * for what happened: `off` is a key that is not there, and anything else is a
 * store or a mailer that would not answer. Which of those two is in the deploy
 * log rather than on the wire, because a public endpoint saying *the mailer is
 * down* is a public endpoint reporting infrastructure.
 */
const diagnose = async (response, fallback) => {
  let error = null;
  try {
    error = (await response.json())?.error ?? null;
  } catch {
    error = null;
  }

  if (response.status === 503 && error === 'off') {
    stop(
      `${SIGNIN_ORIGIN} answered 503, and says it is not configured.`,
      '',
      'That is one of two things and the answer does not say which, because both',
      'are the same fact from outside: nothing there to sign with, or nowhere to',
      'put what it signs.',
      '',
      '  GATE_SECRET is not set on that site, or is empty',
      '  Blobs is not provisioned for it',
      '',
      'The deploy log tells them apart: "refusing every request; unset:',
      'GATE_SECRET" is the key, and "no blob store configured" is the store.',
      '',
      'For the key: Netlify -> Site configuration -> Environment, then redeploy,',
      'then run this again. A variable added after the last deploy does not reach',
      'a running function until the site is deployed again.',
    );
  }

  if (response.status === 503) {
    stop(
      `${SIGNIN_ORIGIN} answered 503, which is the site rather than the address.`,
      '',
      'Something it needs would not answer, and the answer does not say what,',
      'deliberately. The deploy log does:',
      '',
      ...logGuide(),
      '',
      'The mailer is the usual one straight after setting Resend up. log.poker is',
      'verified at the apex, so the shipped default of signin@log.poker is right',
      'and SIGNIN_FROM wants leaving unset. If it is set to anything off that',
      'domain, that is the thing to undo. Everything else on that list is the',
      'blob store, and Blobs being unprovisioned is what all of them look like.',
    );
  }

  stop(`${fallback} (HTTP ${response.status}).`);
};

/**
 * A token, the way the app asks for one.
 *
 * From `--signin-origin`, which is Log by default and is the door the app
 * actually uses. Point it at Untilt to ask the other question; see the top of
 * this file for which is which.
 *
 * The code and never the link. Mail opens a link in a browser, and a browser
 * is the one place this token is no use, which is the reason the code flow
 * exists at all.
 */
const signIn = async (address) => {
  say(`Asking ${SIGNIN_ORIGIN} to mail a code to ${address}.`, '');

  const asked = await askSignIn('/api/signin', { email: address });
  if (asked === null) stop(`Could not reach ${SIGNIN_ORIGIN}.`);
  if (asked.status === 429) stop('Asked too often. This is rate limited; wait and retry.');
  if (!asked.ok) await diagnose(asked, 'Sign-in would not take that address');

  say(
    'Sent, if anything was going to be sent.',
    '',
    'A 202 is not a promise that mail is coming. Log answers the same whether or',
    'not one went, because the rate limits stop a mail to an address that has just',
    'had one and saying so would report how much mail any address has had. Untilt',
    'answers the same whether or not it has heard of the address at all, so that',
    'nobody can use it to ask who has bought.',
    '',
  );

  const code = await readLine('Code from the email: ');
  if (!code) stop('No code, so there is nothing to trade.');

  const traded = await askSignIn('/api/signin/code', { email: address, code });
  if (traded === null) stop(`Could not reach ${SIGNIN_ORIGIN}.`);
  if (traded.status === 429) stop('Asked too often. Wait and retry.');
  if (!traded.ok) await diagnose(traded, 'That code was refused. Codes expire, so ask again');

  let token = null;
  try {
    token = (await traded.json())?.token ?? null;
  } catch {
    token = null;
  }
  // A 200 carrying something else is a server that changed under us, and
  // sending a non-token onward as a token would report a wrong key.
  if (typeof token !== 'string' || token === '') {
    stop('Sign-in answered 200 without a token in it, which it should never do.');
  }

  say('', `${SIGNIN_ORIGIN} signed a token. Now to see whether the sync agrees.`, '');
  return token;
};

/* --------------------------------------------------------------- the check */

const send = async (method, token, body) => {
  const response = await fetch(`${origin}/api/sync`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, text, body: parsed };
};

const run = async () => {
  let token = given;
  // Only ever the one this run signed for itself. Everything downstream that
  // is allowed to erase reads this, so it is set in exactly one place.
  let minted = false;

  if (token === null && email !== null) {
    token = await signIn(email);
  } else if (token === null) {
    const secret = process.env.GATE_SECRET ?? (await readSecret());
    if (!secret) {
      say('No key given, so there is nothing to check.');
      process.exit(1);
    }
    token = mint(secret);
    minted = true;
  }

  if (printing) {
    say(token);
    return;
  }

  say(`Asking ${origin}/api/sync with a ${minted ? 'freshly minted' : 'supplied'} token.`, '');

  let answer;
  try {
    answer = await send('POST', token, EMPTY);
  } catch (error) {
    say(`Could not reach ${origin}: ${error.message}`);
    process.exit(1);
  }

  say(`HTTP ${answer.status}  ${answer.text}`, '');
  for (const line of explain(answer.status, answer.body, minted)) say(line);

  // Only ever a bucket this run created. A token somebody supplied names a
  // person, and erasing their history to tidy up after a check would be the
  // worst bug in the repository.
  if (answer.status === 200 && minted) {
    const erased = await send('DELETE', token);
    say(
      '',
      erased.status === 204
        ? `Erased the ${SUBJECT} bucket this check created.`
        : `Could not erase the ${SUBJECT} bucket this check created (HTTP ${erased.status}).`,
    );
  }

  process.exit(answer.status === 200 ? 0 : 1);
};

await run();
