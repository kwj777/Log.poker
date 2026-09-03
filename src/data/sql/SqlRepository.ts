/**
 * SQLite-backed repository — the native (iOS/Android) implementation.
 *
 * Talks to a `SqlDriver` rather than to expo-sqlite directly, which keeps it
 * testable in Node against a real SQLite engine.
 */

import {
  GAME_TYPES,
  HAND_TAGS,
  MOOD_PHASES,
  type GameType,
  type Hand,
  type HandTag,
  type MoodEntry,
  type MoodPhase,
  type MoodScore,
  type NewHand,
  type NewMoodEntry,
  type NewRebuy,
  type NewSession,
  type NewVenue,
  type Position,
  type Rebuy,
  type Session,
  type SessionWithChildren,
  type Timestamp,
  type Venue,
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
import { first, type SqlDriver, type SqlValue } from './driver';
import { migrate } from './schema';

interface VenueRow {
  id: string;
  name: string;
  is_home_game: number;
  created_at: number;
  updated_at: number;
  session_count?: number;
}

interface SessionRow {
  id: string;
  venue_id: string;
  game_type: string;
  small_blind: number;
  big_blind: number;
  ante: number | null;
  currency: string;
  buy_in: number;
  cash_out: number | null;
  started_at: number;
  ended_at: number | null;
  notes: string | null;
  import_key: string | null;
  created_at: number;
  updated_at: number;
}

interface RebuyRow {
  id: string;
  session_id: string;
  amount: number;
  at: number;
  created_at: number;
  updated_at: number;
}

interface HandRow {
  id: string;
  session_id: string;
  hole_cards: string | null;
  position: string | null;
  note: string | null;
  tags: string;
  amount: number | null;
  at: number;
  created_at: number;
  updated_at: number;
}

interface MoodRow {
  id: string;
  session_id: string;
  phase: string;
  score: number;
  at: number;
  created_at: number;
  updated_at: number;
}

const isGameType = (value: string): value is GameType =>
  (GAME_TYPES as readonly string[]).includes(value);

const isMoodPhase = (value: string): value is MoodPhase =>
  (MOOD_PHASES as readonly string[]).includes(value);

/**
 * Tags round-trip as a JSON array. Unknown values are dropped rather than
 * trusted: a row written by a newer build should degrade, not crash an older one.
 */
const parseTags = (raw: string): HandTag[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is HandTag =>
      typeof tag === 'string' && (HAND_TAGS as readonly string[]).includes(tag),
    );
  } catch {
    return [];
  }
};

const toVenue = (row: VenueRow): Venue => ({
  id: row.id,
  name: row.name,
  isHomeGame: row.is_home_game === 1,
  sessionCount: row.session_count ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toSession = (row: SessionRow): Session => ({
  id: row.id,
  venueId: row.venue_id,
  gameType: isGameType(row.game_type) ? row.game_type : 'OTHER',
  stakes: {
    smallBlind: row.small_blind,
    bigBlind: row.big_blind,
    ...(row.ante === null ? {} : { ante: row.ante }),
    currency: row.currency,
  },
  buyIn: row.buy_in,
  cashOut: row.cash_out,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  notes: row.notes,
  importKey: row.import_key ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toRebuy = (row: RebuyRow): Rebuy => ({
  id: row.id,
  sessionId: row.session_id,
  amount: row.amount,
  at: row.at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toHand = (row: HandRow): Hand => ({
  id: row.id,
  sessionId: row.session_id,
  holeCards: row.hole_cards,
  position: (row.position as Position | null) ?? null,
  note: row.note,
  tags: parseTags(row.tags),
  amount: row.amount,
  at: row.at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMoodEntry = (row: MoodRow): MoodEntry => ({
  id: row.id,
  sessionId: row.session_id,
  phase: isMoodPhase(row.phase) ? row.phase : 'mid',
  score: Math.min(5, Math.max(1, row.score)) as MoodScore,
  at: row.at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const bool = (value: boolean): number => (value ? 1 : 0);

export class SqlRepository implements Repository {
  private readonly driver: SqlDriver;
  private readonly ctx: RepositoryContext;
  private initialised = false;

  constructor(driver: SqlDriver, ctx: RepositoryContext = defaultContext()) {
    this.driver = driver;
    this.ctx = ctx;
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    await migrate(this.driver);
    this.initialised = true;
  }

  // ---------------------------------------------------------------- venues

  async listVenues(): Promise<Venue[]> {
    const rows = await this.driver.all<VenueRow>(
      `SELECT v.*, (SELECT COUNT(*) FROM sessions s WHERE s.venue_id = v.id) AS session_count
       FROM venues v
       ORDER BY session_count DESC, v.name COLLATE NOCASE ASC`,
    );
    return rows.map(toVenue);
  }

  async getVenue(id: string): Promise<Venue | null> {
    const row = await first<VenueRow>(
      this.driver,
      `SELECT v.*, (SELECT COUNT(*) FROM sessions s WHERE s.venue_id = v.id) AS session_count
       FROM venues v WHERE v.id = ?`,
      [id],
    );
    return row ? toVenue(row) : null;
  }

  async createVenue(input: NewVenue): Promise<Venue> {
    const venue = buildVenue(input, this.ctx);
    if (venue.name === '') throw new ConstraintError('Venue name cannot be empty');
    await this.driver.run(
      `INSERT INTO venues (id, name, is_home_game, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [venue.id, venue.name, bool(venue.isHomeGame), venue.createdAt, venue.updatedAt],
    );
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
    await this.driver.run(
      `UPDATE venues SET name = ?, is_home_game = ?, updated_at = ? WHERE id = ?`,
      [next.name, bool(next.isHomeGame), next.updatedAt, id],
    );
    return next;
  }

  async deleteVenue(id: string): Promise<void> {
    const row = await first<{ count: number }>(
      this.driver,
      `SELECT COUNT(*) AS count FROM sessions WHERE venue_id = ?`,
      [id],
    );
    if ((row?.count ?? 0) > 0) {
      throw new ConstraintError('Cannot delete a venue that still has sessions');
    }
    await this.driver.run(`DELETE FROM venues WHERE id = ?`, [id]);
  }

  // -------------------------------------------------------------- sessions

  async listSessions(filter: SessionFilter = {}): Promise<SessionWithChildren[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (filter.venueId !== undefined) {
      clauses.push('venue_id = ?');
      params.push(filter.venueId);
    }
    if (filter.gameType !== undefined) {
      clauses.push('game_type = ?');
      params.push(filter.gameType);
    }
    if (filter.from !== undefined) {
      clauses.push('started_at >= ?');
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push('started_at < ?');
      params.push(filter.to);
    }
    if (filter.status === 'active') clauses.push('ended_at IS NULL');
    if (filter.status === 'completed') clauses.push('ended_at IS NOT NULL');

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filter.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
    const rows = await this.driver.all<SessionRow>(
      `SELECT * FROM sessions ${where} ORDER BY started_at DESC ${limit}`,
      params,
    );
    return this.attachChildren(rows.map(toSession));
  }

  async getSession(id: string): Promise<SessionWithChildren | null> {
    const row = await first<SessionRow>(this.driver, `SELECT * FROM sessions WHERE id = ?`, [id]);
    if (!row) return null;
    const [session] = await this.attachChildren([toSession(row)]);
    return session;
  }

  async getActiveSession(): Promise<SessionWithChildren | null> {
    const row = await first<SessionRow>(
      this.driver,
      `SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    );
    if (!row) return null;
    const [session] = await this.attachChildren([toSession(row)]);
    return session;
  }

  /**
   * Resolve rebuys and venues for a page of sessions in two queries rather than
   * two per session — the history list would otherwise fan out badly once a
   * player has a few hundred sessions.
   */
  private async attachChildren(sessions: Session[]): Promise<SessionWithChildren[]> {
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((session) => session.id);
    const venueIds = Array.from(new Set(sessions.map((session) => session.venueId)));

    const rebuyRows = await this.driver.all<RebuyRow>(
      `SELECT * FROM rebuys WHERE session_id IN (${sessionIds.map(() => '?').join(',')}) ORDER BY at ASC`,
      sessionIds,
    );
    const venueRows = await this.driver.all<VenueRow>(
      `SELECT v.*, (SELECT COUNT(*) FROM sessions s WHERE s.venue_id = v.id) AS session_count
       FROM venues v WHERE v.id IN (${venueIds.map(() => '?').join(',')})`,
      venueIds,
    );

    const rebuysBySession = new Map<string, Rebuy[]>();
    for (const row of rebuyRows) {
      const list = rebuysBySession.get(row.session_id);
      if (list) list.push(toRebuy(row));
      else rebuysBySession.set(row.session_id, [toRebuy(row)]);
    }
    const venuesById = new Map(venueRows.map((row) => [row.id, toVenue(row)]));

    return sessions.map((session) => ({
      ...session,
      rebuys: rebuysBySession.get(session.id) ?? [],
      venue: venuesById.get(session.venueId) ?? null,
    }));
  }

  async createSession(input: NewSession): Promise<Session> {
    const venue = await this.getVenue(input.venueId);
    if (!venue) throw new NotFoundError('Venue', input.venueId);
    if (input.importKey != null) {
      assertImportKeysAvailable([input], new Set(await this.listImportKeys()));
    }

    const session = buildSession(input, this.ctx);
    await this.insertSession(session);
    return session;
  }

  async createSessions(inputs: readonly NewSession[]): Promise<Session[]> {
    if (inputs.length === 0) return [];

    const venueIds = Array.from(new Set(inputs.map((input) => input.venueId)));
    const known = new Set(
      (
        await this.driver.all<{ id: string }>(
          `SELECT id FROM venues WHERE id IN (${venueIds.map(() => '?').join(',')})`,
          venueIds,
        )
      ).map((row) => row.id),
    );
    for (const venueId of venueIds) {
      if (!known.has(venueId)) throw new NotFoundError('Venue', venueId);
    }
    assertImportKeysAvailable(inputs, new Set(await this.listImportKeys()));

    return this.driver.transaction(async () => {
      const sessions = inputs.map((input) => buildSession(input, this.ctx));
      for (const session of sessions) await this.insertSession(session);
      return sessions;
    });
  }

  async listImportKeys(): Promise<string[]> {
    const rows = await this.driver.all<{ import_key: string }>(
      `SELECT import_key FROM sessions WHERE import_key IS NOT NULL`,
    );
    return rows.map((row) => row.import_key);
  }

  private async insertSession(session: Session): Promise<void> {
    await this.driver.run(
      `INSERT INTO sessions (
         id, venue_id, game_type, small_blind, big_blind, ante, currency, buy_in,
         cash_out, started_at, ended_at, notes, import_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.venueId,
        session.gameType,
        session.stakes.smallBlind,
        session.stakes.bigBlind,
        session.stakes.ante ?? null,
        session.stakes.currency,
        session.buyIn,
        session.cashOut,
        session.startedAt,
        session.endedAt,
        session.notes,
        session.importKey,
        session.createdAt,
        session.updatedAt,
      ],
    );
  }

  async updateSession(id: string, patch: SessionPatch): Promise<Session> {
    const existing = await this.getSession(id);
    if (!existing) throw new NotFoundError('Session', id);
    const next = applyPatch<Session>(existing, patch);
    next.updatedAt = this.ctx.clock.now();
    await this.writeSession(next);
    return next;
  }

  private async writeSession(session: Session): Promise<void> {
    await this.driver.run(
      `UPDATE sessions SET venue_id = ?, game_type = ?, small_blind = ?, big_blind = ?,
         ante = ?, currency = ?, buy_in = ?, cash_out = ?, started_at = ?, ended_at = ?,
         notes = ?, updated_at = ? WHERE id = ?`,
      [
        session.venueId,
        session.gameType,
        session.stakes.smallBlind,
        session.stakes.bigBlind,
        session.stakes.ante ?? null,
        session.stakes.currency,
        session.buyIn,
        session.cashOut,
        session.startedAt,
        session.endedAt,
        session.notes,
        session.updatedAt,
        session.id,
      ],
    );
  }

  async endSession(id: string, cashOut: number, endedAt: Timestamp): Promise<Session> {
    const existing = await this.getSession(id);
    if (!existing) throw new NotFoundError('Session', id);
    if (endedAt < existing.startedAt) {
      throw new ConstraintError('A session cannot end before it started');
    }
    return this.updateSession(id, { cashOut, endedAt });
  }

  async deleteSession(id: string): Promise<void> {
    // Child rows are deleted explicitly rather than relying on ON DELETE
    // CASCADE: `PRAGMA foreign_keys` is per-connection, and a future driver that
    // forgets it would silently orphan rows.
    await this.driver.transaction(async () => {
      await this.driver.run(`DELETE FROM rebuys WHERE session_id = ?`, [id]);
      await this.driver.run(`DELETE FROM hands WHERE session_id = ?`, [id]);
      await this.driver.run(`DELETE FROM mood_entries WHERE session_id = ?`, [id]);
      await this.driver.run(`DELETE FROM sessions WHERE id = ?`, [id]);
    });
  }

  // ---------------------------------------------------------------- rebuys

  async listRebuys(sessionId: string): Promise<Rebuy[]> {
    const rows = await this.driver.all<RebuyRow>(
      `SELECT * FROM rebuys WHERE session_id = ? ORDER BY at ASC`,
      [sessionId],
    );
    return rows.map(toRebuy);
  }

  async addRebuy(input: NewRebuy): Promise<Rebuy> {
    const session = await this.getSession(input.sessionId);
    if (!session) throw new NotFoundError('Session', input.sessionId);
    const rebuy = buildRebuy(input, this.ctx);
    await this.driver.run(
      `INSERT INTO rebuys (id, session_id, amount, at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [rebuy.id, rebuy.sessionId, rebuy.amount, rebuy.at, rebuy.createdAt, rebuy.updatedAt],
    );
    return rebuy;
  }

  async deleteRebuy(id: string): Promise<void> {
    await this.driver.run(`DELETE FROM rebuys WHERE id = ?`, [id]);
  }

  // ----------------------------------------------------------------- hands

  async listHands(sessionId?: string): Promise<Hand[]> {
    const rows =
      sessionId === undefined
        ? await this.driver.all<HandRow>(`SELECT * FROM hands ORDER BY at DESC`)
        : await this.driver.all<HandRow>(
            `SELECT * FROM hands WHERE session_id = ? ORDER BY at DESC`,
            [sessionId],
          );
    return rows.map(toHand);
  }

  async getHand(id: string): Promise<Hand | null> {
    const row = await first<HandRow>(this.driver, `SELECT * FROM hands WHERE id = ?`, [id]);
    return row ? toHand(row) : null;
  }

  async createHand(input: NewHand): Promise<Hand> {
    const session = await this.getSession(input.sessionId);
    if (!session) throw new NotFoundError('Session', input.sessionId);
    const hand = buildHand(input, this.ctx);
    await this.driver.run(
      `INSERT INTO hands (id, session_id, hole_cards, position, note, tags, amount, at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hand.id,
        hand.sessionId,
        hand.holeCards,
        hand.position,
        hand.note,
        JSON.stringify(hand.tags),
        hand.amount,
        hand.at,
        hand.createdAt,
        hand.updatedAt,
      ],
    );
    return hand;
  }

  async updateHand(id: string, patch: HandPatch): Promise<Hand> {
    const existing = await this.getHand(id);
    if (!existing) throw new NotFoundError('Hand', id);
    const next = applyPatch<Hand>(existing, patch);
    next.updatedAt = this.ctx.clock.now();
    await this.driver.run(
      `UPDATE hands SET hole_cards = ?, position = ?, note = ?, tags = ?, amount = ?, at = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.holeCards,
        next.position,
        next.note,
        JSON.stringify(next.tags),
        next.amount,
        next.at,
        next.updatedAt,
        id,
      ],
    );
    return next;
  }

  async deleteHand(id: string): Promise<void> {
    await this.driver.run(`DELETE FROM hands WHERE id = ?`, [id]);
  }

  // ------------------------------------------------------------------ mood

  async listMoodEntries(sessionId?: string): Promise<MoodEntry[]> {
    const rows =
      sessionId === undefined
        ? await this.driver.all<MoodRow>(`SELECT * FROM mood_entries ORDER BY at DESC`)
        : await this.driver.all<MoodRow>(
            `SELECT * FROM mood_entries WHERE session_id = ? ORDER BY at DESC`,
            [sessionId],
          );
    return rows.map(toMoodEntry);
  }

  async createMoodEntry(input: NewMoodEntry): Promise<MoodEntry> {
    const session = await this.getSession(input.sessionId);
    if (!session) throw new NotFoundError('Session', input.sessionId);
    const entry = buildMoodEntry(input, this.ctx);
    await this.driver.run(
      `INSERT INTO mood_entries (id, session_id, phase, score, at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.sessionId, entry.phase, entry.score, entry.at, entry.createdAt, entry.updatedAt],
    );
    return entry;
  }

  async deleteMoodEntry(id: string): Promise<void> {
    await this.driver.run(`DELETE FROM mood_entries WHERE id = ?`, [id]);
  }

  // ----------------------------------------------------------- maintenance

  async clearAll(): Promise<void> {
    await this.driver.transaction(async () => {
      await this.driver.run(`DELETE FROM mood_entries`);
      await this.driver.run(`DELETE FROM hands`);
      await this.driver.run(`DELETE FROM rebuys`);
      await this.driver.run(`DELETE FROM sessions`);
      await this.driver.run(`DELETE FROM venues`);
    });
  }
}
