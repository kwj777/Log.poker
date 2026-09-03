/**
 * IndexedDB-backed repository — the web implementation.
 *
 * Behaviourally identical to `SqlRepository`; the shared conformance suite in
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
  type HandPatch,
  type Repository,
  type SessionFilter,
  type SessionPatch,
  type VenuePatch,
} from '../repository';
import {
  applyPatch,
  assertImportKeysAvailable,
  buildHand,
  buildMoodEntry,
  buildRebuy,
  buildSession,
  buildVenue,
  defaultContext,
  type RepositoryContext,
} from '../support';
import {
  createDatabase,
  OPEN_SESSION_ENDED_AT,
  type HandRecord,
  type LogDatabase,
  type MoodRecord,
  type RebuyRecord,
  type SessionRecord,
  type VenueRecord,
} from './db';

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
  gameType: record.gameType,
  stakes: { ...record.stakes },
  buyIn: record.buyIn,
  cashOut: record.cashOut,
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
  gameType: session.gameType,
  stakes: { ...session.stakes },
  buyIn: session.buyIn,
  cashOut: session.cashOut,
  startedAt: session.startedAt,
  endedAt: session.endedAt ?? OPEN_SESSION_ENDED_AT,
  notes: session.notes,
  // Spread rather than assigned: see `SessionRecord.importKey` — the property
  // has to be absent, not null, or the unique index would reject the second
  // hand-logged session.
  ...(session.importKey === null ? {} : { importKey: session.importKey }),
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

const toRebuy = (record: RebuyRecord): Rebuy => ({ ...record });
const toHand = (record: HandRecord): Hand => ({ ...record, tags: [...record.tags] });
const toMoodEntry = (record: MoodRecord): MoodEntry => ({ ...record });

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

  // ---------------------------------------------------------------- venues

  /** Session counts come from one grouped pass rather than a query per venue. */
  private async sessionCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    await this.db.sessions.each((session) => {
      counts.set(session.venueId, (counts.get(session.venueId) ?? 0) + 1);
    });
    return counts;
  }

  async listVenues(): Promise<Venue[]> {
    const [records, counts] = await Promise.all([
      this.db.venues.toArray(),
      this.sessionCounts(),
    ]);
    return records
      .map((record) => toVenue(record, counts.get(record.id) ?? 0))
      .sort(
        (a, b) =>
          b.sessionCount - a.sessionCount ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
  }

  async getVenue(id: string): Promise<Venue | null> {
    const record = await this.db.venues.get(id);
    if (!record) return null;
    const count = await this.db.sessions.where('venueId').equals(id).count();
    return toVenue(record, count);
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
    const count = await this.db.sessions.where('venueId').equals(id).count();
    if (count > 0) throw new ConstraintError('Cannot delete a venue that still has sessions');
    await this.db.venues.delete(id);
  }

  // -------------------------------------------------------------- sessions

  async listSessions(filter: SessionFilter = {}): Promise<SessionWithChildren[]> {
    let records = await this.db.sessions.orderBy('startedAt').reverse().toArray();

    if (filter.venueId !== undefined) {
      records = records.filter((record) => record.venueId === filter.venueId);
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
    if (!record) return null;
    const [session] = await this.attachChildren([toSession(record)]);
    return session;
  }

  async getActiveSession(): Promise<SessionWithChildren | null> {
    const records = await this.db.sessions
      .where('endedAt')
      .equals(OPEN_SESSION_ENDED_AT)
      .toArray();
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
    for (const record of rebuyRecords) {
      const list = rebuysBySession.get(record.sessionId);
      if (list) list.push(toRebuy(record));
      else rebuysBySession.set(record.sessionId, [toRebuy(record)]);
    }
    for (const list of rebuysBySession.values()) list.sort((a, b) => a.at - b.at);

    const venuesById = new Map(
      venueRecords.map((record) => [record.id, toVenue(record, counts.get(record.id) ?? 0)]),
    );

    return sessions.map((session) => ({
      ...session,
      rebuys: rebuysBySession.get(session.id) ?? [],
      venue: venuesById.get(session.venueId) ?? null,
    }));
  }

  async createSession(input: NewSession): Promise<Session> {
    const venue = await this.db.venues.get(input.venueId);
    if (!venue) throw new NotFoundError('Venue', input.venueId);
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
    const known = new Set((await this.db.venues.where('id').anyOf(venueIds).toArray()).map((v) => v.id));
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
    if (!existing) throw new NotFoundError('Session', id);
    const next = applyPatch<Session>(toSession(existing), patch);
    next.updatedAt = this.ctx.clock.now();
    await this.db.sessions.put(fromSession(next));
    return next;
  }

  async endSession(id: string, cashOut: number, endedAt: Timestamp): Promise<Session> {
    const existing = await this.db.sessions.get(id);
    if (!existing) throw new NotFoundError('Session', id);
    if (endedAt < existing.startedAt) {
      throw new ConstraintError('A session cannot end before it started');
    }
    return this.updateSession(id, { cashOut, endedAt });
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.sessions, this.db.rebuys, this.db.hands, this.db.moodEntries],
      async () => {
        await this.db.rebuys.where('sessionId').equals(id).delete();
        await this.db.hands.where('sessionId').equals(id).delete();
        await this.db.moodEntries.where('sessionId').equals(id).delete();
        await this.db.sessions.delete(id);
      },
    );
  }

  // ---------------------------------------------------------------- rebuys

  async listRebuys(sessionId: string): Promise<Rebuy[]> {
    const records = await this.db.rebuys.where('sessionId').equals(sessionId).toArray();
    return records.map(toRebuy).sort((a, b) => a.at - b.at);
  }

  async addRebuy(input: NewRebuy): Promise<Rebuy> {
    const session = await this.db.sessions.get(input.sessionId);
    if (!session) throw new NotFoundError('Session', input.sessionId);
    const rebuy = buildRebuy(input, this.ctx);
    await this.db.rebuys.add({ ...rebuy });
    return rebuy;
  }

  async deleteRebuy(id: string): Promise<void> {
    await this.db.rebuys.delete(id);
  }

  // ----------------------------------------------------------------- hands

  async listHands(sessionId?: string): Promise<Hand[]> {
    const records =
      sessionId === undefined
        ? await this.db.hands.toArray()
        : await this.db.hands.where('sessionId').equals(sessionId).toArray();
    return records.map(toHand).sort((a, b) => b.at - a.at);
  }

  async getHand(id: string): Promise<Hand | null> {
    const record = await this.db.hands.get(id);
    return record ? toHand(record) : null;
  }

  async createHand(input: NewHand): Promise<Hand> {
    const session = await this.db.sessions.get(input.sessionId);
    if (!session) throw new NotFoundError('Session', input.sessionId);
    const hand = buildHand(input, this.ctx);
    await this.db.hands.add({ ...hand, tags: [...hand.tags] });
    return hand;
  }

  async updateHand(id: string, patch: HandPatch): Promise<Hand> {
    const existing = await this.db.hands.get(id);
    if (!existing) throw new NotFoundError('Hand', id);
    const next = applyPatch<Hand>(toHand(existing), patch);
    next.updatedAt = this.ctx.clock.now();
    await this.db.hands.put({ ...next, tags: [...next.tags] });
    return next;
  }

  async deleteHand(id: string): Promise<void> {
    await this.db.hands.delete(id);
  }

  // ------------------------------------------------------------------ mood

  async listMoodEntries(sessionId?: string): Promise<MoodEntry[]> {
    const records =
      sessionId === undefined
        ? await this.db.moodEntries.toArray()
        : await this.db.moodEntries.where('sessionId').equals(sessionId).toArray();
    return records.map(toMoodEntry).sort((a, b) => b.at - a.at);
  }

  async createMoodEntry(input: NewMoodEntry): Promise<MoodEntry> {
    const session = await this.db.sessions.get(input.sessionId);
    if (!session) throw new NotFoundError('Session', input.sessionId);
    const entry = buildMoodEntry(input, this.ctx);
    await this.db.moodEntries.add({ ...entry });
    return entry;
  }

  async deleteMoodEntry(id: string): Promise<void> {
    await this.db.moodEntries.delete(id);
  }

  // ----------------------------------------------------------- maintenance

  async clearAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.venues, this.db.sessions, this.db.rebuys, this.db.hands, this.db.moodEntries],
      async () => {
        await Promise.all([
          this.db.moodEntries.clear(),
          this.db.hands.clear(),
          this.db.rebuys.clear(),
          this.db.sessions.clear(),
          this.db.venues.clear(),
        ]);
      },
    );
  }
}
