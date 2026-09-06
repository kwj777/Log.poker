/**
 * The one thing `scripts/check-gate.mjs` has to get right.
 *
 * The script exists to answer "is the key on the site the right key", and it
 * answers by minting a token and seeing whether the endpoint takes it. So a
 * script that mints the format slightly wrong reports a wrong key when the key
 * is fine, and the person reading it goes looking for a problem that is not
 * there. Worse, it can only fail in that direction, so nothing about the output
 * would ever look suspicious.
 *
 * Run rather than read: the script prints a token and `verifyToken`, the thing
 * that actually guards the endpoint, is asked whether it is a token.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe('what the gate check will never do', () => {
  const source = readFileSync(SCRIPT, 'utf8');

  it('erases only a bucket it made itself', () => {
    // A token somebody passes in names a person, and their history is not
    // this script's to tidy away. The guard is the reason the erase is safe
    // to have at all, so it is asserted rather than trusted.
    expect(source).toContain("if (answer.status === 200 && minted) {");
    expect(source.match(/send\('DELETE'/g)).toHaveLength(1);
  });

  it('and never prints the key back out', () => {
    // It is read with the echo off. Printing it into a terminal, or into
    // whatever is capturing that terminal, would undo the point of that.
    expect(source).not.toMatch(/console\.log\([^)]*secret/i);
    expect(source).not.toMatch(/say\([^)]*secret[^)]*\)/i);
  });
});
