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
 *   npm run check:gate -- --signin-origin https://deploy-preview-1--untilt.netlify.app
 *
 * Two different questions, and it is worth being clear which one is being
 * asked. Minting proves the key stored on the site is byte for byte the key you
 * typed here, and nothing more: paste damage, and only paste damage. A token
 * Untilt signed is the one that proves the key is *Untilt's*, which is the
 * question that actually matters, because the two apps agreeing is the whole
 * feature.
 *
 * `--signin` gets that second token the way the app will: it asks Untilt to
 * mail a code, takes the code, and trades it for a token. Two endpoints and no
 * browser, which beats reading `localStorage` out of a dev build.
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
const SIGNIN_ORIGIN = valueOf('--signin-origin') ?? 'https://untilt.poker';

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
      'GATE_SECRET is not set on the site at all, or is set to an empty string.',
      '',
      'Netlify UI, Site configuration, Environment variables. A variable added',
      'after the last deploy does not reach a running function until the site is',
      'deployed again.',
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

const askUntilt = async (path, body) => {
  try {
    return await fetch(`${SIGNIN_ORIGIN}${path}`, {
      method: 'POST',
      // Accept is what the endpoint keys on. Without it it answers the way it
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
 * A token, minted by Untilt, the way the app will ask for one.
 *
 * The code and never the link. Mail opens a link in a browser, and a browser
 * is the one place this token is no use, which is the reason the code flow
 * exists at all.
 */
const signIn = async (address) => {
  say(`Asking ${SIGNIN_ORIGIN} to mail a code to ${address}.`, '');

  const asked = await askUntilt('/api/signin', { email: address });
  if (asked === null) stop(`Could not reach ${SIGNIN_ORIGIN}.`);
  if (asked.status === 429) stop('Asked too often. Untilt rate limits this; wait and retry.');
  if (!asked.ok) stop(`Sign-in would not take that address (HTTP ${asked.status}).`);

  say(
    'Sent, if there was anywhere to send it.',
    '',
    'The endpoint answers the same whether or not it has heard of an address, on',
    'purpose, so that nobody can use it to ask who has bought. So a 202 is not a',
    'promise that mail is coming: if none arrives, that address has not bought.',
    '',
  );

  const code = await readLine('Code from the email: ');
  if (!code) stop('No code, so there is nothing to trade.');

  const traded = await askUntilt('/api/signin/code', { email: address, code });
  if (traded === null) stop(`Could not reach ${SIGNIN_ORIGIN}.`);
  if (traded.status === 429) stop('Asked too often. Wait and retry.');
  if (!traded.ok) stop(`That code was refused (HTTP ${traded.status}). Codes expire; ask again.`);

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

  say('', 'Untilt signed a token. Now to see whether Log agrees.', '');
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
