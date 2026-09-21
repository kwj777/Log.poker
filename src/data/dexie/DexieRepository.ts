/**
 * IndexedDB-backed repository -- the web implementation.
 *
 * Behaviorally identical to `SqlRepository`; the shared conformance suite in
 * `src/data/__tests__/repositoryContract.ts` runs against both to keep it that way.
 */

import type {
  Hand,
  MoodEntry,
  NewHand,
  NewMoodEntry,
  NewRebuy,
  NewSession,
  NewVenue,
  Rebuy,
  Session,
  SessionWithChildren,
  Timestamp,
  Venue,
} from '../../domain/types';
import {
  ConstraintError,
  NotFoundError,
  type Change,
  type ChangeSet,
  type HandPatch,
  type Preferences,
  type Repository,
  type SessionFilter,
  type SessionPatch,
  type VenuePatch,
} from '../repository';
import { DEFAULT_CURRENCY } from '../../domain/money';
import { patchedKeys, toPreferences } from '../preferences';
import {
  applyPatch,
  assertImportKeysAvailable,
  buildHand,
  buildMoodEntry,
  buildRebuy,
  buildSession,
  buildVenue,
  defaultContext,
  importKeyFor,
  importKeyOwners,
  type RepositoryContext,
} from '../support';
import {
  createDatabase,
  OPEN_SESSION_ENDED_AT,
  type DeletedAt,
  type HandRecord,
  type LogDatabase,
  type MoodRecord,
  type RebuyRecord,
  type SessionRecord,
  type VenueRecord,
} from './db';

/**
 * Tombstones read as absent, null or a stamp, in that order of likelihood: a
 * record written before this build has no property at all. Everything below
 * asks this rather than testing the field, so the three shapes are handled in
 * one place.
 */
const deletedAt = (record: { deletedAt?: DeletedAt }): number | null => record.deletedAt ?? null;
const isLive = (record: { deletedAt?: DeletedAt }): boolean => deletedAt(record) === null;

const toVenue = (record: VenueRecord, sessionCount: number): Venue => ({
  id: record.id,
  name: record.name,
  isHomeGame: record.isHomeGame === 1,
  sessionCount,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const fromVenue = (venue: Venue): VenueRecord => ({
  id: venue.id,
  name: venue.name,
  isHomeGame: venue.isHomeGame ? 1 : 0,
  createdAt: venue.createdAt,
  updatedAt: venue.updatedAt,
});

const toSession = (record: SessionRecord): Session => ({
  id: record.id,
  venueId: record.venueId,
  format: record.format,
  gameType: record.gameType,
  stakes: record.stakes === null ? null : { ...record.stakes },
  currency: record.currency,
  buyIn: record.buyIn,
  fee: record.fee,
  cashOut: record.cashOut,
  entrants: record.entrants,
  finishPosition: record.finishPosition,
  startedAt: record.startedAt,
  endedAt: record.endedAt === OPEN_SESSION_ENDED_AT ? null : record.endedAt,
  notes: record.notes,
  importKey: record.importKey ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const fromSession = (session: Session): SessionRecord => ({
  id: session.id,
  venueId: session.venueId,
  format: session.format,
  gameType: session.gameType,
  stakes: session.stakes === null ? null : { ...session.stakes },
  currency: session.currency,
  buyIn: session.buyIn,
  fee: session.fee,
  cashOut: session.cashOut,
  entrants: session.entrants,
  finishPosition: session.finishPosition,
  startedAt: session.startedAt,
  endedAt: session.endedAt ?? OPEN_SESSION_ENDED_AT,
  notes: session.notes,
  // Spread rather than assigned: see `SessionRecord.importKey` -- the property
  // has to be absent, not null, or the unique index would reject the second
  // hand-logged session.
  ...(session.importKey === null ? {} : { importKey: session.importKey }),
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

/**
 * Field by field rather than by spread, now that the records carry a storage
 * concern the domain types do not. A spread would put `deletedAt` on a `Hand`,
 * where SQLite's mapper does not put one, and the conformance suite compares
 * the two engines' output directly.
 */
const toRebuy = (record: RebuyRecord): Rebuy => ({
  id: record.id,
  sessionId: record.sessionId,
  amount: record.amount,
  at: record.at,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/**
 * The fields of an incoming record that this file is about to spread, made safe
 * to spread.
 *
 * The server validates an id and a stamp and carries every other field through
 * untouched; `sanitize` in `src/sync/bundle.ts` says so in as many words. So a
 * hand can arrive with no `tags` at all and a session with no `stakes`, and
 * `[...undefined]` throws.
 *
 * A throw inside `applyChanges` is not one bad row. It rolls back every venue,
 * session, rebuy, hand and mood entry in the same answer, and it escapes before
 * the cursor is written, so the identical batch is fetched and rejected again
 * on every sync after it: one record nobody could see would end web sync for
 * that account for good. That is the opposite of what the contract promises,
 * which is that an inconsistent row costs that row and not the sync, and it is
 * why the whole of `applyChanges` is written to skip rather than throw.
 *
 * SQLite reads the same two fields as `record.tags ?? []` and
 * `record.stakes?.bigBlind ?? 0`, so only the web build was ever exposed. These
 * are that guard, on this side, landing on the same answers: no tags, and no
 * stakes, which is what `0/0` reads back as there.
 */
const incomingTags = (tags: Hand['tags'] | undefined): Hand['tags'] =>
  Array.isArray(tags) ? [...tags] : [];

/**
 * The rest of an incoming record's fields, coerced to what the column promises.
 *
 * The two guards above cover the fields that made this side *throw*. These
 * cover the ones that made the two engines disagree: SQLite binds a record's
 * fields straight into a statement and cannot bind `undefined` at all, so it
 * now defaults every one of them, and a row that lands there as an empty name
 * has to land here the same way rather than as a venue with no name property
 * at all.
 */
const incomingText = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const incomingMaybeText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const incomingNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const incomingMaybeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const incomingStakes = (stakes: Session['stakes'] | undefined): Session['stakes'] => {
  if (stakes === null || stakes === undefined) return null;
  const { smallBlind, bigBlind, ante } = stakes;
  if (typeof smallBlind !== 'number' || typeof bigBlind !== 'number') return null;
  return typeof ante === 'number' ? { smallBlind, bigBlind, ante } : { smallBlind, bigBlind };
};

const toHand = (record: HandRecord): Hand => ({
  id: record.id,
  sessionId: record.sessionId,
  holeCards: record.holeCards,
  // Records written before this field existed have no property at all, and it
  // is not indexed, so there is nothing to migrate: absent reads as null. The
  // same argument the tombstone column made.
  board: record.board ?? null,
  position: record.position,
  note: record.note,
  tags: [...record.tags],
  amount: record.amount,
  at: record.at,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const toMoodEntry = (record: MoodRecord): MoodEntry => ({
  id: record.id,
  sessionId: record.sessionId,
  phase: record.phase,
  score: record.score,
  at: record.at,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export class DexieRepository implements Repository {
  private readonly db: LogDatabase;
  private readonly ctx: RepositoryContext;

  constructor(
    db: LogDatabase = createDatabase(),
    ctx: RepositoryContext = defaultContext(),
  ) {
    this.db = db;
    this.ctx = ctx;
  }

  async init(): Promise<void> {
    if (!this.db.isOpen()) await this.db.open();
  }

  // ------------------------------------------------------------------ sync

  /**
   * What has moved since the cursor, off the index rather than out of the whole
   * table.
   *
   * This is the read that runs after every write, and it used to pull every
   * venue, session, rebuy, hand and mood entry into memory and filter them in
   * JavaScript -- a structured clone per record, to answer with nothing nearly
   * every time. `updatedAt` has been an index since v5 and `above` walks it
   * from the cursor forward, so the cost is the size of the answer rather than
   * the size of the log.
   *
   * The order is the index's, which is `updatedAt` ascending, and that is the
   * order the sync layer needs: a batch cut short has to leave a cursor that
   * nothing before it is still waiting behind.
   */
  async listChangedSince(since: Timestamp): Promise<ChangeSet> {
    const changed = <Record extends { updatedAt: number; deletedAt?: DeletedAt }, T>(
      records: readonly Record[],
      map: (record: Record) => T,
    ): Change<T>[] =>
      records.map((record) => ({ record: map(record), deletedAt: deletedAt(record) }));

    const from = <Record>(table: {
      where(index: string): { above(key: number): { toArray(): Promise<Record[]> } };
    }): Promise<Record[]> => table.where('updatedAt').above(since).toArray();

    const [venues, sessions, rebuys, hands, moodEntries] = await Promise.all([
      from<VenueRecord>(this.db.venues),
      from<SessionRecord>(this.db.sessions),
      from<RebuyRecord>(this.db.rebuys),
      from<HandRecord>(this.db.hands),
      from<MoodRecord>(this.db.moodEntries),
    ]);

    // Only when a venue is in the answer. The count is a pass over every
    // session, and the sync layer reads it off the record it is sending rather
    // than asking for it, so paying for it on a push that carries no venue --
    // which is nearly all of them -- was a scan for a number nobody read.
    const counts = venues.length === 0 ? new Map<string, number>() : await this.sessionCounts();

    return {
      venues: changed(venues, (record) => toVenue(record, counts.get(record.id) ?? 0)),
      sessions: changed(sessions, toSession),
      rebuys: changed(rebuys, toRebuy),
      hands: changed(hands, toHand),
      moodEntries: changed(moodEntries, toMoodEntry),
    };
  }

  /** Sync's write. Upserts verbatim, parents first, skipping orphans. */
  /**
   * Take what the server sent, without stepping on a write it has not seen.
   *
   * The `stale` check below is SQLite's `WHERE excluded.updated_at >= ...`
   * written out, and it is here for the same reason and with the same meaning.
   * It is not the device resolving anything: the server still decides, and the
   * row it is protecting is on its way up to be decided. It is the device
   * refusing to destroy the evidence first.
   *
   * The case is ordinary. Every answer contains the records this device just
   * pushed, because the server heard them in the request being answered, so a
   * note typed while the request was in flight meets its own pre-edit self
   * coming back. Overwritten, that edit also falls below the push mark and is
   * never sent anywhere.
   */
  async applyChanges(changes: ChangeSet): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.venues, this.db.sessions, this.db.rebuys, this.db.hands, this.db.moodEntries],
      async () => {
        /**
         * Ids whose local row is strictly newer than what arrived.
         *
         * `>` and not `>=`, so a tombstone still beats an edit made in the same
         * millisecond, which is what the merge decided everywhere else.
         */
        const newerHere = async (
          table: { bulkGet(ids: string[]): Promise<({ updatedAt: Timestamp } | undefined)[]> },
          incoming: readonly { record: { id: string; updatedAt: Timestamp } }[],
        ): Promise<Set<string>> => {
          const skip = new Set<string>();
          if (incoming.length === 0) return skip;
          const held = await table.bulkGet(incoming.map((change) => change.record.id));
          held.forEach((row, index) => {
            const arriving = incoming[index].record;
            if (row !== undefined && row.updatedAt > arriving.updatedAt) skip.add(arriving.id);
          });
          return skip;
        };

        const staleVenues = await newerHere(this.db.venues, changes.venues);
        for (const { record, deletedAt } of changes.venues) {
          if (staleVenues.has(record.id)) continue;
          await this.db.venues.put({
            ...fromVenue({
              ...record,
              name: incomingText(record.name, ''),
              isHomeGame: record.isHomeGame === true,
              createdAt: incomingNumber(record.createdAt, record.updatedAt),
            }),
            deletedAt,
          });
        }

        // No foreign keys here to throw, but the same skip: a session whose
        // venue never arrived would render with no venue at all, which is a
        // worse outcome than one row waiting for the next sync.
        const known = new Set((await this.db.venues.toArray()).map((venue) => venue.id));

        // What will actually be written, worked out before anything is,
        // because the import-key release below has to agree with it. A key
        // released for a row that is then skipped strips the provenance off a
        // local session on behalf of one that never arrived, and the staleness
        // test refuses a row as flatly as a missing venue does.
        const staleSessions = await newerHere(this.db.sessions, changes.sessions);
        const arriving = changes.sessions.filter(
          ({ record }) => known.has(record.venueId) && !staleSessions.has(record.id),
        );

        // The same import-key release SQLite needs, for the same reason: the
        // `&importKey` index here is unique too, and `put` would reject the
        // incoming row rather than the stale local one. And the same tie to
        // break when two arriving rows claim one key, for the same reason
        // again: the rejection is thrown inside the transaction, so it costs
        // the whole answer rather than the one row. See `importKeyOwners`.
        const owners = importKeyOwners(arriving);
        const claimed = new Map<string, string>();
        for (const { record } of arriving) {
          const key = importKeyFor(record, owners);
          if (key !== null) claimed.set(key, record.id);
        }
        if (claimed.size > 0) {
          for (const held of await this.db.sessions.toArray()) {
            const owner = held.importKey === undefined ? undefined : claimed.get(held.importKey);
            if (owner === undefined || owner === held.id) continue;
            const { importKey: _released, ...rest } = held;
            await this.db.sessions.put(rest);
          }
        }

        const stored = new Set<string>();
        for (const { record, deletedAt } of arriving) {
          const key = importKeyFor(record, owners);
          // Through `fromSession` rather than around it: a key it does not keep
          // has to be absent from the record, not null, or every loser lands in
          // the unique index under the same key. See `SessionRecord.importKey`.
          await this.db.sessions.put({
            ...fromSession({
              ...record,
              gameType: incomingText(record.gameType, 'NLHE') as Session['gameType'],
              currency: incomingText(record.currency, DEFAULT_CURRENCY),
              buyIn: incomingNumber(record.buyIn, 0),
              startedAt: incomingNumber(record.startedAt, record.updatedAt),
              createdAt: incomingNumber(record.createdAt, record.updatedAt),
              notes: incomingMaybeText(record.notes),
              stakes: incomingStakes(record.stakes),
              importKey: key,
            }),
            deletedAt,
          });
          stored.add(record.id);
        }

        const sessions = new Set([
          ...stored,
          ...(await this.db.sessions.toArray()).map((session) => session.id),
        ]);

        const staleRebuys = await newerHere(this.db.rebuys, changes.rebuys);
        for (const { record, deletedAt } of changes.rebuys) {
          if (!sessions.has(record.sessionId) || staleRebuys.has(record.id)) continue;
          await this.db.rebuys.put({
            ...record,
            amount: incomingNumber(record.amount, 0),
            at: incomingNumber(record.at, record.updatedAt),
            createdAt: incomingNumber(record.createdAt, record.updatedAt),
            deletedAt,
          });
        }
        const staleHands = await newerHere(this.db.hands, changes.hands);
        for (const { record, deletedAt } of changes.hands) {
          if (!sessions.has(record.sessionId) || staleHands.has(record.id)) continue;
          await this.db.hands.put({
            ...record,
            holeCards: incomingMaybeText(record.holeCards),
            board: incomingMaybeText(record.board),
            position: incomingMaybeText(record.position) as Hand['position'],
            note: incomingMaybeText(record.note),
            amount: incomingMaybeNumber(record.amount),
            at: incomingNumber(record.at, record.updatedAt),
            createdAt: incomingNumber(record.createdAt, record.updatedAt),
            tags: incomingTags(record.tags),
            deletedAt,
          });
        }
        const staleMoods = await newerHere(this.db.moodEntries, changes.moodEntries);
        for (const { record, deletedAt } of changes.moodEntries) {
          if (!sessions.has(record.sessionId) || staleMoods.has(record.id)) continue;
          await this.db.moodEntries.put({
            ...record,
            phase: incomingText(record.phase, 'start') as MoodEntry['phase'],
            score: incomingNumber(record.score, 3) as MoodEntry['score'],
            at: incomingNumber(record.at, record.updatedAt),
            createdAt: incomingNumber(record.createdAt, record.updatedAt),
            deletedAt,
          });
        }
      },
    );
  }

  /** Collect tombstones older than `before`. See the contract for the rule. */
  async collectTombstones(before: Timestamp): Promise<number> {
    let removed = 0;
    await this.db.transaction(
      'rw',
      [this.db.venues, this.db.sessions, this.db.rebuys, this.db.hands, this.db.moodEntries],
      async () => {
        const stale = (record: { deletedAt?: DeletedAt }): boolean => {
          const at = deletedAt(record);
          return at !== null && at < before;
        };

        // Children first, for the same reason as SQLite even without a foreign
        // key to enforce it: a hand whose session is gone is not a hand.
        const sessions = (await this.db.sessions.toArray()).filter(stale);
        const orphaning = new Set(sessions.map((session) => session.id));
        for (const table of [this.db.moodEntries, this.db.hands, this.db.rebuys] as const) {
          // Tombstoned, or under a session that is going whether it is
          // tombstoned or not. SQLite's foreign key took the second kind with
          // the session and this did not, so the same sweep lost a hand on the
          // phone and kept it in the browser.
          const going = (await table.toArray())
            .filter((record) => stale(record) || orphaning.has(record.sessionId))
            .map((record) => record.id);
          if (going.length === 0) continue;
          await table.bulkDelete(going);
          removed += going.length;
        }

        if (sessions.length > 0) {
          await this.db.sessions.bulkDelete(sessions.map((session) => session.id));
          removed += sessions.length;
        }

        const referenced = new Set((await this.db.sessions.toArray()).map((s) => s.venueId));
        const venues = (await this.db.venues.toArray())
          .filter((venue) => stale(venue) && !referenced.has(venue.id))
          .map((venue) => venue.id);
        if (venues.length > 0) {
          await this.db.venues.bulkDelete(venues);
          removed += venues.length;
        }
      },
    );
    return removed;
  }

  // ---------------------------------------------------------------- venues

  /** Session counts come from one grouped pass rather than a query per venue. */
  private async sessionCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    await this.db.sessions.each((session) => {
      if (!isLive(session)) return;
      counts.set(session.venueId, (counts.get(session.venueId) ?? 0) + 1);
    });
    return counts;
  }

  /** Live sessions at a venue. What decides whether the venue can be deleted. */
  private async liveSessionsAt(venueId: string): Promise<number> {
    const records = await this.db.sessions.where('venueId').equals(venueId).toArray();
    return records.filter(isLive).length;
  }

  async listVenues(): Promise<Venue[]> {
    const [records, counts] = await Promise.all([
      this.db.venues.toArray(),
      this.sessionCounts(),
    ]);
    return records
      .filter(isLive)
      .map((record) => toVenue(record, counts.get(record.id) ?? 0))
      .sort(
        (a, b) =>
          b.sessionCount - a.sessionCount ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
  }

  async getVenue(id: string): Promise<Venue | null> {
    const record = await this.db.venues.get(id);
    if (!record || !isLive(record)) return null;
    return toVenue(record, await this.liveSessionsAt(id));
  }

  async createVenue(input: NewVenue): Promise<Venue> {
    const venue = buildVenue(input, this.ctx);
    if (venue.name === '') throw new ConstraintError('Venue name cannot be empty');
    await this.db.venues.add(fromVenue(venue));
    return venue;
  }

  async updateVenue(id: string, patch: VenuePatch): Promise<Venue> {
    const existing = await this.getVenue(id);
    if (!existing) throw new NotFoundError('Venue', id);
    const next = applyPatch(existing, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
    });
    if (next.name === '') throw new ConstraintError('Venue name cannot be empty');
    next.updatedAt = this.ctx.clock.now();
    await this.db.venues.put(fromVenue(next));
    return next;
  }

  async deleteVenue(id: string): Promise<void> {
    // Live sessions only: a tombstoned session no longer holds its venue back,
    // but its `venueId` still points at the row, which is why the venue is
    // tombstoned rather than removed.
    if ((await this.liveSessionsAt(id)) > 0) {
      throw new ConstraintError('Cannot delete a venue that still has sessions');
    }
    const now = this.ctx.clock.now();
    await this.db.venues
      .where('id')
      .equals(id)
      .modify((record) => {
        if (!isLive(record)) return;
        record.deletedAt = now;
        record.updatedAt = now;
      });
  }

  // -------------------------------------------------------------- sessions

  async listSessions(filter: SessionFilter = {}): Promise<SessionWithChildren[]> {
    let records = (await this.db.sessions.orderBy('startedAt').reverse().toArray()).filter(isLive);

    if (filter.venueId !== undefined) {
      records = records.filter((record) => record.venueId === filter.venueId);
    }
    if (filter.format !== undefined) {
      records = records.filter((record) => record.format === filter.format);
    }
    if (filter.gameType !== undefined) {
      records = records.filter((record) => record.gameType === filter.gameType);
    }
    if (filter.from !== undefined) {
      records = records.filter((record) => record.startedAt >= filter.from!);
    }
    if (filter.to !== undefined) {
      records = records.filter((record) => record.startedAt < filter.to!);
    }
    if (filter.status === 'active') {
      records = records.filter((record) => record.endedAt === OPEN_SESSION_ENDED_AT);
    }
    if (filter.status === 'completed') {
      records = records.filter((record) => record.endedAt !== OPEN_SESSION_ENDED_AT);
    }
    if (filter.limit !== undefined) {
      records = records.slice(0, Math.max(0, Math.floor(filter.limit)));
    }

    return this.attachChildren(records.map(toSession));
  }

  async getSession(id: string): Promise<SessionWithChildren | null> {
    const record = await this.db.sessions.get(id);
    if (!record || !isLive(record)) return null;
    const [session] = await this.attachChildren([toSession(record)]);
    return session;
  }

  async getActiveSession(): Promise<SessionWithChildren | null> {
    const records = (
      await this.db.sessions.where('endedAt').equals(OPEN_SESSION_ENDED_AT).toArray()
    ).filter(isLive);
    if (records.length === 0) return null;
    const newest = records.reduce((latest, record) =>
      record.startedAt > latest.startedAt ? record : latest,
    );
    const [session] = await this.attachChildren([toSession(newest)]);
    return session;
  }

  private async attachChildren(sessions: Session[]): Promise<SessionWithChildren[]> {
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((session) => session.id);
    const venueIds = Array.from(new Set(sessions.map((session) => session.venueId)));

    const [rebuyRecords, venueRecords, counts] = await Promise.all([
      this.db.rebuys.where('sessionId').anyOf(sessionIds).toArray(),
      this.db.venues.where('id').anyOf(venueIds).toArray(),
      this.sessionCounts(),
    ]);

    const rebuysBySession = new Map<string, Rebuy[]>();
    for (const record of rebuyRecords.filter(isLive)) {
      const list = rebuysBySession.get(record.sessionId);
      if (list) list.push(toRebuy(record));
      else rebuysBySession.set(record.sessionId, [toRebuy(record)]);
    }
    for (const list of rebuysBySession.values()) list.sort((a, b) => a.at - b.at);

    const venuesById = new Map(
      venueRecords
        .filter(isLive)
        .map((record) => [record.id, toVenue(record, counts.get(record.id) ?? 0)]),
    );

    return sessions.map((session) => ({
      ...session,
      rebuys: rebuysBySession.get(session.id) ?? [],
      venue: venuesById.get(session.venueId) ?? null,
    }));
  }

  async createSession(input: NewSession): Promise<Session> {
    const venue = await this.db.venues.get(input.venueId);
    if (!venue || !isLive(venue)) throw new NotFoundError('Venue', input.venueId);
    if (input.importKey != null) {
      assertImportKeysAvailable([input], new Set(await this.listImportKeys()));
    }
    const session = buildSession(input, this.ctx);
    await this.db.sessions.add(fromSession(session));
    return session;
  }

  async createSessions(inputs: readonly NewSession[]): Promise<Session[]> {
    if (inputs.length === 0) return [];

    const venueIds = Array.from(new Set(inputs.map((input) => input.venueId)));
    const known = new Set(
      (await this.db.venues.where('id').anyOf(venueIds).toArray()).filter(isLive).map((v) => v.id),
    );
    for (const venueId of venueIds) {
      if (!known.has(venueId)) throw new NotFoundError('Venue', venueId);
    }
    assertImportKeysAvailable(inputs, new Set(await this.listImportKeys()));

    return this.db.transaction('rw', this.db.sessions, async () => {
      const sessions = inputs.map((input) => buildSession(input, this.ctx));
      await this.db.sessions.bulkAdd(sessions.map(fromSession));
      return sessions;
    });
  }

  async listImportKeys(): Promise<string[]> {
    const keys = await this.db.sessions.orderBy('importKey').keys();
    return keys.map((key) => String(key));
  }

  async updateSession(id: string, patch: SessionPatch): Promise<Session> {
    const existing = await this.db.sessions.get(id);
    if (!existing || !isLive(existing)) throw new NotFoundError('Session', id);
    const next = applyPatch<Session>(toSession(existing), patch);
    next.updatedAt = this.ctx.clock.now();
    await this.db.sessions.put(fromSession(next));
    return next;
  }

  async endSession(id: string, cashOut: number, endedAt: Timestamp): Promise<Session> {
    const existing = await this.db.sessions.get(id);
    if (!existing || !isLive(existing)) throw new NotFoundError('Session', id);
    if (endedAt < existing.startedAt) {
      throw new ConstraintError('A session cannot end before it started');
    }
    return this.updateSession(id, { cashOut, endedAt });
  }

  async deleteSession(id: string): Promise<void> {
    const now = this.ctx.clock.now();
    const tombstone = (record: { deletedAt?: DeletedAt; updatedAt: number }): void => {
      if (!isLive(record)) return;
      record.deletedAt = now;
      record.updatedAt = now;
    };

    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.rebuys, this.db.hands, this.db.moodEntries],
      async () => {
        // Children take the parent's stamp, so a merge cannot revive a hand
        // whose session is gone by finding it a millisecond fresher.
        await this.db.rebuys.where('sessionId').equals(id).modify(tombstone);
        await this.db.hands.where('sessionId').equals(id).modify(tombstone);
        await this.db.moodEntries.where('sessionId').equals(id).modify(tombstone);
        await this.db.sessions
          .where('id')
          .equals(id)
          .modify((record) => {
            if (!isLive(record)) return;
            tombstone(record);
            // Deleted and then re-imported has always worked. The property is
            // removed rather than nulled because the index it sits in is
            // unique: see `SessionRecord.importKey`.
            delete record.importKey;
          });
      },
    );
  }

  // ---------------------------------------------------------------- rebuys

  async listRebuys(sessionId: string): Promise<Rebuy[]> {
    const records = await this.db.rebuys.where('sessionId').equals(sessionId).toArray();
    return records.filter(isLive).map(toRebuy).sort((a, b) => a.at - b.at);
  }

  async addRebuy(input: NewRebuy): Promise<Rebuy> {
    const session = await this.db.sessions.get(input.sessionId);
    if (!session || !isLive(session)) throw new NotFoundError('Session', input.sessionId);
    const rebuy = buildRebuy(input, this.ctx);
    await this.db.rebuys.add({ ...rebuy });
    return rebuy;
  }

  async deleteRebuy(id: string): Promise<void> {
    const now = this.ctx.clock.now();
    await this.db.rebuys
      .where('id')
      .equals(id)
      .modify((record) => {
        if (!isLive(record)) return;
        record.deletedAt = now;
        record.updatedAt = now;
      });
  }

  // ----------------------------------------------------------------- hands

  async listHands(sessionId?: string): Promise<Hand[]> {
    const records =
      sessionId === undefined
        ? await this.db.hands.toArray()
        : await this.db.hands.where('sessionId').equals(sessionId).toArray();
    return records.filter(isLive).map(toHand).sort((a, b) => b.at - a.at);
  }

  async countHands(): Promise<number> {
    // `deletedAt` is not indexed -- see the tombstone note in the README -- so
    // this counts what survives the filter rather than asking the index. Still
    // one pass over keys instead of reading and mapping every row.
    let live = 0;
    await this.db.hands.each((record) => {
      if (isLive(record)) live += 1;
    });
    return live;
  }

  async getHand(id: string): Promise<Hand | null> {
    const record = await this.db.hands.get(id);
    return record && isLive(record) ? toHand(record) : null;
  }

  async createHand(input: NewHand): Promise<Hand> {
    const session = await this.db.sessions.get(input.sessionId);
    if (!session || !isLive(session)) throw new NotFoundError('Session', input.sessionId);
    const hand = buildHand(input, this.ctx);
    await this.db.hands.add({ ...hand, tags: [...hand.tags] });
    return hand;
  }

  async updateHand(id: string, patch: HandPatch): Promise<Hand> {
    const existing = await this.db.hands.get(id);
    if (!existing || !isLive(existing)) throw new NotFoundError('Hand', id);
    const next = applyPatch<Hand>(toHand(existing), patch);
    next.updatedAt = this.ctx.clock.now();
    await this.db.hands.put({ ...next, tags: [...next.tags] });
    return next;
  }

  async deleteHand(id: string): Promise<void> {
    const now = this.ctx.clock.now();
    await this.db.hands
      .where('id')
      .equals(id)
      .modify((record) => {
        if (!isLive(record)) return;
        record.deletedAt = now;
        record.updatedAt = now;
      });
  }

  // ------------------------------------------------------------------ mood

  async listMoodEntries(sessionId?: string): Promise<MoodEntry[]> {
    const records =
      sessionId === undefined
        ? await this.db.moodEntries.toArray()
        : await this.db.moodEntries.where('sessionId').equals(sessionId).toArray();
    return records.filter(isLive).map(toMoodEntry).sort((a, b) => b.at - a.at);
  }

  async createMoodEntry(input: NewMoodEntry): Promise<MoodEntry> {
    const session = await this.db.sessions.get(input.sessionId);
    if (!session || !isLive(session)) throw new NotFoundError('Session', input.sessionId);
    const entry = buildMoodEntry(input, this.ctx);
    await this.db.moodEntries.add({ ...entry });
    return entry;
  }

  async deleteMoodEntry(id: string): Promise<void> {
    const now = this.ctx.clock.now();
    await this.db.moodEntries
      .where('id')
      .equals(id)
      .modify((record) => {
        if (!isLive(record)) return;
        record.deletedAt = now;
        record.updatedAt = now;
      });
  }

  // ---------------------------------------------------------- preferences

  /**
   * Stored structured, unlike the SQLite side, which has to JSON it through a
   * text column. Validated by the same reader either way, so a value that has
   * stopped being a setting means the same thing on both engines.
   */
  async getPreferences(): Promise<Preferences> {
    const rows = await this.db.preferences.toArray();
    return toPreferences(new Map(rows.map((row) => [row.key, row.value])));
  }

  async setPreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const keys = patchedKeys(patch);
    if (keys.length > 0) {
      await this.db.transaction('rw', [this.db.preferences], async () => {
        await this.db.preferences.bulkPut(
          keys.map((key) => ({ key, value: patch[key] ?? null })),
        );
      });
    }
    return this.getPreferences();
  }

  // ----------------------------------------------------------- maintenance

  async clearAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.venues,
        this.db.sessions,
        this.db.rebuys,
        this.db.hands,
        this.db.moodEntries,
        this.db.preferences,
      ],
      async () => {
        await Promise.all([
          this.db.moodEntries.clear(),
          this.db.hands.clear(),
          this.db.rebuys.clear(),
          this.db.sessions.clear(),
          this.db.venues.clear(),
          // A device with no sessions on it has no starting balance either.
          this.db.preferences.clear(),
        ]);
      },
    );
  }
}
