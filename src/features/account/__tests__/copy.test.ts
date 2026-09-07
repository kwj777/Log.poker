/**
 * What the sign-in is allowed to say.
 *
 * Most copy is a matter of taste and does not belong in a test. These two lines
 * are not: the endpoint behind this screen goes to real trouble to be unable to
 * tell anybody which addresses have bought, and a screen that says "check your
 * inbox" throws that away at the last step, on the client, where nobody
 * reviewing the server would ever see it.
 *
 * The card itself is not rendered here -- these tests run on plain ts-jest in
 * Node, with no React Native. What can be checked without a renderer is the
 * copy, which is where the rules are, and whether the card is wired up behind
 * the flag that keeps it out of production, which is a fact about a source
 * file. Both are checked, and neither needs a screen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SignInFailure } from '../../../auth/signin';
import { CODE_SENT, NOTHING_LEAVES, describeSession, describeSync, messageFor } from '../copy';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const FAILURES: SignInFailure[] = ['rejected', 'throttled', 'unreachable'];

describe('what it says after asking for a code', () => {
  it('does not promise that a mail was sent', () => {
    // The property the endpoint is built around, at the last place it can die.
    // 202 does not mean a mail went: the cooldown and the daily cap stop one
    // silently, and reporting that would report how much mail an address has
    // had.
    expect(CODE_SENT).toMatch(/\b(if|unless)\b/i);
    expect(CODE_SENT).not.toMatch(/check your (inbox|email)/i);
    expect(CODE_SENT).not.toMatch(/\bwe (have )?(sent|emailed)\b/i);
  });

  it('and does not send somebody away who has bought nothing', () => {
    // It said "if that address has a purchase behind it" while the family's
    // only sign-in was Untilt's, which will not mail a stranger. Log mints its
    // own now, cross-device history is free, and there is nothing to have
    // bought. This is the sentence that would quietly put the price back.
    expect(CODE_SENT).not.toMatch(/\b(purchase|purchased|bought|paid|subscription)\b/i);
  });

  it('says how long the code lasts, because the mail is not on screen', () => {
    expect(CODE_SENT).toMatch(/fifteen minutes/);
  });
});

describe('what it says when something fails', () => {
  it('has one sentence for every failure the client can return', () => {
    for (const failure of FAILURES) {
      for (const stage of ['email', 'code'] as const) {
        const said = messageFor(failure, stage);
        expect(said.length).toBeGreaterThan(10);
        expect(said).toMatch(/[.!]$/);
      }
    }
  });

  it('never guesses why a code was refused', () => {
    // The endpoint answers a wrong code and an address it has never seen
    // identically, byte for byte. Copy that told them apart would undo that.
    const said = messageFor('rejected', 'code');
    expect(said).not.toMatch(/no (account|purchase|customer)|not found|never|expired|unknown/i);
  });

  it('can be specific about an address, because that refusal says nothing', () => {
    // The send path only ever refuses an address that is not one: it answers
    // everything else the same. So this one is safe to name.
    expect(messageFor('rejected', 'email')).toMatch(/email address/);
  });

  it('reads a rate limit as a wait rather than as a wrong answer', () => {
    expect(messageFor('throttled', 'code')).toMatch(/minute|wait/i);
    expect(messageFor('throttled', 'code')).not.toMatch(/wrong|incorrect|invalid/i);
  });

  it('blames the connection for a network failure, not the person', () => {
    expect(messageFor('unreachable', 'email')).toMatch(/connection|reach/i);
  });
});

describe('what it says once somebody is signed in', () => {
  it('says what a session carries, and that it carries it for nothing', () => {
    const said = describeSession(true);
    expect(said).toMatch(/history follows you/i);
    expect(said).toMatch(/no charge/i);
    expect(said).not.toMatch(/\$\s*\d/);
  });

  it('tells the one session that cannot sync why, without inventing a price', () => {
    // The false branch used to mean "has not bought" and now means "typed a
    // shared passcode". Copy that still pointed at the other two apps would be
    // selling something that is not for sale, to somebody whose problem is
    // that their subject is not theirs.
    const said = describeSession(false);
    expect(said).toMatch(/passcode/i);
    expect(said).toMatch(/address of your own/i);
    expect(said).not.toMatch(/\$\s*\d/);
    expect(said).not.toMatch(/buy|purchase|pay|upgrade|other two/i);
  });

  it('promises nothing leaves the device either way', () => {
    expect(NOTHING_LEAVES).toMatch(/stays on this device/);
  });
});

describe('what it says about the sync itself', () => {
  const state = (over: Partial<Parameters<typeof describeSync>[0]> = {}) =>
    describeSync({ lastSyncedAt: null, pending: 0, problem: null, running: false, ...over });

  it('says nothing has synced yet before anything has', () => {
    expect(state()).toMatch(/[Nn]ot synced yet/);
  });

  it('is quiet when it worked', () => {
    expect(state({ lastSyncedAt: 1 })).toMatch(/[Uu]p to date/);
  });

  it('says nothing is lost when it could not reach the server', () => {
    // The player's whole log is on this device either way, and a failure that
    // did not say so would read as one.
    const said = state({ problem: 'unreachable', pending: 3 });
    expect(said).toMatch(/nothing is lost/);
    expect(said).toMatch(/3 changes/);
  });

  it('counts one change as one rather than as 1 changes', () => {
    expect(state({ problem: 'unreachable', pending: 1 })).toMatch(/1 change is waiting/);
  });

  it('asks for a sign-in when that is what is wrong, and does not blame the network', () => {
    const said = state({ problem: 'unauthorized' });
    expect(said).toMatch(/sign in again/);
    expect(said).not.toMatch(/connection|reach/i);
  });
});

describe('where the card is wired up', () => {
  const settings = read('app', '(tabs)', 'settings.tsx');
  const config = read('src', 'config.ts');

  it('is behind a flag rather than shipped to somebody it does nothing for', () => {
    // It unlocks nothing until sync exists, and a form that cannot succeed is
    // worse than an absence. Same treatment as the demo seeder beside it.
    expect(settings).toContain('{ALLOW_SIGN_IN ? (');
    expect(settings).toContain('<SignInCard />');
    expect(config).toContain('export const ALLOW_SIGN_IN = IS_DEV;');
  });

  it('and the flag is a build-time constant, so it is stripped rather than hidden', () => {
    expect(config).toContain('export const IS_DEV: boolean');
    expect(config).toMatch(/ALLOW_SIGN_IN = IS_DEV/);
  });

  it('signs out without touching the log', () => {
    // The one button on this card that sounds like it might delete something.
    const card = read('src', 'features', 'account', 'SignInCard.tsx');
    expect(card).toContain('signOut()');
    expect(card).not.toMatch(/clearAll|deleteSession|deleteAll/);
  });

  it('tells the data layer to compose again on both sides of a session', () => {
    // The repository was built before there was a token, so it is holding the
    // plain local one. Without this, signing in appears to work and syncs
    // nothing, which is the worst of the three possible outcomes.
    const card = read('src', 'features', 'account', 'SignInCard.tsx');
    expect([...card.matchAll(/recomposeRepository\(\)/g)]).toHaveLength(2);
  });
});
