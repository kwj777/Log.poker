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
import {
  CODE_SENT,
  ERASE_CONFIRM,
  ERASE_DONE,
  ERASE_EXPLAINS,
  ERASE_FAILED,
  NOTHING_LEAVES,
  describeSession,
  describeSync,
  messageFor,
} from '../copy';

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

describe('and what nothing on this screen is allowed to say', () => {
  /**
   * The rule above, applied to the screen rather than to one constant.
   *
   * It was written against `CODE_SENT` because that is where the price had
   * been. It survived somewhere the check could not see and nor could anybody
   * else: the email field's `accessibilityLabel` read "the email address you
   * paid with", so the only person told that Log had been bought was somebody
   * using a screen reader. A label is not in `copy.ts`, is not on screen to be
   * read back during review, and is exactly the kind of string a rule scoped
   * to one file leaves behind.
   *
   * The account feature is the scope, and deliberately not the whole app. Log
   * is a poker app: "buy-in", "entry cost" and "fees paid" are the vocabulary
   * of the thing it records, and a word list swept across every screen would
   * match those on every run until somebody turned it off. Nothing on this
   * surface has a reason to use them, which is what makes the rule meaningful
   * exactly here.
   */
  const BOUGHT = /\b(purchase|purchased|bought|buy|paid|pay|subscription|subscriber|price|pricing|refund|billed|billing)\b/i;

  /** Comments discuss the price rule at length; only what ships is bound. */
  const shipped = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const files = ['copy.ts', 'SignInCard.tsx'];

  it.each(files)('%s says nothing about having bought Log', (file) => {
    const source = shipped(read('src', 'features', 'account', file));

    const said = [
      // Every string literal, which covers labels, hints and placeholders --
      // the ones a reviewer looking at the rendered card never sees.
      ...[...source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)].map((match) => match[2]),
      // And text sitting directly in the markup.
      ...[...source.matchAll(/>([^<>{}]{4,})</g)].map((match) => match[1]),
    ];

    // The sweep has to be finding something, or a change to how these files
    // are written turns it into a test that passes by reading nothing.
    expect(said.length).toBeGreaterThan(10);
    expect(said.filter((line) => BOUGHT.test(line))).toEqual([]);
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

  it('is on, and still behind the flag that can turn it off', () => {
    // The flag was `IS_DEV` while signing in unlocked nothing, on the argument
    // that a form which cannot succeed is worse than an absence. It is on now,
    // and the flag stays because `/api/signin` mails a code to anybody who
    // types an address and a door like that wants a switch.
    expect(settings).toContain('{ALLOW_SIGN_IN ? (');
    expect(settings).toContain('<SignInCard />');
    expect(config).toContain('export const ALLOW_SIGN_IN = true;');
    expect(config).not.toMatch(/ALLOW_SIGN_IN = IS_DEV/);
  });

  it('and the flag is a build-time constant, so turning it off strips the card', () => {
    // Which is the difference between a kill switch and a hidden feature: a
    // `false` here removes the card from the bundle rather than rendering it
    // and declining to show it.
    expect(config).toContain('export const IS_DEV: boolean');
    expect(config).toMatch(/export const ALLOW_SIGN_IN = (true|false|IS_DEV);/);
  });

  it('signs out without touching the log', () => {
    // The one button on this card that sounds like it might delete something.
    const card = read('src', 'features', 'account', 'SignInCard.tsx');
    expect(card).toContain('signOut()');
    expect(card).not.toMatch(/clearAll|deleteSession|deleteAll/);
  });

  it('tells the data layer to compose again on every side of a session', () => {
    // The repository was built before there was a token, so it is holding the
    // plain local one. Without this, signing in appears to work and syncs
    // nothing, which is the worst of the three possible outcomes.
    //
    // Three, not two: in and out, and the erase, which is also a way out.
    const card = read('src', 'features', 'account', 'SignInCard.tsx');
    expect([...card.matchAll(/recomposeRepository\(\)/g)]).toHaveLength(3);
  });
});

/**
 * Erasing, which is the one control on this card that deletes anything.
 *
 * All of it is copy and ordering, and both are the kind that fails quietly:
 * copy that promises more than the endpoint delivers, and an order that leaves
 * somebody signed out of a deletion that did not happen.
 */
describe('erasing the copy on the server', () => {
  const card = read('src', 'features', 'account', 'SignInCard.tsx');

  it('says it signs you out, before it does', () => {
    // The sign-out is part of what erasing is here, not a courtesy afterwards:
    // erasing while still signed in is a control that undoes itself on the
    // next write. Somebody should not discover that by being signed out.
    expect(ERASE_EXPLAINS).toMatch(/signs this device out/);
    expect(ERASE_CONFIRM).toMatch(/signs this device out/);
  });

  it('and says the log on this device is not what is being deleted', () => {
    expect(ERASE_CONFIRM).toMatch(/untouched/);
    expect(ERASE_DONE).toMatch(/still here/);
  });

  it('says it cannot be undone, and that nothing anywhere will put it back', () => {
    // This asserted the opposite for a day: that another signed-in device
    // would upload its copy again, so sign out there too. It will not. A
    // device pushes what changed since its own cursor, and that cursor says
    // the whole log was sent. The warning pointed at the one risk that was not
    // real, and the real one went unsaid.
    expect(ERASE_CONFIRM).toMatch(/cannot be undone/);
    expect(ERASE_CONFIRM).toMatch(/no device will put it back/);
    expect(ERASE_CONFIRM).not.toMatch(/upload it again|sign out there too/);
  });

  it('and forgets this device\u2019s cursors, or the erase is one it can undo by accident', () => {
    // `pushed` says the whole log was sent. Left alone, signing in again
    // pushes nothing and the emptied bucket stays empty while the app reports
    // that it is up to date. Fenced through the wrapper, so a sync in flight
    // cannot write the old numbers back afterwards.
    const card = read('src', 'features', 'account', 'SignInCard.tsx');
    const body = card.slice(card.indexOf('const erase = async'), card.indexOf('if (session)'));
    expect(body).toContain('forget(');
    expect(body.indexOf('forget(')).toBeLessThan(body.indexOf('await signOut()'));
  });

  it('and tells it the bucket is gone, which is what a sign-out cannot say', () => {
    // The two doors leave the server in different states, and only one of them
    // can be swept from freely afterwards. An erase leaves nothing in the
    // bucket, so this device is as free to collect its own tombstones as one
    // that never signed in. A sign-out leaves the bucket sitting there, so a
    // delete this device never managed to push is still a row the server will
    // hand back. Saying `erased` on both would sweep away those deletes; on
    // neither, a person who erases and stays signed out keeps every tombstone
    // they write from then on.
    const body = card.slice(card.indexOf('const erase = async'), card.indexOf('if (session)'));
    expect(body).toContain('forget({ erased: true })');
  });

  it('and signing out forgets them too, or the next person inherits them', () => {
    const card = read('src', 'features', 'account', 'SignInCard.tsx');
    const body = card.slice(card.indexOf('const leave = async'), card.indexOf('const erase = async'));
    expect(body).toContain('forget()');
    // And does not claim the bucket is gone, because it is not. Comments only,
    // since the slice runs up to the doc block above `erase`, which says the
    // word for its own reasons.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain('erased');
  });

  it('erases before it signs out, so a failure leaves a session to retry from', () => {
    // The other order leaves the worst outcome available: told the data is
    // gone, signed out, and unable to ask again without signing back in.
    const body = card.slice(card.indexOf('const erase = async'), card.indexOf('if (session)'));
    expect(body.indexOf('eraseRemote(token)')).toBeGreaterThan(-1);
    expect(body.indexOf('eraseRemote(token)')).toBeLessThan(body.indexOf('await signOut()'));
  });

  it('and does not sign out at all when nothing was erased', () => {
    const body = card.slice(card.indexOf('const erase = async'), card.indexOf('if (session)'));
    const bail = body.slice(body.indexOf('if (!gone)'), body.indexOf('await signOut()'));
    expect(bail).toContain('ERASE_FAILED');
    expect(bail).toContain('return;');
    expect(ERASE_FAILED).toMatch(/still signed in/);
  });

  it('asks first, rather than deleting on one tap', () => {
    expect(card).toContain('confirmingErase');
    expect(card).toContain("variant=\"danger\"");
  });
});
