/**
 * Session-summary import.
 *
 * Log is a live-poker journal: a venue, a buy-in, a cash-out, and the hours in
 * between, all typed by a player sitting at a table. An online player has that
 * same history already — their site or their tracker wrote it down for them —
 * and no way to get it in here without typing out a year of sessions by hand.
 *
 * This reads a session-summary export and turns it into sessions. It does not
 * read hand histories: a hand history is an action-level record of one hand, and
 * Log's `Hand` is a journal entry *about* a hand, so there is nothing to import
 * into. Session summaries are the level the two products actually share.
 *
 * Two invariants hold for everything this produces, and both matter downstream:
 *
 * 1. **Imported sessions are always complete** — `cashOut` and `endedAt` are
 *    never null. A session with a null `endedAt` is what Log calls the *active*
 *    session, and it allows exactly one; importing 200 rows that each claim to
 *    be live would break the app rather than fill it.
 * 2. **Nothing is invented.** A row with no stakes gets zero blinds, not a
 *    plausible-looking `$1/$2`; a row with no duration ends when it started.
 *    Both degrade honestly: `toObservations` in `variance.ts` already drops
 *    sessions with no measurable duration or a zero big blind, so they count
 *    toward the bankroll curve and stay out of a win-rate estimate they would
 *    poison. Every one of those rows produces a warning saying so.
 */

import { DEFAULT_CURRENCY, stakesKey } from '../money';
import type { Cents, GameType, Stakes, Timestamp } from '../types';
import { cellAt, parseCsv, type CsvRow } from './csv';
import { resolveColumns, type ColumnMap } from './columns';
import {
  detectDateOrder,
  durationUnitFromHeader,
  hasAmbiguousDateShape,
  parseCurrency,
  parseDurationMs,
  parseGameType,
  parseMoney,
  parseStakes,
  parseTimestamp,
  type DateOrder,
} from './values';

/** Where an online session lands when the file does not name a site. */
export const DEFAULT_VENUE_NAME = 'Online';

export interface ImportWarning {
  /** Source line, or null when the warning is about the file as a whole. */
  line: number | null;
  message: string;
}

/**
 * A session ready to be written, minus the venue id — which does not exist yet,
 * because venues are created from the names in the file at import time.
 */
export interface ImportedSessionDraft {
  gameType: GameType;
  stakes: Stakes;
  buyIn: Cents;
  cashOut: Cents;
  startedAt: Timestamp;
  endedAt: Timestamp;
  notes: string | null;
}

export interface ImportedSession {
  /**
   * Stable identity for this row, stored on the session so that importing the
   * same export again — next month, with three new sessions on the end — adds
   * the three and skips the rest.
   *
   * Deliberately the row's own values joined together rather than a hash: it is
   * short enough already, it never collides, and when something does go wrong it
   * can be read straight out of the database.
   */
  importKey: string;
  venueName: string;
  /** Source line, so a warning and a preview row can point at the same place. */
  line: number;
  draft: ImportedSessionDraft;
}

export interface SessionImportOptions {
  /** Used when neither a currency column nor the money cells name one. */
  defaultCurrency?: string;
  /** Used when the file has no site column. */
  defaultVenue?: string;
  /** Forces day-first or month-first instead of inferring it from the column. */
  dateOrder?: DateOrder;
}

export interface SessionImportResult {
  sessions: ImportedSession[];
  warnings: ImportWarning[];
  /** Set when the file could not be read at all; `sessions` is then empty. */
  error: string | null;
  headers: string[];
  columns: ColumnMap | null;
  delimiter: string;
  dateOrder: DateOrder;
  /** False when the dates could be read two ways and the file never settled it. */
  dateOrderCertain: boolean;
  /** Rows that produced no session. */
  skipped: number;
}

const importKeyFor = (venueName: string, draft: ImportedSessionDraft): string =>
  [
    'csv',
    draft.startedAt,
    venueName.trim().toLowerCase().replace(/\|/g, '/'),
    stakesKey(draft.stakes),
    draft.buyIn,
    draft.cashOut,
  ].join('|');

const isBlankRow = (row: CsvRow): boolean => row.cells.every((cell) => cell.trim() === '');

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Read a CSV or TSV of session summaries.
 *
 * Pure: it takes a string and returns a description of what is in it. Nothing is
 * written, no venue is created, and the caller is expected to show the result to
 * the player before any of that happens — an import that silently rewrites a
 * bankroll is not one anybody would run twice.
 */
export const parseSessionCsv = (
  text: string,
  options: SessionImportOptions = {},
): SessionImportResult => {
  const defaultCurrency = options.defaultCurrency ?? DEFAULT_CURRENCY;
  const defaultVenue = options.defaultVenue?.trim() || DEFAULT_VENUE_NAME;
  const table = parseCsv(text);

  const base: Omit<SessionImportResult, 'error'> = {
    sessions: [],
    warnings: [],
    headers: table.header,
    columns: null,
    delimiter: table.delimiter,
    dateOrder: options.dateOrder ?? 'mdy',
    dateOrderCertain: true,
    skipped: 0,
  };

  if (table.header.length === 0) {
    return { ...base, error: 'That file is empty — there is no header row to read.' };
  }

  const columns = resolveColumns(table.header);
  const { indexes } = columns;
  const withColumns = { ...base, columns };

  if (table.rows.length === 0) {
    return { ...withColumns, error: 'That file has a header row but no sessions under it.' };
  }
  if (indexes.startedAt === undefined) {
    return {
      ...withColumns,
      error:
        'No date column. Log needs to know when each session happened — a column called “Date”, “Start” or “Session date” will do.',
    };
  }
  if (indexes.cashOut === undefined && indexes.result === undefined) {
    return {
      ...withColumns,
      error:
        'No result column. Add a “Result” column holding each session’s profit or loss, or a “Cash-out” column alongside a “Buy-in”.',
    };
  }
  if (indexes.result === undefined && indexes.buyIn === undefined) {
    return {
      ...withColumns,
      error:
        'Found a cash-out column but no buy-in and no result, so there is no way to tell profit from money moved. Add either of those columns.',
    };
  }

  const warnings: ImportWarning[] = [];
  const warn = (line: number | null, message: string) => warnings.push({ line, message });

  const dateSamples = table.rows
    .filter((row) => !isBlankRow(row))
    .map((row) => cellAt(row, indexes.startedAt));
  const detected = detectDateOrder(dateSamples);
  const dateOrder = options.dateOrder ?? (detected === 'unknown' ? 'mdy' : detected);
  const dateOrderCertain = options.dateOrder !== undefined || detected !== 'unknown';

  if (!dateOrderCertain && hasAmbiguousDateShape(dateSamples)) {
    warn(
      null,
      'Dates like 03/04/2024 could be March 4th or the 3rd of April, and nothing in this file settles it. They are being read month-first.',
    );
  }

  const durationUnit = durationUnitFromHeader(columns.matched.duration ?? '');

  const sessions: ImportedSession[] = [];
  let skipped = 0;
  let noStakes = 0;
  let noDuration = 0;
  let missingBuyIn = 0;

  for (const row of table.rows) {
    if (isBlankRow(row)) continue;

    const dateCell = cellAt(row, indexes.startedAt);
    const startedAt = parseTimestamp(dateCell, dateOrder);
    if (startedAt === null) {
      skipped += 1;
      warn(row.line, `Couldn’t read the date “${dateCell}”, so this row was skipped.`);
      continue;
    }

    const buyInCell = parseMoney(cellAt(row, indexes.buyIn));
    const cashOutCell = parseMoney(cellAt(row, indexes.cashOut));
    const resultCell = parseMoney(cellAt(row, indexes.result));

    const currency =
      parseCurrency(cellAt(row, indexes.currency)) ??
      buyInCell?.currency ??
      cashOutCell?.currency ??
      resultCell?.currency ??
      defaultCurrency;

    // A cash-out column is the direct measurement; a result column is derived
    // from one, so it only fills in where the first is absent.
    let buyIn = buyInCell?.cents ?? 0;
    let cashOut: number | null;
    if (cashOutCell !== null) {
      cashOut = cashOutCell.cents;
    } else if (resultCell !== null) {
      if (buyInCell === null && resultCell.cents < 0) {
        // Nothing says what went on the table, but a loss entails at least as
        // much as was lost — that is entailed, not invented. Booking it keeps
        // the net exact and both figures readable: a cash-out of minus forty
        // is not a thing that happens.
        buyIn = -resultCell.cents;
        cashOut = 0;
      } else {
        cashOut = buyIn + resultCell.cents;
      }
    } else {
      cashOut = null;
    }

    if (cashOut === null) {
      skipped += 1;
      warn(row.line, 'No result or cash-out on this row, so it was skipped.');
      continue;
    }
    if (indexes.buyIn !== undefined && buyInCell === null) missingBuyIn += 1;

    let endedAt = parseTimestamp(cellAt(row, indexes.endedAt), dateOrder);
    if (endedAt === null && indexes.duration !== undefined) {
      const elapsed = parseDurationMs(cellAt(row, indexes.duration), durationUnit);
      if (elapsed !== null) endedAt = startedAt + elapsed;
    }
    if (endedAt === null) {
      endedAt = startedAt;
      noDuration += 1;
    } else if (endedAt < startedAt) {
      warn(row.line, 'The end time is before the start time; this session was given no duration.');
      endedAt = startedAt;
      noDuration += 1;
    }

    const stakesCell = cellAt(row, indexes.stakes);
    const stakes = parseStakes(stakesCell, currency);
    if (stakes === null) noStakes += 1;

    const venueCell = cellAt(row, indexes.venue);
    const venueName = venueCell === '' ? defaultVenue : venueCell;
    const notes = cellAt(row, indexes.notes);

    const draft: ImportedSessionDraft = {
      gameType: parseGameType(cellAt(row, indexes.gameType)) ?? 'OTHER',
      stakes: stakes ?? { smallBlind: 0, bigBlind: 0, currency },
      buyIn,
      cashOut,
      startedAt,
      endedAt,
      notes: notes === '' ? null : notes,
    };

    sessions.push({ importKey: importKeyFor(venueName, draft), venueName, line: row.line, draft });
  }

  // Two rows can be genuinely identical — a daily export with no times, played
  // twice at the same stakes for the same result. Numbering the repeats keeps
  // the file self-consistent while re-importing it still matches row for row.
  const seen = new Map<string, number>();
  for (const session of sessions) {
    const count = (seen.get(session.importKey) ?? 0) + 1;
    seen.set(session.importKey, count);
    if (count > 1) session.importKey = `${session.importKey}#${count}`;
  }

  if (indexes.buyIn === undefined) {
    warn(
      null,
      'No buy-in column, so only each session’s net result is known. Profit and the bankroll curve are exact; the “invested” totals are understated.',
    );
  }
  if (missingBuyIn > 0) {
    warn(null, `${plural(missingBuyIn, 'row')} had no buy-in, so the whole cash-out counts as profit.`);
  }
  if (noStakes > 0) {
    warn(
      null,
      `${plural(noStakes, 'session')} had no readable stakes. They count toward profit and the bankroll curve, but the variance view skips them — it works in big blinds and cannot place a session without them.`,
    );
  }
  if (noDuration > 0) {
    warn(
      null,
      `${plural(noDuration, 'session')} had no duration. They count toward profit, but not toward hours played, hourly rate or variance.`,
    );
  }
  if (columns.duplicates.length > 0) {
    const listed = columns.duplicates.map((entry) => `“${entry.header}”`).join(', ');
    warn(null, `Ignored ${listed} — an earlier column already supplied the same field.`);
  }

  return {
    ...withColumns,
    sessions,
    warnings,
    dateOrder,
    dateOrderCertain,
    skipped,
    error: sessions.length === 0 ? 'Nothing in that file could be read as a session.' : null,
  };
};
