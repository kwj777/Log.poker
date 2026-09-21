/**
 * The local repository, with a sync bolted to the side of it.
 *
 * Every method delegates. Reads answer from the local database and writes
 * commit to it and **return before the network is touched**, which is the whole
 * design: a card room has no wifi, that is the normal case rather than the
 * degraded one, and an app that waited on a request to record a rebuy would be
 * unusable exactly where it is used.
 *
 * What this adds is a mark. Any method that changed something sets a flag, and
 * a push happens after, on its own. Nothing above `src/data/index.ts` knows any
 * of this exists: it satisfies `Repository`, so no screen changes and no
 * feature folder is touched.
 *
 * ## The cursor
 *
 * The last stamp the server gave this device, echoed back untouched. It is the
 * server's number and this side never reads it. Kept beside the token rather
 * than in the database, because it is a fact about this device's conversation
 * with the server and not part of the log: `clearAll` wipes the log and the
 * cursor has to survive that, or a reset device would re-pull nothing and sit
 * there looking empty.
 *
 * ## What it does not do
 *
 * It does not resolve anything. The server merges; this sends what changed and
 * applies what comes back. A device that has been in a drawer for a month has a
 * month-old view of the world and possibly a wrong clock, and the fewer
 * decisions it makes the fewer ways two devices have of never converging.
 */

import { readClaim } from '../auth/token';
import type { Timestamp } from '../domain/types';
import { batchFor } from '../sync/batch';
import { backoffMs, sync, type SyncOptions } from '../sync/client';
import { SYNC_TABLES, countChanges, isEmptyChangeSet, type SyncFailure } from '../sync/protocol';
import { TOMBSTONE_RETENTION_MS } from './repository';
import type {
  ChangeSet,
  HandPatch,
  Repository,
  SessionFilter,
  SessionPatch,
  VenuePatch,
} from './repository';

/**
 * Two cursors, because one cannot do both jobs, and they are not even in the
 * same units.
 *
 * `pulled` is the server's own stamp, handed back untouched and never read
 * here. `pushed` is a local `updatedAt`, off this device's clock, marking the
 * newest record it has actually sent. Collapsing them would lose data twice
 * over: the server's stamp moves past records this device wrote and never sent,
 * so the next push would skip them, and a local stamp means nothing at all to
 * the server's answer.
 *
 * So one tracks the conversation in each direction, and neither is ever asked
 * about the other's.
 */
export interface Cursors {
  /** The server's stamp, opaque here. Sent back as `since`. */
  pulled: Timestamp;
  /** The newest local `updatedAt` this device has sent. Its own clock. */
  pushed: Timestamp;
  /**
   * This install's own id, invented once and kept.
   *
   * The server needs to know whether anybody is still waiting to see a
   * tombstone before it collects it, and "anybody" has to be countable. It is
   * worth no more than knowing two requests came from one place, which is
   * already obvious from them carrying the same token.
   */
  device: string;
  /**
   * The newest local moment before which the server has heard everything.
   *
   * `pushed` says that while a session lasts, and signing out throws it away
   * on purpose: the next person on this device must not inherit a place in
   * somebody else's conversation. This is what is kept instead, and it is a
   * different kind of fact. Not where this device had got to, which is
   * account-shaped and dangerous to hand on, but how far back it is safe to
   * collect a tombstone, which is a property of the local database that every
   * account on this device shares anyway.
   *
   * Zero means the server has never heard anything from here, which is both
   * the state of a device that has never synced and the state of one whose
   * bucket has just been erased. Both are free to collect on the window alone,
   * because there is nothing anywhere to send a deleted row back.
   */
  settled: Timestamp;
  /**
   * Which bucket these cursors are a conversation with, or null if unknown.
   *
   * Null means a record written before this field existed, not a device that
   * has never synced: a fresh one has zeroes in the numbers above and nothing
   * to be wrong about. See `settle`.
   */
  subject: string | null;
}

/**
 * How long a foreground has to have been away to be worth a request.
 *
 * Long enough that moving between two tabs costs nothing, short enough that
 * picking the phone up at the table and looking at the laptop is a fresh
 * answer rather than a stale one.
 */
const RESUME_THROTTLE_MS = 30_000;

/** Where the cursors live. Small enough that anything durable will do. */
export interface CursorStore {
  read(): Promise<Cursors>;
  write(cursors: Cursors): Promise<void>;
}

export const memoryCursorStore = (
  start: Cursors = {
    pulled: 0,
    pushed: 0,
    device: 'test-device-0001',
    settled: 0,
    subject: null,
  },
): CursorStore => {
  let held = start;
  return {
    read: async () => held,
    write: async (cursors) => {
      held = cursors;
    },
  };
};

/**
 * What the wrapper needs beyond the client's own options.
 *
 * The budget is the size of one push, and it exists as a knob only so a test
 * can meet it with six records instead of six thousand. Nothing sets it.
 */
export interface SyncingOptions extends SyncOptions {
  budget?: number;
}

export interface SyncState {
  /** When the last sync succeeded, or null if none has. */
  lastSyncedAt: Timestamp | null;
  /** Records waiting to go up. Zero does not mean "in sync", it means "sent". */
  pending: number;
  /** Why the last attempt failed, or null. Shown in Settings, nowhere else. */
  problem: SyncFailure | null;
  /** True while a request is in flight. */
  running: boolean;
  /**
   * How many answers have changed the local database.
   *
   * Not for showing. It is a number that goes up so that anything reading the
   * log can tell that it has moved underneath them, and it is here rather than
   * on a signal of its own because there is already one subscription and two
   * would be two to keep wired.
   *
   * Nothing was told before this existed. A pull writes rows straight into the
   * local database, the store above holds the arrays the screens render, and
   * the two never spoke: the history somebody signed in for arrived, sat
   * there, and did not appear until the app was restarted. On the one screen
   * where that is most likely to be noticed, the dashboard of a device that
   * has just been signed in on, it looks exactly like sync not working.
   */
  applied: number;
}

export class SyncingRepository implements Repository {
  private readonly local: Repository;
  private readonly token: () => Promise<string | null>;
  private readonly cursors: CursorStore;
  private readonly options: SyncingOptions;
  private readonly clock: () => Timestamp;

  /** Set by every write. Cleared only once the server has taken the change. */
  private dirty = true;
  /**
   * Bumped by `clearAll`, so a request already in flight cannot land after it.
   *
   * A reset is the one thing that invalidates an answer already asked for. The
   * run would apply rows into a database that was just emptied, and then write
   * back the cursors it read before the reset, which is much the worse half:
   * the device would believe it had seen everything, and sit there empty and
   * convinced, exactly the state the reset is documented as avoiding.
   */
  private epoch = 0;
  private failures = 0;
  private nextAttemptAt = 0;
  /** When `resume` last let a sync through. See `resume`. */
  private lastResumeAt = 0;
  /**
   * Set once the token has stopped meaning anything, and never cleared here.
   *
   * A flag rather than a backoff far in the future, because a backoff is an
   * instant on a clock this device can move and this is not a wait: somebody
   * has to sign in again, and signing in composes a new repository.
   */
  private halted = false;
  private inFlight: Promise<void> | null = null;
  private state: SyncState = {
    lastSyncedAt: null,
    pending: 0,
    problem: null,
    running: false,
    applied: 0,
  };
  private listeners = new Set<(state: SyncState) => void>();
  private applied = 0;

  /**
   * A string, or somewhere to ask for one.
   *
   * A string was all this took, and it was captured once when the wrapper was
   * built. That is fine for as long as the token does not change, and it
   * changes: `renewIfDue` writes a fresh one to the store beside this at
   * launch, and this went on sending the one it was handed. On a process that
   * outlives thirty days -- a browser tab left open, which is the ordinary way
   * to use the web build -- the captured token expires, the endpoint answers
   * 401, `halted` latches, and sync stops for good while the token sitting in
   * the store is perfectly valid. Nothing on screen would say why.
   *
   * Asked per request instead, so a renewal is picked up by the next sync and
   * a sign-out is too. Still accepts a plain string, because a test that means
   * "this token, always" should be able to say that.
   */
  constructor(
    local: Repository,
    token: string | (() => Promise<string | null>),
    cursors: CursorStore = memoryCursorStore(),
    options: SyncingOptions = {},
    clock: () => Timestamp = Date.now,
  ) {
    this.local = local;
    this.token = typeof token === 'string' ? async () => token : token;
    this.cursors = cursors;
    this.options = options;
    this.clock = clock;
  }

  /* ------------------------------------------------------------- the sync */

  /** Settings reads this. Nothing else in the app does. */
  current(): SyncState {
    return { ...this.state };
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private announce(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.current());
  }

  /**
   * Push what changed and apply what comes back.
   *
   * Safe to call at any time and from anywhere: a second call while one is in
   * flight joins the first rather than starting a race, and a call inside the
   * backoff window returns without touching the network. Both matter because
   * the caller is every write in the app.
   */
  async push(force = false): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      // A run lets go of its flag one microtask after it decides to stop, and a
      // write can land in that gap: it sets `dirty`, calls here, joins a run
      // that has already decided there is nothing more to send, and is never
      // sent by anything. Settings then says nothing is waiting, and the write
      // reaches the other device only when the player happens to type something
      // else. So a joiner asks again rather than taking the answer.
      //
      // **Not covered by a test.** The window is one microtask wide and needs a
      // local write to resolve inside it; two attempts at a reproduction passed
      // against the unfixed code, which makes them worse than nothing. The fix
      // is here because it is three lines and cannot make anything worse, not
      // because it was demonstrated.
      if (!this.dirty) return;
      if (this.inFlight) return this.inFlight;
    }
    if (this.halted) return;
    if (!force && !this.dirty && this.state.lastSyncedAt !== null) return;
    if (!force && this.waiting()) return;

    this.inFlight = (async () => {
      // Around again while writes keep landing. Joining an in-flight run is
      // not the same as being sent by it: a write that arrives after this run
      // read its changes has to go in the next one, or it waits for a change
      // that may never come. Bounded, so a pathological write rate cannot spin
      // here; the next write's own push picks up whatever is left.
      let rounds = 0;
      do {
        await this.attempt();
        rounds += 1;
      } while (this.dirty && this.state.problem === null && rounds < 5);
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /**
   * Sync because the app came back to the front.
   *
   * Every other sync in this app is the tail of a local write, and one is the
   * tail of a launch. Between them they miss the case the feature exists for:
   * **the device that is reading rather than writing.** A laptop with the tab
   * open took its answer at launch and then sat on it for as long as the tab
   * lived, so a session logged on the phone at the table reached it when the
   * browser was restarted and not before. Backgrounding the native app and
   * coming back was the same nothing. What that looks like from the outside is
   * not "sync is a little behind", it is "sync does not work".
   *
   * `push(true)` rather than `push()`, because a device that is only reading
   * is never dirty and the plain call returns without asking anything after
   * its first success. The two guards `force` lifts are not wanted equally,
   * though, so the one worth keeping is applied here instead:
   *
   * **The backoff stays.** It is what stands between a server that is down and
   * every device pointed at it, and coming to the front is not a reason to
   * skip it. Somebody moving between two tabs generates the same event as
   * somebody coming back after a day, and a request per switch is exactly the
   * traffic the window exists to shed.
   *
   * **The throttle is the other half of that**, and it applies to the runs that
   * succeed, which no backoff ever slows down. Alt-tabbing is ordinary
   * behavior; a full request each way is not.
   *
   * A clock that has moved backwards reads as a long enough wait rather than an
   * impossible one, on the same reasoning as `waiting()`: a negative gap is a
   * device that has just corrected its date, and the answer to that is to sync,
   * not to sit out the size of the jump.
   */
  async resume(): Promise<void> {
    if (this.halted) return;
    if (this.waiting()) return;

    const at = this.clock();
    const since = at - this.lastResumeAt;
    if (since >= 0 && since < RESUME_THROTTLE_MS) return;

    this.lastResumeAt = at;
    await this.push(true);
  }

  /**
   * Whether the backoff window is still open.
   *
   * The window is an instant on a clock that can move. A phone that steps its
   * date backwards -- which is what a phone does when it finds the network
   * after being wrong -- would otherwise sit out the whole size of the jump
   * with no way to notice, so a wait longer than the longest backoff there is
   * cannot be a real one.
   */
  private waiting(): boolean {
    const left = this.nextAttemptAt - this.clock();
    return left > 0 && left <= backoffMs(this.failures);
  }

  /**
   * One round, and never a throw that takes the loop with it.
   *
   * `run` clears the dirty flag before it reads anything, so a throw after that
   * point loses the write it was clearing for, records no failure, arms no
   * backoff, and leaves the state saying a sync is in progress. The local
   * database can throw: it is a real database, on a real disk, applying records
   * another device wrote. Treated as the failure it is, so the loop retries it
   * on the same terms as a dead network.
   */
  private async attempt(): Promise<void> {
    try {
      await this.run();
    } catch {
      this.dirty = true;
      this.failures += 1;
      this.nextAttemptAt = this.clock() + backoffMs(this.failures);
      this.announce({ running: false, problem: 'unreachable' });
    }
  }

  /**
   * Cursors that are about the bucket this token names, and not another one.
   *
   * A cursor is a place in one conversation, and nothing recorded which
   * conversation. `pushed` says everything up to it has been sent; point the
   * same device at a different bucket and it goes on saying so, so the new
   * bucket is never sent anything and the app reports it as up to date.
   *
   * Signing out is not how that happens, because `forget` rewinds. The way in
   * is an expiry: `SessionManager.current` clears a token that has run out, on
   * its own, with no card on screen and nothing calling `forget`. So the
   * cursors outlive the session, and the next sign-in on that device inherits
   * them. If it is the same address it is the same bucket and they are right.
   * If it is a different one -- a second person on a shared device, or the same
   * person after the family's other door stopped being accepted -- they are a
   * conversation with somewhere else.
   *
   * Two cases, and neither is a failure worth stopping for:
   *
   * **A different subject.** Back to the start of the conversation, keeping
   * `settled` at the high-water mark so a tombstone that was safe to collect
   * stays safe. The pull cursor goes too, though the server would clamp it
   * anyway: a bundle refuses a cursor from a device it has never answered.
   *
   * **No subject at all**, which is every install on the day this ships. It
   * cannot be known whether those cursors are about this bucket, so the push
   * cursor is rewound and the pull cursor is not. That costs one re-push per
   * install, once, which the merge absorbs as a no-op because it is idempotent
   * and commutative, and it is the direction that cannot lose anything. Not
   * rewinding would freeze anybody already in the broken state there for good.
   */
  private async settle(cursors: Cursors, token: string): Promise<Cursors> {
    const speaking = readClaim(token, this.clock())?.subject ?? null;
    // Nothing to compare against: an expired or unreadable token is the
    // server's to refuse, and guessing from it would rewind on every launch
    // past the thirtieth day.
    if (speaking === null || cursors.subject === speaking) return cursors;

    const settled =
      cursors.subject === null
        ? { ...cursors, pushed: 0, subject: speaking }
        : {
            ...cursors,
            pulled: 0,
            pushed: 0,
            settled: Math.max(cursors.settled, cursors.pushed),
            subject: speaking,
          };
    await this.cursors.write(settled);
    return settled;
  }

  private async run(): Promise<void> {
    this.announce({ running: true });

    // Cleared before anything is read, not after. A write that lands from here
    // on sets it again and is sent by the next round; clearing afterwards would
    // swallow exactly those writes.
    this.dirty = false;
    const epoch = this.epoch;
    const startedAt = this.clock();

    // Read before the cursors rather than after them, because which bucket this
    // token names decides whether those cursors mean anything. Read now rather
    // than when this wrapper was built; see the constructor.
    //
    // It also means a run with nobody to sync for touches the database not at
    // all, where it used to read every change since the mark and announce a
    // backlog first.
    const token = await this.token();
    if (token === null) {
      // No token to sync with. Not a failure to back off from and not a thing
      // to retry: nothing here can produce one, so the loop stops until
      // somebody signs in.
      //
      // **Said as `unauthorized`, which is what it is.** This read `problem:
      // null`, and a null problem is what `describeSync` treats as nothing
      // wrong: with `lastSyncedAt` still holding the last success it printed
      // "Up to date on this device." over a sync that had stopped for the life
      // of the process. The branch called that state signed out, and for a
      // sign-out it is invisible anyway, because the card only draws this line
      // while it is holding a session. The state it is actually reached in is
      // the other one: `SessionManager.current` clears a token that has run
      // out, so a tab left open past the thirty days -- which the constructor
      // above names as the ordinary way to use the web build -- lands here
      // with a card still on screen saying everything is fine.
      //
      // `unauthorized` is the same answer the 401 path gives two dozen lines
      // down for the same situation, and the copy behind it is the one that
      // says the thing a player can act on.
      this.halted = true;
      this.announce({ running: false, problem: 'unauthorized' });
      return;
    }

    const cursors = await this.settle(await this.cursors.read(), token);
    // The floor is the mark and nothing else. It was briefly
    // `Math.min(pushed, startedAt)`, which is the clock, and a floor at the
    // clock excludes everything written before the clock: a device whose mark
    // sat above its own time -- which is every device that has pulled a record
    // from a device running a few minutes ahead -- read from *now* and so sent
    // nothing it had written since the last sync, on every sync, while
    // reporting each one a success. The case that clamp was for is handled
    // where it belongs, on the mark itself: see the write below.
    //
    // One millisecond back, for the reason the pull side reads `>=`: a record
    // written in the very millisecond of the last one sent is otherwise never
    // sent at all, and a venue and the session started on it are routinely the
    // same millisecond.
    const floor = cursors.pushed;
    const pending = await this.local.listChangedSince(floor <= 0 ? 0 : floor - 1);
    // What is waiting, not what is going: a backlog too big for one request is
    // still a backlog, and reporting the batch would show zero left with years
    // of it still here.
    this.announce({ pending: countChanges(pending) });

    // Split when it has to be, which for every ordinary sync it does not.
    // See `batchFor`: a first push with years behind it is over the endpoint's
    // cap, and an oversized body is refused rather than trimmed.
    const batch = batchFor(pending, floor, this.options.budget);
    if (batch.more) this.dirty = true;

    const outcome = await sync(
      { since: cursors.pulled, changes: batch.changes, device: cursors.device },
      token,
      this.options,
    );

    if (!outcome.ok) {
      this.dirty = true;
      this.failures += 1;
      // An unauthorized answer is not a thing waiting fixes. Somebody has to
      // sign in again, so the loop stops rather than spending a battery.
      if (outcome.reason === 'unauthorized') this.halted = true;
      else this.nextAttemptAt = this.clock() + backoffMs(this.failures);
      this.announce({ running: false, problem: outcome.reason });
      return;
    }

    // Nothing below may land if a reset happened while this was in flight: the
    // answer is about a log that no longer exists. Twice, because
    // `applyChanges` yields and the reset can arrive inside it, and because the
    // two halves fail differently. Applying would put rows back into a database
    // the player just emptied. Writing the cursor is the worse one: the device
    // would believe it had seen everything, and sit there empty and convinced,
    // which is the exact state `clearAll` is documented as avoiding.
    //
    // Dropped whole rather than merged: `clearAll` has already set the flag
    // that brings the next round straight back here with the cursors it wrote.
    if (epoch !== this.epoch) {
      this.announce({ running: false, problem: null });
      return;
    }

    // What came down, which counts as pushed: it is on the server by
    // definition. `applyChanges` stores an incoming record under the stamp the
    // device that wrote it chose, so without this every record just pulled sits
    // above the mark and is sent straight back up on the next round. On a
    // device that has just taken years of somebody's history, the first note
    // they type uploads all of it again.
    //
    // Capped at the moment this round began, so a write made during the request
    // is still below the mark and still goes next time. Everything at or below
    // that moment has been sent already: it was either in this round's changes
    // or under the floor they were read from.
    let applied = 0;
    for (const table of SYNC_TABLES) {
      for (const change of outcome.response.changes[table]) {
        if (change.record.updatedAt > applied) applied = change.record.updatedAt;
      }
    }

    // The answer was cut too, so come straight back for the rest. A first pull
    // of years of history is the one that does not fit, and it is the one the
    // feature exists for.
    if (outcome.response.more === true) this.dirty = true;

    if (!isEmptyChangeSet(outcome.response.changes)) {
      await this.local.applyChanges(outcome.response.changes);
      // Counted here rather than after the fence below, because the rows are
      // in the local database either way and what reads them has to know. A
      // run that is fenced still applied what it applied.
      this.applied += 1;
    }

    if (epoch !== this.epoch) {
      this.announce({ running: false, problem: null, applied: this.applied });
      return;
    }

    // Never above this device's own clock, which is the one way a mark can
    // silence a device for good: a phone with next year's date pushes a record
    // stamped next year, and once the date is corrected every later write is
    // below the mark and nothing is ever read again. Capping here rather than
    // at the floor costs re-sending whatever sits above the clock on each sync
    // until real time passes it, and re-sending is free.
    //
    // The applied mark is only safe on a whole push. With a batch held back, it
    // can sit above records this round did not send, and the mark would step
    // over them for good.
    const reached = batch.more ? batch.sent : Math.max(batch.sent, applied);
    await this.cursors.write({
      ...cursors,
      pulled: outcome.response.cursor,
      pushed: Math.min(reached, startedAt),
    });

    // Collect what the server has, and never more. Its line is drawn from every
    // device it has heard from; this one only knows about itself, and guessing
    // wider would drop a tombstone that had not reached the others yet.
    //
    // Floored at this device's own window, because the two numbers are on two
    // clocks: the server draws its line in the stamps it issued, and this
    // compares it against `deleted_at`, which came off whichever phone did the
    // deleting. The floor costs nothing when the clocks agree and bounds the
    // one case that hurts, a tombstone this device has never managed to push
    // being swept before it goes anywhere.
    // And never at all on a round that held records back. The sweep deletes by
    // `deletedAt` while the batch cuts by `updatedAt`, so a tombstone above the
    // time cut was not in this body and is still older than the line: swept
    // here, the delete is destroyed before it was ever offered to the server,
    // and the row comes back down on the next pull. The same hazard the mark
    // two blocks up is guarded against, on the half that was not.
    const line = Math.min(
      outcome.response.collectedThrough,
      this.clock() - TOMBSTONE_RETENTION_MS,
    );
    if (!batch.more && line > 0) await this.local.collectTombstones(line);

    this.failures = 0;
    this.nextAttemptAt = 0;
    this.announce({
      running: false,
      problem: null,
      // What is still waiting, which on a round that held records back is not
      // zero. The loop comes round again while it can, and each round
      // overwrites this with the truth, so the lie only ever showed on the
      // round the loop stopped on -- which is the one a player reads: a backlog
      // above five rounds ended here reporting a sync that had just succeeded
      // with nothing left to send, and thousands of records still here.
      pending: batch.more ? countChanges(pending) - countChanges(batch.changes) : 0,
      lastSyncedAt: this.clock(),
      applied: this.applied,
    });
  }

  /** Marks the log changed and lets the push happen on its own. */
  private touched<T>(result: T): T {
    this.dirty = true;
    void this.push().catch(() => {
      // A background sync that throws is not the caller's problem: the write
      // it followed has already committed locally, which is what was asked for.
    });
    return result;
  }

  /* ------------------------------------------------------- the delegation */

  init(): Promise<void> {
    return this.local.init();
  }

  listChangedSince(since: Timestamp): Promise<ChangeSet> {
    return this.local.listChangedSince(since);
  }

  applyChanges(changes: ChangeSet): Promise<void> {
    return this.local.applyChanges(changes);
  }

  collectTombstones(before: Timestamp): Promise<number> {
    return this.local.collectTombstones(before);
  }

  listVenues() {
    return this.local.listVenues();
  }
  getVenue(id: string) {
    return this.local.getVenue(id);
  }
  async createVenue(input: Parameters<Repository['createVenue']>[0]) {
    return this.touched(await this.local.createVenue(input));
  }
  async updateVenue(id: string, patch: VenuePatch) {
    return this.touched(await this.local.updateVenue(id, patch));
  }
  async deleteVenue(id: string) {
    return this.touched(await this.local.deleteVenue(id));
  }

  listSessions(filter?: SessionFilter) {
    return this.local.listSessions(filter);
  }
  getSession(id: string) {
    return this.local.getSession(id);
  }
  getActiveSession() {
    return this.local.getActiveSession();
  }
  async createSession(input: Parameters<Repository['createSession']>[0]) {
    return this.touched(await this.local.createSession(input));
  }
  async createSessions(inputs: Parameters<Repository['createSessions']>[0]) {
    return this.touched(await this.local.createSessions(inputs));
  }
  listImportKeys() {
    return this.local.listImportKeys();
  }
  async updateSession(id: string, patch: SessionPatch) {
    return this.touched(await this.local.updateSession(id, patch));
  }
  async endSession(id: string, cashOut: number, endedAt: Timestamp) {
    return this.touched(await this.local.endSession(id, cashOut, endedAt));
  }
  async deleteSession(id: string) {
    return this.touched(await this.local.deleteSession(id));
  }

  listRebuys(sessionId: string) {
    return this.local.listRebuys(sessionId);
  }
  async addRebuy(input: Parameters<Repository['addRebuy']>[0]) {
    return this.touched(await this.local.addRebuy(input));
  }
  async deleteRebuy(id: string) {
    return this.touched(await this.local.deleteRebuy(id));
  }

  listHands(sessionId?: string) {
    return this.local.listHands(sessionId);
  }
  countHands() {
    return this.local.countHands();
  }
  getHand(id: string) {
    return this.local.getHand(id);
  }
  async createHand(input: Parameters<Repository['createHand']>[0]) {
    return this.touched(await this.local.createHand(input));
  }
  async updateHand(id: string, patch: HandPatch) {
    return this.touched(await this.local.updateHand(id, patch));
  }
  async deleteHand(id: string) {
    return this.touched(await this.local.deleteHand(id));
  }

  listMoodEntries(sessionId?: string) {
    return this.local.listMoodEntries(sessionId);
  }
  async createMoodEntry(input: Parameters<Repository['createMoodEntry']>[0]) {
    return this.touched(await this.local.createMoodEntry(input));
  }
  async deleteMoodEntry(id: string) {
    return this.touched(await this.local.deleteMoodEntry(id));
  }

  /**
   * Straight through, and deliberately not `touched`.
   *
   * Preferences do not sync: they are not in `SYNC_TABLES`, there is no bundle
   * entry for them and no tombstone. Marking the log dirty for one would push
   * nothing and cost a round trip. See `Preferences` for what that trade buys
   * and what it costs.
   */
  getPreferences() {
    return this.local.getPreferences();
  }
  setPreferences(patch: Parameters<Repository['setPreferences']>[0]) {
    return this.local.setPreferences(patch);
  }

  /**
   * Back to the beginning of the conversation, keeping the device id.
   *
   * The id survives, because forgetting it would make this device look like a
   * new one to the server and hold up collection for a whole retention window
   * under a name nobody will ever use again.
   *
   * So does `settled`, for the opposite reason: it is not part of the
   * conversation at all. `clearAll` comes through here too, and an emptied
   * local database has no tombstones to be wrong about.
   */
  private async rewind(settled?: Timestamp): Promise<void> {
    const held = await this.cursors.read();
    await this.cursors.write({
      pulled: 0,
      pushed: 0,
      device: held.device,
      settled: settled ?? held.settled,
      // Kept, so a rewind is not mistaken for a change of bucket. `forget` is
      // already the honest way to start a conversation over; `settle` is for
      // the one nobody announced.
      subject: held.subject,
    });
  }

  /**
   * Stop, and forget where this device had got to with the server.
   *
   * For the two moments the app deliberately puts a token down: signing out,
   * and erasing the copy on the server. Both used to leave the cursors exactly
   * where they were, and `cursorStore`'s own header has always claimed the
   * opposite -- *"it has to be forgotten at the same moment the token is"* --
   * so this is the line that makes the comment true.
   *
   * Leaving them was not tidy-up left undone. It was silent data loss twice
   * over.
   *
   * **After an erase**, `pushed` still said the whole log had been sent. So
   * signing in again pushed nothing, the emptied bucket stayed empty, and the
   * history was gone from sync for good while the app went on reporting *up to
   * date*. That is the opposite of what the erase copy promised, which was
   * that a device still signed in would put its copy back.
   *
   * **And after a sign-out**, the next person to sign in on this device
   * inherited them: `pulled` sent as `since` against a bucket that had never
   * issued it, so they were served the tail of their own history and told it
   * was all of it.
   *
   * The epoch bump is the fence. A run already in flight checks it before it
   * applies anything or writes a cursor back, so a push that started before
   * this cannot land afterwards and restore the numbers it was carrying.
   * `halted` is the other half: nothing new starts either.
   */
  async forget({ erased = false }: { erased?: boolean } = {}): Promise<void> {
    this.epoch += 1;
    this.halted = true;
    this.dirty = false;
    const { pushed, settled } = await this.cursors.read();
    // What the server has heard outlives the conversation about it, unless the
    // bucket itself is gone. After an erase there is nothing left anywhere to
    // send a deleted row back, so this device is as free to collect as one that
    // never signed in -- and has to be, or a person who erases and stays signed
    // out keeps every tombstone they write from then on.
    await this.rewind(erased ? 0 : Math.max(settled, pushed));
  }

  /**
   * A local truncate, and it does not push.
   *
   * Reset means this device, not every device: see `Repository.clearAll`. The
   * cursor is reset with it so the next sync pulls the whole log back down,
   * which is what makes this "start again here" rather than "lose everything".
   */
  async clearAll(): Promise<void> {
    this.epoch += 1;
    await this.local.clearAll();
    await this.rewind();
    this.dirty = true;
    this.announce({ lastSyncedAt: null, pending: 0 });

    // And ask for it back, which the comment above has always promised and this
    // never did. Every other write on this class goes through `touched`, which
    // pushes; this one did not, so a reset device sat empty until the player
    // typed something into it or quit and reopened the app -- and the device
    // this is most likely to be used on is the one nobody types into.
    void this.push().catch(() => {
      // The truncate has already happened, which is what was asked for. The
      // log comes back on the next sync either way.
    });
  }
}
