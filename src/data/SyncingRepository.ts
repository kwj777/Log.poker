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
}

/** Where the cursors live. Small enough that anything durable will do. */
export interface CursorStore {
  read(): Promise<Cursors>;
  write(cursors: Cursors): Promise<void>;
}

export const memoryCursorStore = (
  start: Cursors = { pulled: 0, pushed: 0, device: 'test-device-0001' },
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
}

export class SyncingRepository implements Repository {
  private readonly local: Repository;
  private readonly token: string;
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
  };
  private listeners = new Set<(state: SyncState) => void>();

  constructor(
    local: Repository,
    token: string,
    cursors: CursorStore = memoryCursorStore(),
    options: SyncingOptions = {},
    clock: () => Timestamp = Date.now,
  ) {
    this.local = local;
    this.token = token;
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
    if (this.inFlight) return this.inFlight;
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

  private async run(): Promise<void> {
    this.announce({ running: true });

    // Cleared before anything is read, not after. A write that lands from here
    // on sets it again and is sent by the next round; clearing afterwards would
    // swallow exactly those writes.
    this.dirty = false;
    const epoch = this.epoch;
    const startedAt = this.clock();

    const cursors = await this.cursors.read();
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
      this.token,
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
    }

    if (epoch !== this.epoch) {
      this.announce({ running: false, problem: null });
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
   * A local truncate, and it does not push.
   *
   * Reset means this device, not every device: see `Repository.clearAll`. The
   * cursor is reset with it so the next sync pulls the whole log back down,
   * which is what makes this "start again here" rather than "lose everything".
   */
  async clearAll(): Promise<void> {
    this.epoch += 1;
    await this.local.clearAll();
    const { device } = await this.cursors.read();
    // The device id survives a reset, because forgetting it would make this
    // device look like a new one to the server and hold up collection for a
    // whole retention window under a name nobody will ever use again.
    await this.cursors.write({ pulled: 0, pushed: 0, device });
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
