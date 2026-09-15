/**
 * What the sign-in says, and the two sentences it must never say.
 *
 * Pure, and separate from the card that renders it, because the copy is the
 * part with rules in it. A screen can be looked at; a rule has to be asserted.
 *
 * ## It cannot say that a mail was sent
 *
 * `/api/signin` answers 202 whether or not one went. It used to be Untilt's,
 * where the reason was that an endpoint saying *no customer* is a way to ask
 * which addresses have bought. It is Log's now and nobody has to buy anything,
 * so the reason is the other one it always also had: the rate limits stop a
 * mail to an address that has just had one, and an endpoint that reported that
 * would report how much mail any address has been sent.
 *
 * Either way the property dies here if this screen says "check your inbox" as
 * though a mail were certainly on its way. So the confirmation is conditional,
 * in plain words, and there is a test that it stays that way.
 *
 * ## It cannot say what went wrong with a code
 *
 * Same reason, one level down. The endpoint answers a wrong code and an
 * address it has never seen identically, byte for byte. Copy that guessed
 * between them would undo that at the last step.
 */

import type { SignInFailure } from '../../auth/signin';
import { hasOwnSubject, SYNC_NEEDS_PASS, type Claim } from '../../auth/token';

/** Which half of the flow is on screen. The same failure reads differently. */
export type Stage = 'email' | 'code';

/**
 * What to say after a code has been asked for.
 *
 * Conditional on purpose, and the condition is the whole point: nothing here
 * has been told whether a mail went, and saying otherwise would make this
 * screen the disclosure the endpoint refuses to be.
 *
 * **It used to name a purchase**, back when the only sign-in in the family was
 * Untilt's and that one will not mail an address Stripe has never seen. Log
 * mints its own tokens now and anybody may sign in, so a sentence about having
 * bought would be turning people away from a door that is open to them.
 */
export const CODE_SENT =
  'A code is on its way, unless one has just gone to that address. Either way, a code is good for fifteen minutes.';

/** Said under the fields, both halves. Signing in does not move anybody's log. */
export const NOTHING_LEAVES =
  'Your log stays on this device either way. Signing in is only how it will reach your other ones.';

const REJECTED: Record<Stage, string> = {
  // The only way the send path refuses is an address that is not one: it
  // answers everything else the same. So this can be specific without
  // telling anybody anything.
  email: 'That does not look like an email address.',
  // And this one cannot be specific, because the endpoint it is reporting
  // deliberately cannot tell a wrong code from an address it has never seen.
  code: 'That code was not accepted. Check it and try again.',
};

/**
 * One sentence for a failure, in the voice of the half it happened in.
 *
 * Every network failure collapses into one line for the same reason the client
 * collapses them into one reason: somebody staring at a form can do nothing
 * different about a timeout than about a socket closing.
 */
export const messageFor = (failure: SignInFailure, stage: Stage): string => {
  switch (failure) {
    case 'rejected':
      return REJECTED[stage];
    case 'throttled':
      return 'That is a lot of tries. Give it a minute and ask again.';
    case 'unreachable':
      return 'Could not reach the sign-in. Check your connection and try again.';
  }
};

/**
 * What the sync is doing, in one line and without a spinner.
 *
 * A sync that fails silently is worse than no sync, because the player goes on
 * believing their laptop has tonight on it. So the failure is the loud case
 * here and the success is the quiet one, and the failure always says that
 * nothing was lost, because nothing is: it is all still on this device.
 */
export const describeSync = (state: {
  lastSyncedAt: number | null;
  pending: number;
  problem: string | null;
  running: boolean;
}): string => {
  if (state.problem === 'unauthorized') {
    return 'Sync has stopped: this device needs to sign in again.';
  }
  // Its own line, because the one above it is advice and this one is not:
  // signing in again is exactly what will not help, and sending somebody round
  // that loop is worse than telling them the truth.
  if (state.problem === 'unpaid') {
    return 'Carrying your history between devices is part of the pass. Everything you have logged is still on this device.';
  }
  if (state.problem !== null) {
    const waiting = state.pending === 1 ? '1 change is' : `${state.pending} changes are`;
    return `Could not reach the sync. ${waiting} waiting, and nothing is lost.`;
  }
  if (state.running) return 'Syncing.';
  if (state.lastSyncedAt === null) return 'Not synced yet.';
  return 'Up to date on this device.';
};

/**
 * What a held session is worth, said without a number or a SKU.
 *
 * There is still no number to say, and now there are two false branches rather
 * than one. A subject that is not this person's has nothing to do with money
 * and must never be shown a price. A tier that has not bought has, and is told
 * so in words rather than in a figure: the price lives in the family document
 * and in whichever app is selling, and repeating it here is one more place for
 * it to rot.
 *
 * **It also does not say which reason it is**, and that is deliberate rather
 * than vague. There are two now. A shared passcode names a door rather than a
 * person, so it has no bucket by design. And once the family shares a token
 * store, a sign-in made at one of the other apps can arrive here naming a
 * subject this one will not sync with, on a device that never visited this
 * door. Naming the passcode was right while it was the only way in and would
 * be a plain lie to the second person, who has not typed one. What both have
 * in common is the only thing worth saying: no history of their own here yet,
 * and the way to start one. See SYNC.md, "One identity for three apps".
 */
export const describeSession = (session: { claim: Claim; syncs: boolean }): string => {
  if (session.syncs) {
    // "At no charge" is a promise, so it is made only while it is true. With
    // sync in the pass a signed-in syncing device has paid, and telling them
    // it costs nothing is the kind of small lie that makes the rest suspect.
    return SYNC_NEEDS_PASS
      ? 'Signed in. Your history follows you to your other devices.'
      : 'Signed in. Your history follows you to your other devices, at no charge.';
  }
  // The second reason, and it only exists once sync is in the pass: the
  // subject is genuinely theirs, and the tier is not. Naming the pass here is
  // the one place the app says there is something to buy, and it says what
  // stays free in the same breath, because all of it does.
  if (hasOwnSubject(session.claim)) {
    return 'Signed in. Carrying your history between devices is part of the pass. Everything else here is free and stays that way.';
  }
  return 'This sign-in does not carry a history of its own. Carrying yours between devices needs signing in here with an address of your own.';
};

/* --------------------------------------------------------------- erasing */

/**
 * The three sentences the erase has to say, and the one it must not leave out.
 *
 * ## Why it signs out, and why that is not a detail
 *
 * `eraseRemote` deletes the bucket and nothing else. Erasing it while still
 * signed in is a control that undoes itself: the next session logged on this
 * device pushes the whole local history straight back up, and the person is
 * left believing something was deleted that is sitting there again. So the
 * sign-out is part of what erasing *is* here, not a courtesy afterwards, and
 * the copy says so before it happens rather than surprising somebody with it.
 *
 * ## And why it names the other devices
 *
 * Nothing here can reach into somebody's other phone, and there is no honest
 * way to promise otherwise from this screen.
 *
 * **This paragraph used to say the opposite of what happens, and so did the
 * sentence it justified.** It warned that another signed-in device would put
 * its copy back within a session or two. It will not: a device pushes what
 * changed since its own `pushed` cursor, and that cursor already says the
 * whole log was sent. So the erase is permanent everywhere, and the warning
 * was pointing at the one risk that was not real while the real one -- that
 * nothing anywhere can undo this -- went unsaid.
 *
 * What another device does hold is its own local log, which is untouched and
 * is not a copy of the server's. It goes back up only if that device is signed
 * out and in again, which forgets its cursors the same way this does.
 */
export const ERASE_EXPLAINS =
  'You can also erase the copy on the server. That signs this device out, and leaves your log here.';

/** The step between the button and the deletion. Says what it reaches. */
export const ERASE_CONFIRM =
  'This deletes the copy Log is holding for you and signs this device out. It cannot be undone, and no device will put it back. The log on this device is untouched, and so is the one on every other device you have signed in on.';

/**
 * What to say when it did not happen.
 *
 * The important half is the second sentence. A failed erase that left somebody
 * signed out would be the worst outcome available: told their data was gone,
 * signed out, and no longer able to ask again without signing back in. So the
 * sign-out only happens once the deletion has, and this says which side of that
 * line the failure fell on.
 */
export const ERASE_FAILED =
  'Could not reach the server, so nothing was erased and you are still signed in. Try again in a moment.';

/** And when it did. Read on the signed-out card, which is where it lands. */
export const ERASE_DONE =
  'Erased, and this device is signed out. Your log is still here, and signing in again would start carrying it across from scratch.';
