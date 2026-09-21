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

import type { HandoffFailure } from '../../auth/handoff';
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
      // An hour, because that is the window that actually binds.
      // `CALLER_LIMIT` is 20 per `CALLER_WINDOW_MS`, which is an hour, and
      // both 429s a player can reach come from it. "Give it a minute" named a
      // wait guaranteed not to be long enough: a card room shares one address,
      // so the tenth person to sign in that hour waits a minute, is refused
      // with the same sentence, and concludes the sign-in is broken. The one
      // other 429 is the server giving up on a write race, where an hour is
      // longer than it needs and nobody is misled by being early.
      return 'That is a lot of tries. Give it an hour and ask again.';
    case 'unreachable':
      return 'Could not reach the sign-in. Check your connection and try again.';
  }
};

/**
 * One sentence for a hand-off that did not happen.
 *
 * Four outcomes with two rules between them, and both are about what these
 * lines may not say.
 *
 * **None of them is a verdict on a purchase.** Untilt answers 503 rather than
 * a free token when it cannot reach Stripe, precisely so an outage does not
 * become "you have not paid for this", and it would be thrown away here by one
 * careless line. So every one of these says what happened to the link and
 * offers the ordinary way in, which is always available and costs one screen.
 *
 * **And they name the screen it is on.** All four used to say "sign in below",
 * and they are read on `app/claim.tsx`, which renders no sign-in: `SignInCard`
 * is mounted in `app/(tabs)/settings.tsx` and nowhere else. So the one
 * instruction a stranded player got pointed at a control that was not there.
 * Settings is named here and the claim screen carries a button to it, which is
 * the pair that has to stay together.
 *
 * **And none of them says anything was bought at all**, which is the rule the
 * rest of this file already keeps: Log is free in its entirety, and what
 * arrives through a hand-off is an identity rather than an entitlement. From
 * this side it is a sign-in somebody did not have to type. What they may have
 * paid for elsewhere is the other app's to talk about.
 */
export const handoffFailed = (failure: HandoffFailure): string => {
  switch (failure) {
    case 'none':
      // Unknown, expired, already spent, or meant for another app. Untilt says
      // one thing for all of them on purpose, so this does too. Ninety seconds
      // is short, and the honest guess is that they took a while.
      return 'That link has already been used, or it has run out. Sign in from Settings and ' +
        'this device picks up where your account left off.';
    case 'refused':
      return 'There was nothing to carry across on that account. Sign in from Settings with ' +
        'the address you use for the other apps.';
    case 'throttled':
      return 'That is a lot of tries. Give it a minute, or sign in from Settings.';
    case 'unreachable':
      // The one somebody may well be reading in the middle of an outage they
      // are on the wrong side of. Carefully vague, and never a refusal.
      return 'Could not finish signing you in just now. Nothing is lost -- try the link ' +
        'again, or sign in from Settings.';
  }
};

/**
 * What a hand-off would do to a log that is already here.
 *
 * Asked rather than done, because on this side a change of subject is a change
 * of bucket: the sessions this device syncs live under whoever it is signed in
 * as, and swapping quietly would move somebody's history out from under them
 * with nothing on screen to say so. Untilt's `HANDOFF.md` makes it the
 * destination's decision for exactly that reason.
 *
 * Nothing is deleted either way, and the sentence says so: the other log is
 * still in its own bucket and signing back in brings it back.
 */
export const handoffWouldSwitch =
  'This device is already signed in as somebody else. Continuing switches it, so the ' +
  'sessions it syncs will be the other account\'s from then on. Nothing is deleted: ' +
  'signing back in brings this log back.';

/**
 * The same question, for a device signed in as nobody that has a log anyway.
 *
 * A first sign-in sends everything on the device up, from the beginning, which
 * is the point of signing in and wrong for a link somebody else sent: the
 * account at the far end is theirs. Nothing on this side can tell a link a
 * player followed from their own other app from one a friend pasted, so the
 * log is what decides, and this is what a device with something to lose is
 * asked.
 *
 * It says what goes where, because that is the part that cannot be taken back
 * from here. It does not say anything is deleted, because nothing is.
 */
export const handoffWouldAdopt =
  'This link signs this device in to the account that sent it. The sessions already on ' +
  'this device would start syncing into that account, which is worth being sure about if ' +
  'it is not yours. Nothing is deleted either way, and everything here stays here.';

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
  'Deleting your account deletes the copy on the server. That signs this device out, and leaves your log here.';

/** The step between the button and the deletion. Says what it reaches. */
export const ERASE_CONFIRM =
  'This deletes your account and the copy Log is holding for you, and signs this device out. It cannot be undone, and no device will put it back. The log on this device is untouched, and so is the one on every other device you have signed in on.';

/**
 * What clearing this device actually clears, which depends on whether it syncs.
 *
 * "This cannot be undone" was said either way, and on a signed-in device it is
 * undone immediately and by the app itself: `SyncingRepository.clearAll`
 * rewinds the cursors and starts a push of its own, so the sessions, hands,
 * rebuys, mood entries and venues are back within a round. That is deliberate
 * and documented -- reset means this device, not every device -- and the
 * sentence in front of it said the opposite.
 *
 * The starting balance is the half the old wording left out, and it is the one
 * thing the reset really does destroy for good: preferences are not in
 * `SYNC_TABLES`, so nothing anywhere holds a copy to send back.
 *
 * Two strings rather than one with a clause bolted on, because they describe
 * two different acts. On a device that does not sync this is the end of that
 * log; on one that does it is closer to a reload.
 */
export const RESET_CONFIRM =
  'Delete every session, hand, mood entry and venue on this device, and the starting balance with them. This cannot be undone.';

export const RESET_CONFIRM_SYNCING =
  'Delete every session, hand, mood entry and venue on this device. They come back from the server the next time this device syncs, which is straight away: sign out first if you want them off this device. Your starting balance does not sync, so that one goes for good.';

/**
 * The label on the button, which is a separate string for a separate reason.
 *
 * Everything above is written for the person holding the phone. This one is
 * also written for somebody reviewing the app, and the two audiences want
 * different words for the same act.
 *
 * App Review requires an in-app way to delete an account, and looks for it by
 * reading the screen. The button used to say "Erase the copy on the server",
 * which is precise and is not what a reviewer scanning Settings is looking
 * for: the words are "delete" and "account", and a control that avoids both
 * reads as an absent feature rather than a carefully named one. Log has
 * nothing to gain from being the app that hid its delete button behind better
 * vocabulary.
 *
 * It is also the more truthful of the two once you follow what is actually
 * stored. There is no account record to delete separately: `signinEndpoint.ts`
 * keeps no user table, an address is never written down, and the only thing
 * the server holds for anybody is the bucket this deletes. So deleting the
 * copy on the server *is* deleting the account, and the old label was
 * describing the implementation where this describes the act.
 */
export const DELETE_ACCOUNT = 'Delete your account and its data';

/**
 * The one sentence that says there was never an account record in the first
 * place, which is the part somebody reading a privacy policy wants and the
 * part a reviewer asking "where did the account go" needs.
 */
export const NO_ACCOUNT_KEPT =
  'Log keeps no account record beyond that copy. Your address is never stored, only a one-way fingerprint of it, so there is nothing else left to delete.';

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
