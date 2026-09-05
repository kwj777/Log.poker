/**
 * SQLite-backed repository -- the native (iOS/Android) implementation.
 *
 * Talks to a `SqlDriver` rather than to expo-sqlite directly, which keeps it
 * testable in Node against a real SQLite engine.
 */

import {
  GAME_TYPES,
  HAND_TAGS,
  MOOD_PHASES,
  SESSION_FORMATS,
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
  type SessionFormat,
  type SessionWithChildren,
  type Stakes,
  type Timestamp,
  type Venue,
} from '../../domain/types';
import {
  ConstraintError,
  NotFoundError,
  type Change,
  type ChangeSet,
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
  deleted_at: number | null;
  session_count?: number;
}

interface SessionRow {
  id: string;
  venue_id: string;
  format: string;
  game_type: string;
  small_blind: number;
  big_blind: number;
  ante: number | null;
  currency: string;
  buy_in: number;
  fee: number | null;
  cash_out: number | null;
  entrants: number | null;
  finish_position: number | null;
  started_at: number;
  ended_at: number | null;
  notes: string | null;
  import_key: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface RebuyRow {
  id: string;
  session_id: string;
  amount: number;
  at: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
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
  deleted_at: number | null;
}

interface MoodRow {
  id: string;
  session_id: string;
  phase: string;
  score: number;
  at: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
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

const isSessionFormat = (value: string): value is SessionFormat =>
  (SESSION_FORMATS as readonly string[]).includes(value);

/**
 * 0/0 is the stored form of "no stakes" -- see the v3 migration. It is a total
 * encoding rather than a guess: no poker game has ever been played with both
 * blinds at zero, so nothing real can collide with it.
 */
const toStakes = (row: SessionRow): Stakes | null => {
  if (row.small_blind === 0 && row.big_blind === 0) return null;
  return {
    smallBlind: row.small_blind,
    bigBlind: row.big_blind,
    ...(row.ante === null ? {} : { ante: row.ante }),
  };
};

const toSession = (row: SessionRow): Session => {
  const format = isSessionFormat(row.format) ? row.format : 'cash';
  return {
    id: row.id,
    venueId: row.venue_id,
    format,
    gameType: isGameType(row.game_type) ? row.game_type : 'OTHER',
    stakes: format === 'tournament' ? null : toStakes(row),
    currency: row.currency,
    buyIn: row.buy_in,
    fee: row.fee,
    cashOut: row.cash_out,
    entrants: row.entrants,
    finishPosition: row.finish_position,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    notes: row.notes,
    importKey: row.import_key ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

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
  private initialized = false;

  constructor(driver: SqlDriver, ctx: RepositoryContext = defaultContext()) {
    this.driver = driver;
    this.ctx = ctx;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await migrate(this.driver);
    this.initialized = true;
  }

  // ------------------------------------------------------------------ sync

  async listChangedSince(since: Timestamp): Promise<ChangeSet> {
    // Ordered by the cursor rather than by anything a screen wants, and run
    // one after another rather than in parallel, because a driver holding one
    // connection would serialize them anyway and the interleaving would only
    // make the failure harder to read.
    const changed = async <Row extends { deleted_at: number | null }, T>(
      sql: string,
      map: (row: Row) => T,
    ): Promise<Change<T>[]> => {
      const rows = await this.driver.all<Row>(sql, [since]);
      return rows.map((row) => ({ record: map(row), deletedAt: row.deleted_at }));
    };

    return {
      venues: await changed<VenueRow, Venue>(
        `SELECT v.*, (SELECT COUNT(*) FROM sessions s
                      WHERE s.venue_id = v.id AND s.deleted_at IS NULL) AS session_count
         FROM venues v WHERE v.updated_at > ? ORDER BY v.updated_at ASC`,
        toVenue,
      ),
      sessions: await changed<SessionRow, Session>(
        `SELECT * FROM sessions WHERE updated_at > ? ORDER BY updated_at ASC`,
        toSession,
      ),
      rebuys: await changed<RebuyRow, Rebuy>(
        `SELECT * FROM rebuys WHERE updated_at > ? ORDER BY updated_at ASC`,
        toRebuy,
      ),
      hands: await changed<HandRow, Hand>(
        `SELECT * FROM hands WHERE updated_at > ? ORDER BY updated_at ASC`,
        toHand,
      ),
      moodEntries: await changed<MoodRow, MoodEntry>(
        `SELECT * FROM mood_entries WHERE updated_at > ? ORDER BY updated_at ASC`,
        toMoodEntry,
      ),
    };
  }

  /**
   * Sync's write. Upserts verbatim, parents first, skipping orphans.
   *
   * **`ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE`.** They read as
   * synonyms and are not: SQLite implements REPLACE as a DELETE followed by an
   * INSERT, and that delete fires `ON DELETE CASCADE`. So replacing a session
   * row silently took every hand, rebuy and mood entry under it with it -- not
   * tombstoned, removed -- and since those children sit below the sync cursor,
   * nothing ever brought them back. Editing a session's notes on a laptop
   * destroyed the hands logged against it on the phone.
   *
   * A genuine upsert leaves the row in place and writes over its columns, so no
   * delete happens and no cascade fires. The same trap applies to venues, where
   * the cascade is absent but the foreign key is not: REPLACE would try to
   * delete a venue that sessions still reference and be refused.
   */
  async applyChanges(changes: ChangeSet): Promise<void> {
    await this.driver.transaction(async () => {
      for (const { record, deletedAt } of changes.venues) {
        await this.driver.run(
          `INSERT INTO venues (id, name, is_home_game, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             is_home_game = excluded.is_home_game,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [record.id, record.name, bool(record.isHomeGame), record.createdAt, record.updatedAt, deletedAt],
        );
      }

      // An incoming session can carry an import key that a *different* local
      // row still holds, which the unique index would refuse. The server is
      // authoritative here: its merge folds two imports of one row into one
      // session and clears the loser's key, so the local holder is stale and
      // the key is released before the insert rather than after it fails.
      //
      // The displaced row keeps every field and every child; it loses only the
      // provenance it was about to lose anyway. Its stamps are left alone,
      // because this is reconciling with a decision already made rather than
      // an edit worth pushing back.
      for (const { record } of changes.sessions) {
        if (typeof record.importKey !== 'string' || record.importKey === '') continue;
        await this.driver.run(
          `UPDATE sessions SET import_key = NULL WHERE import_key = ? AND id <> ?`,
          [record.importKey, record.id],
        );
      }

      // A session naming a venue that is still missing is skipped rather than
      // thrown on: foreign keys are on, and one inconsistent row should cost
      // that row rather than the whole sync.
      const known = new Set(
        (await this.driver.all<{ id: string }>(`SELECT id FROM venues`)).map((row) => row.id),
      );
      const stored = new Set<string>();
      for (const { record, deletedAt } of changes.sessions) {
        if (!known.has(record.venueId)) continue;
        await this.driver.run(
          `INSERT INTO sessions (
             id, venue_id, format, game_type, small_blind, big_blind, ante, currency,
             buy_in, fee, cash_out, entrants, finish_position, started_at, ended_at,
             notes, import_key, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             venue_id = excluded.venue_id,
             format = excluded.format,
             game_type = excluded.game_type,
             small_blind = excluded.small_blind,
             big_blind = excluded.big_blind,
             ante = excluded.ante,
             currency = excluded.currency,
             buy_in = excluded.buy_in,
             fee = excluded.fee,
             cash_out = excluded.cash_out,
             entrants = excluded.entrants,
             finish_position = excluded.finish_position,
             started_at = excluded.started_at,
             ended_at = excluded.ended_at,
             notes = excluded.notes,
             import_key = excluded.import_key,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [
            record.id, record.venueId, record.format, record.gameType,
            record.stakes?.smallBlind ?? 0, record.stakes?.bigBlind ?? 0,
            record.stakes?.ante ?? null, record.currency, record.buyIn, record.fee,
            record.cashOut, record.entrants, record.finishPosition, record.startedAt,
            record.endedAt, record.notes, record.importKey, record.createdAt,
            record.updatedAt, deletedAt,
          ],
        );
        stored.add(record.id);
      }

      const sessions = new Set([
        ...stored,
        ...(await this.driver.all<{ id: string }>(`SELECT id FROM sessions`)).map((row) => row.id),
      ]);

      for (const { record, deletedAt } of changes.rebuys) {
        if (!sessions.has(record.sessionId)) continue;
        await this.driver.run(
          `INSERT INTO rebuys (id, session_id, amount, at, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             amount = excluded.amount,
             at = excluded.at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [record.id, record.sessionId, record.amount, record.at, record.createdAt, record.updatedAt, deletedAt],
        );
      }

      for (const { record, deletedAt } of changes.hands) {
        if (!sessions.has(record.sessionId)) continue;
        await this.driver.run(
          `INSERT INTO hands (
             id, session_id, hole_cards, position, note, tags, amount, at,
             created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             hole_cards = excluded.hole_cards,
             position = excluded.position,
             note = excluded.note,
             tags = excluded.tags,
             amount = excluded.amount,
             at = excluded.at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [
            record.id, record.sessionId, record.holeCards, record.position, record.note,
            JSON.stringify(record.tags ?? []), record.amount, record.at,
            record.createdAt, record.updatedAt, deletedAt,
          ],
        );
      }

      for (const { record, deletedAt } of changes.moodEntries) {
        if (!sessions.has(record.sessionId)) continue;
        await this.driver.run(
          `INSERT INTO mood_entries (
             id, session_id, phase, score, at, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id = excluded.session_id,
             phase = excluded.phase,
             score = excluded.score,
             at = excluded.at,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [
            record.id, record.sessionId, record.phase, record.score, record.at,
            record.createdAt, record.updatedAt, deletedAt,
          ],
        );
      }
    });
  }

  /** Collect tombstones older than `before`. See the contract for the rule. */
  async collectTombstones(before: Timestamp): Promise<number> {
    let removed = 0;
    await this.driver.transaction(async () => {
      // Children first: a session cannot go while its rows still point at it.
      for (const table of ['mood_entries', 'hands', 'rebuys', 'sessions']) {
        const before_ = await this.count(table);
        await this.driver.run(
          `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
          [before],
        );
        removed += before_ - (await this.count(table));
      }

      // And a venue only when nothing references it at all, live or tombstoned.
      // Foreign keys are on, so the alternative is a throw halfway through.
      const venues = await this.count('venues');
      await this.driver.run(
        `DELETE FROM venues
         WHERE deleted_at IS NOT NULL AND deleted_at < ?
           AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.venue_id = venues.id)`,
        [before],
      );
      removed += venues - (await this.count('venues'));
    });
    return removed;
  }

  private async count(table: string): Promise<number> {
    const row = await first<{ n: number }>(this.driver, `SELECT COUNT(*) AS n FROM ${table}`);
    return row?.n ?? 0;
  }

  // ---------------------------------------------------------------- venues

  async listVenues(): Promise<Venue[]> {
    const rows = await this.driver.all<VenueRow>(
      `SELECT v.*, (SELECT COUNT(*) FROM sessions s
                     WHERE s.venue_id = v.id AND s.deleted_at IS NULL) AS session_count
       FROM venues v
       WHERE v.deleted_at IS NULL
       ORDER BY session_count DESC, v.name COLLATE NOCASE ASC`,
    );
    return rows.map(toVenue);
  }

  async getVenue(id: string): Promise<Venue | null> {
    const row = await first<VenueRow>(
      this.driver,
      `SELECT v.*, (SELECT COUNT(*) FROM sessions s
                     WHERE s.venue_id = v.id AND s.deleted_at IS NULL) AS session_count
       FROM venues v WHERE v.id = ? AND v.deleted_at IS NULL`,
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
      // Live sessions only. A tombstoned session no longer holds its venue
      // back, which is the difference between "this venue is in use" and "this
      // venue was once used by something waiting to be collected".
      `SELECT COUNT(*) AS count FROM sessions WHERE venue_id = ? AND deleted_at IS NULL`,
      [id],
    );
    if ((row?.count ?? 0) > 0) {
      throw new ConstraintError('Cannot delete a venue that still has sessions');
    }
    const now = this.ctx.clock.now();
    await this.driver.run(
      `UPDATE venues SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
  }

  // -------------------------------------------------------------- sessions

  async listSessions(filter: SessionFilter = {}): Promise<SessionWithChildren[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (filter.venueId !== undefined) {
      clauses.push('venue_id = ?');
      params.push(filter.venueId);
    }
    if (filter.format !== undefined) {
      clauses.push('format = ?');
      params.push(filter.format);
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

    clauses.push('deleted_at IS NULL');

    const where = `WHERE ${clauses.join(' AND ')}`;
    const limit = filter.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : '';
    const rows = await this.driver.all<SessionRow>(
      `SELECT * FROM sessions ${where} ORDER BY started_at DESC ${limit}`,
      params,
    );
    return this.attachChildren(rows.map(toSession));
  }

  async getSession(id: string): Promise<SessionWithChildren | null> {
    const row = await first<SessionRow>(
      this.driver,
      `SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!row) return null;
    const [session] = await this.attachChildren([toSession(row)]);
    return session;
  }

  async getActiveSession(): Promise<SessionWithChildren | null> {
    const row = await first<SessionRow>(
      this.driver,
      `SELECT * FROM sessions
       WHERE ended_at IS NULL AND deleted_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
    );
    if (!row) return null;
    const [session] = await this.attachChildren([toSession(row)]);
    return session;
  }

  /**
   * Resolve rebuys and venues for a page of sessions in two queries rather than
   * two per session -- the history list would otherwise fan out badly once a
   * player has a few hundred sessions.
   */
  private async attachChildren(sessions: Session[]): Promise<SessionWithChildren[]> {
    if (sessions.length === 0) return [];

    const sessionIds = sessions.map((session) => session.id);
    const venueIds = Array.from(new Set(sessions.map((session) => session.venueId)));

    const rebuyRows = await this.driver.all<RebuyRow>(
      `SELECT * FROM rebuys
       WHERE session_id IN (${sessionIds.map(() => '?').join(',')}) AND deleted_at IS NULL
       ORDER BY at ASC`,
      sessionIds,
    );
    const venueRows = await this.driver.all<VenueRow>(
      `SELECT v.*, (SELECT COUNT(*) FROM sessions s
                     WHERE s.venue_id = v.id AND s.deleted_at IS NULL) AS session_count
       FROM venues v
       WHERE v.id IN (${venueIds.map(() => '?').join(',')}) AND v.deleted_at IS NULL`,
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
          `SELECT id FROM venues
           WHERE id IN (${venueIds.map(() => '?').join(',')}) AND deleted_at IS NULL`,
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
      // `deleted_at` is redundant beside the key check, since tombstoning a
      // session clears its key, and it is here so that the guarantee reads as
      // one query rather than as two facts a reader has to hold at once.
      `SELECT import_key FROM sessions WHERE import_key IS NOT NULL AND deleted_at IS NULL`,
    );
    return rows.map((row) => row.import_key);
  }

  private async insertSession(session: Session): Promise<void> {
    await this.driver.run(
      `INSERT INTO sessions (
         id, venue_id, format, game_type, small_blind, big_blind, ante, currency,
         buy_in, fee, cash_out, entrants, finish_position, started_at, ended_at,
         notes, import_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.venueId,
        session.format,
        session.gameType,
        session.stakes?.smallBlind ?? 0,
        session.stakes?.bigBlind ?? 0,
        session.stakes?.ante ?? null,
        session.currency,
        session.buyIn,
        session.fee,
        session.cashOut,
        session.entrants,
        session.finishPosition,
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
      `UPDATE sessions SET venue_id = ?, format = ?, game_type = ?, small_blind = ?,
         big_blind = ?, ante = ?, currency = ?, buy_in = ?, fee = ?, cash_out = ?,
         entrants = ?, finish_position = ?, started_at = ?, ended_at = ?,
         notes = ?, updated_at = ? WHERE id = ?`,
      [
        session.venueId,
        session.format,
        session.gameType,
        session.stakes?.smallBlind ?? 0,
        session.stakes?.bigBlind ?? 0,
        session.stakes?.ante ?? null,
        session.currency,
        session.buyIn,
        session.fee,
        session.cashOut,
        session.entrants,
        session.finishPosition,
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
    // Children are tombstoned explicitly rather than left to ON DELETE CASCADE,
    // which no longer fires at all now that nothing is removed. They take the
    // same stamp as the parent so that a merge cannot revive a hand whose
    // session is gone by finding it a millisecond fresher.
    const now = this.ctx.clock.now();
    await this.driver.transaction(async () => {
      for (const table of ['rebuys', 'hands', 'mood_entries']) {
        await this.driver.run(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?
           WHERE session_id = ? AND deleted_at IS NULL`,
          [now, now, id],
        );
      }
      // `import_key` goes with it: deleting an imported session has always made
      // it importable again, and a tombstone holding the key in the unique
      // index would quietly end that.
      await this.driver.run(
        `UPDATE sessions SET deleted_at = ?, updated_at = ?, import_key = NULL
         WHERE id = ? AND deleted_at IS NULL`,
        [now, now, id],
      );
    });
  }

  // ---------------------------------------------------------------- rebuys

  async listRebuys(sessionId: string): Promise<Rebuy[]> {
    const rows = await this.driver.all<RebuyRow>(
      `SELECT * FROM rebuys WHERE session_id = ? AND deleted_at IS NULL ORDER BY at ASC`,
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
    const now = this.ctx.clock.now();
    await this.driver.run(
      `UPDATE rebuys SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
  }

  // ----------------------------------------------------------------- hands

  async listHands(sessionId?: string): Promise<Hand[]> {
    const rows =
      sessionId === undefined
        ? await this.driver.all<HandRow>(
            `SELECT * FROM hands WHERE deleted_at IS NULL ORDER BY at DESC`,
          )
        : await this.driver.all<HandRow>(
            `SELECT * FROM hands WHERE session_id = ? AND deleted_at IS NULL ORDER BY at DESC`,
            [sessionId],
          );
    return rows.map(toHand);
  }

  async getHand(id: string): Promise<Hand | null> {
    const row = await first<HandRow>(
      this.driver,
      `SELECT * FROM hands WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
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
    const now = this.ctx.clock.now();
    await this.driver.run(
      `UPDATE hands SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
  }

  // ------------------------------------------------------------------ mood

  async listMoodEntries(sessionId?: string): Promise<MoodEntry[]> {
    const rows =
      sessionId === undefined
        ? await this.driver.all<MoodRow>(
            `SELECT * FROM mood_entries WHERE deleted_at IS NULL ORDER BY at DESC`,
          )
        : await this.driver.all<MoodRow>(
            `SELECT * FROM mood_entries
             WHERE session_id = ? AND deleted_at IS NULL ORDER BY at DESC`,
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
    const now = this.ctx.clock.now();
    await this.driver.run(
      `UPDATE mood_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
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
