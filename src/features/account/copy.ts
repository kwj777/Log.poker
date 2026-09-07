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
 * There is no number to say. Cross-device history is free, so the false branch
 * is not somebody who has not paid: it is somebody holding a shared passcode,
 * which names a door rather than a person, and the words have to say that
 * rather than imply a price.
 */
export const describeSession = (syncs: boolean): string =>
  syncs
    ? 'Signed in. Your history follows you to your other devices, at no charge.'
    : 'Signed in with a shared passcode, which is a door rather than a person. Carrying your history needs an address of your own.';
