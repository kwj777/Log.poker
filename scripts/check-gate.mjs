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
 *   npm run check:gate                  mint a token from a key you type
 *   npm run check:gate -- --token <t>   send a real one from a signed-in build
 *   npm run check:gate -- --print-token
 *   npm run check:gate -- --origin https://deploy-preview-1--log.netlify.app
 *
 * Two different questions, and it is worth being clear which one is being
 * asked. Minting proves the key stored on the site is byte for byte the key you
 * typed here, and nothing more: paste damage, and only paste damage. A real
 * token from a signed-in build is the one that proves the key is *Untilt's*,
 * because Untilt is what signed it.
 *
 * The token this mints names the subject `gatecheck`, so a successful run
 * writes a bucket, and the run erases it again on the way out. A token you
 * supply belongs to a person, so nothing is ever erased in that mode.
 */

import { createHmac } from 'node:crypto';

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
const printing = args.includes('--print-token');

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
          'Untilt signs with. For that, sign in on a dev build and run this again',
          'with --token and the token it stored.',
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
  const minted = token === null;

  if (minted) {
    const secret = process.env.GATE_SECRET ?? (await readSecret());
    if (!secret) {
      say('No key given, so there is nothing to check.');
      process.exit(1);
    }
    token = mint(secret);
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
