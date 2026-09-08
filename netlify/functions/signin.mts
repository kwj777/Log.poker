/**
 * The free door: POST /api/signin and /api/signin/code.
 *
 * The thin part. It reads the key out of the environment, opens the store,
 * builds a mailer, and hands all three to `handleSignIn` in
 * `src/auth/signinEndpoint.ts`, which holds every rule and has a test suite
 * that runs it. Same split as `sync.mts`, for the same reason: a `.mts` module
 * is an ES module as far as the test runner is concerned and will not go
 * through its transform, so anything that moves back into this file is untested
 * again.
 *
 * ## Why this exists when the family already has a sign-in
 *
 * Untilt's mints the family's tokens and will not mail a code to an address
 * Stripe has no customer for. That was right while cross-device history was
 * sold and is wrong now that it is free: the front door promises that a log
 * follows you, and a door only buyers can open would make that a promise to
 * buyers. Untilt is unchanged; this is the same contract answered on
 * `log.poker`, minting the free tier for anybody who can read their mail.
 *
 * Environment (Netlify UI -> Site configuration -> Environment):
 *   GATE_SECRET      required. The same key Untilt signs tokens with, and the
 *                    same key `/api/sync` verifies against. Unset, this refuses
 *                    every request, which is the state to leave it in until
 *                    there is something to sync to.
 *   RESEND_API_KEY   required. Nothing else here sends mail.
 *   SIGNIN_FROM      optional, and currently wants leaving alone. The From
 *                    address has to be on a domain verified with Resend, and
 *                    `log.poker` is verified at the apex: DKIM is published at
 *                    `resend._domainkey.log.poker`, and the `send.log.poker`
 *                    MX and SPF records beside it are Resend's return path for
 *                    bounces rather than a sending identity of their own. So
 *                    the default below is right, and `From: signin@log.poker`
 *                    aligns with `d=log.poker` for DMARC. Setting this to
 *                    anything off that domain is what makes the mailer refuse.
 *
 * The value of `GATE_SECRET` has to be **byte for byte** what Untilt signs
 * with, because a token minted here is a family token and the other two apps
 * re-derive its signature. It is also effectively **write once**: sync buckets
 * and the subject on every token are HMACs under this key, so changing it does
 * not rotate anything, it orphans every bucket and gives everybody a new
 * identity. See `src/sync/verify.ts`.
 */

import { getStore } from '@netlify/blobs';

import { handleSignIn, type CodeStore } from '../../src/auth/signinEndpoint';

const FROM = process.env.SIGNIN_FROM || 'Log <signin@log.poker>';

/**
 * One mail, and whether it went.
 *
 * The body is deliberately dull. A sign-in code is the one mail that most
 * looks like a phishing attempt to the person receiving it, so it says what it
 * is for, says what to do if it was not them, and asks them to do nothing else:
 * no link to click, because there is nothing a link could do that the code in
 * front of them does not, and a mail that trains somebody to tap links is worse
 * than a mail that annoys them.
 */
const send = async (to: string, code: string): Promise<boolean> => {
  const key = process.env.RESEND_API_KEY || '';
  if (!key) {
    console.error('signin: refusing to mail; unset: RESEND_API_KEY');
    return false;
  }

  const text = [
    `Your Log sign-in code is ${code}`,
    '',
    'Type it into the app. It is good for fifteen minutes and works once.',
    '',
    'If you did not ask for this, nothing has happened and you can ignore it.',
    'Somebody typed your address into log.poker, which anybody can do; the code',
    'is the part only you have.',
  ].join('\n');

  try {
    const answer = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject: `Log sign-in code: ${code}`, text }),
    });
    // The status only, never the body: it echoes the address back and this is
    // a deploy log that says how many people signed in and nothing about who.
    if (!answer.ok) console.error(`signin: the mailer answered ${answer.status}`);
    return answer.ok;
  } catch {
    console.error('signin: could not reach the mailer');
    return false;
  }
};

/**
 * The store, or nothing, which is what the endpoint's 503 branch expects.
 *
 * `getStore` throws when the Blobs context is not injected rather than
 * returning null, so without this the "no blob store configured" answer that
 * path is written to give could never happen and a missing store would be an
 * unhandled exception instead.
 */
const store = (): CodeStore | null => {
  try {
    return getStore('log-signin') as unknown as CodeStore;
  } catch {
    return null;
  }
};

export default async (request: Request): Promise<Response> =>
  handleSignIn(request, {
    secret: process.env.GATE_SECRET || '',
    store,
    mail: send,
    now: Date.now,
  });

export const config = { path: ['/api/signin', '/api/signin/code', '/api/signin/renew'] };
