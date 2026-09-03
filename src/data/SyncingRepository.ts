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
 * One number, the newest `updatedAt` this device has been told about. Kept
 * beside the token rather than in the database, because it is a fact about this
 * device's conversation with the server and not part of the log: `clearAll`
 * wipes the log and the cursor has to survive that, or a reset device would
 * re-pull nothing and sit there looking empty.
 *
 * ## What it does not do
 *
 * It does not resolve anything. The server merges; this sends what changed and
 * applies what comes back. A device that has been in a drawer for a month has a
 * month-old view of the world and possibly a wrong clock, and the fewer
 * decisions it makes the fewer ways two devices have of never converging.
 */

import type { Timestamp } from '../domain/types';
import { backoffMs, sync, type SyncOptions } from '../sync/client';
import { SYNC_TABLES, countChanges, isEmptyChangeSet, type SyncFailure } from '../sync/protocol';
import type {
  ChangeSet,
  HandPatch,
  Repository,
  SessionFilter,
  SessionPatch,
  VenuePatch,
} from './repository';

/**
 * Two cursors, because one cannot do both jobs.
 *
 * `pulled` is the newest stamp the server has told this device about. `pushed`
 * is the newest stamp this device has sent. They look like they should be the
 * same number and they are not, because the server's cursor includes records
 * from other devices: sync a laptop while a phone is busy and `pulled` jumps
 * past stamps the laptop wrote and never sent, which would make those records
 * invisible to the next push and lost for good.
 *
 * So one tracks the conversation in each direction, and neither is ever asked
 * about the other's.
 */
export interface Cursors {
  pulled: Timestamp;
  pushed: Timestamp;
}

/** Where the cursors live. Small enough that anything durable will do. */
export interface CursorStore {
  read(): Promise<Cursors>;
  write(cursors: Cursors): Promise<void>;
}

export const memoryCursorStore = (start: Cursors = { pulled: 0, pushed: 0 }): CursorStore => {
  let held = start;
  return {
    read: async () => held,
    write: async (cursors) => {
      held = cursors;
    },
  };
};

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
  private readonly options: SyncOptions;
  private readonly clock: () => Timestamp;

  /** Set by every write. Cleared only once the server has taken the change. */
  private dirty = true;
  private failures = 0;
  private nextAttemptAt = 0;
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
    options: SyncOptions = {},
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
    if (!force && !this.dirty && this.state.lastSyncedAt !== null) return;
    if (!force && this.clock() < this.nextAttemptAt) return;

    this.inFlight = (async () => {
      // Around again while writes keep landing. Joining an in-flight run is
      // not the same as being sent by it: a write that arrives after this run
      // read its changes has to go in the next one, or it waits for a change
      // that may never come. Bounded, so a pathological write rate cannot spin
      // here; the next write's own push picks up whatever is left.
      let rounds = 0;
      do {
        await this.run();
        rounds += 1;
      } while (this.dirty && this.state.problem === null && rounds < 5);
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async run(): Promise<void> {
    this.announce({ running: true });

    // Cleared before anything is read, not after. A write that lands from here
    // on sets it again and is sent by the next round; clearing afterwards would
    // swallow exactly those writes.
    this.dirty = false;

    const cursors = await this.cursors.read();
    // One millisecond back, for the reason the pull side reads `>=`: a record
    // written in the very millisecond of the last one sent is otherwise never
    // sent at all, and a venue and the session started on it are routinely the
    // same millisecond. Re-sending that millisecond is free, because applying a
    // record twice is a no-op.
    const changes = await this.local.listChangedSince(
      cursors.pushed === 0 ? 0 : cursors.pushed - 1,
    );
    const outgoing = countChanges(changes);
    this.announce({ pending: outgoing });

    // The high-water mark of what is actually going up, which is what `pushed`
    // becomes if this succeeds. Taken from the records rather than from the
    // clock, so a record written during the request stays newer than it.
    let sent = cursors.pushed;
    for (const table of SYNC_TABLES) {
      for (const change of changes[table]) {
        if (change.record.updatedAt > sent) sent = change.record.updatedAt;
      }
    }

    const outcome = await sync({ since: cursors.pulled, changes }, this.token, this.options);

    if (!outcome.ok) {
      this.dirty = true;
      this.failures += 1;
      this.nextAttemptAt =
        // An unauthorized answer is not a thing waiting fixes. Somebody has to
        // sign in again, so the loop stops rather than spending a battery.
        outcome.reason === 'unauthorized'
          ? Number.MAX_SAFE_INTEGER
          : this.clock() + backoffMs(this.failures);
      this.announce({ running: false, problem: outcome.reason });
      return;
    }

    if (!isEmptyChangeSet(outcome.response.changes)) {
      await this.local.applyChanges(outcome.response.changes);
    }
    await this.cursors.write({ pulled: outcome.response.cursor, pushed: sent });

    this.failures = 0;
    this.nextAttemptAt = 0;
    this.announce({
      running: false,
      problem: null,
      pending: 0,
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
    await this.local.clearAll();
    await this.cursors.write({ pulled: 0, pushed: 0 });
    this.dirty = true;
    this.announce({ lastSyncedAt: null, pending: 0 });
  }
}
