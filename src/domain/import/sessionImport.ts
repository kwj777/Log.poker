/**
 * Session-summary import.
 *
 * Log is a live-poker journal: a venue, a buy-in, a cash-out, and the hours in
 * between, all typed by a player sitting at a table. An online player has that
 * same history already -- their site or their tracker wrote it down for them --
 * and no way to get it in here without typing out a year of sessions by hand.
 *
 * This reads a session-summary export and turns it into sessions. It does not
 * read hand histories: a hand history is an action-level record of one hand, and
 * Log's `Hand` is a journal entry *about* a hand, so there is nothing to import
 * into. Session summaries are the level the two products actually share.
 *
 * Two invariants hold for everything this produces, and both matter downstream:
 *
 * 1. **Imported sessions are always complete** -- `cashOut` and `endedAt` are
 *    never null. A session with a null `endedAt` is what Log calls the *active*
 *    session, and it allows exactly one; importing 200 rows that each claim to
 *    be live would break the app rather than fill it.
 * 2. **Nothing is invented.** A row with no stakes gets no stakes, not a
 *    plausible-looking `$1/$2`; a row with no duration ends when it started.
 *    Both degrade honestly: `toObservations` in `variance.ts` already drops
 *    sessions with no measurable duration and sessions with no blinds, so they
 *    count toward the bankroll curve and stay out of a win-rate estimate they
 *    would poison. Every one of those rows produces a warning saying so.
 *
 * Tournaments come in through the same door. A row is read as one when the file
 * says so or when it carries something only a tournament has -- an entry fee, a
 * field size, a finishing position -- and it lands with no stakes at all, which
 * keeps it out of the cash-game variance model by the same rule.
 */

import { isAhead } from '../clock';
import { DEFAULT_CURRENCY, stakesKey } from '../money';
import type { Cents, GameType, SessionFormat, Stakes, Timestamp } from '../types';
import { cellAt, parseCsv, type CsvRow } from './csv';
import { resolveColumns, type ColumnMap } from './columns';
import {
  detectDateOrder,
  durationUnitFromHeader,
  cashOutNamesAPrize,
  feeNamesAnEntry,
  hasAmbiguousDateShape,
  parseCount,
  parseCurrency,
  parseDurationMs,
  parseGameType,
  parseMoney,
  parseSessionFormat,
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
 * A session ready to be written, minus the venue id -- which does not exist yet,
 * because venues are created from the names in the file at import time.
 */
export interface ImportedSessionDraft {
  format: SessionFormat;
  gameType: GameType;
  stakes: Stakes | null;
  currency: string;
  buyIn: Cents;
  fee: Cents | null;
  cashOut: Cents;
  entrants: number | null;
  finishPosition: number | null;
  startedAt: Timestamp;
  endedAt: Timestamp;
  notes: string | null;
}

export interface ImportedSession {
  /**
   * Stable identity for this row, stored on the session so that importing the
   * same export again -- next month, with three new sessions on the end -- adds
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

/**
 * What a parsed row will be worth once it is a session.
 *
 * The preview card's whole job is to be the number the player gets, so the
 * arithmetic has to be the app's rather than the screen's. It was
 * `cashOut - buyIn` written out inline, which leaves the tournament entry fee
 * on the table -- `totalInvested` takes it off everywhere else, and the
 * Variance tab gives it a tile of its own labeled "never coming back". A year
 * of $100+$10 tournaments previewed a whole fee column better than it landed,
 * and always in the flattering direction.
 *
 * No rebuys in the subtraction because an import makes none: the row is one
 * line with one buy-in on it.
 */
export const draftNet = (draft: ImportedSessionDraft): Cents =>
  draft.cashOut - draft.buyIn - (draft.fee ?? 0);

export interface SessionImportOptions {
  /** Used when neither a currency column nor the money cells name one. */
  defaultCurrency?: string;
  /** Used when the file has no site column. */
  defaultVenue?: string;
  /** Forces day-first or month-first instead of inferring it from the column. */
  dateOrder?: DateOrder;
  /** Now, for the future-date guard. Defaults to the wall clock; tests pass their own. */
  now?: number;
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
  /**
   * False when the dates could be read two ways and the file never settled
   * it. A column with no two-way reading in it -- ISO, or a day past the
   * twelfth anywhere in it -- is certain whether or not anything was detected.
   */
  dateOrderCertain: boolean;
  /** Rows that produced no session. */
  skipped: number;
}

/**
 * The cash-game shape here is frozen.
 *
 * Every session imported before tournaments existed carries a key in exactly
 * this form, and a key that no longer matches turns the next import of an
 * unchanged file into a file full of new sessions -- the one failure this key
 * exists to prevent. So a cash row still writes the `<currency>:0/0` that those
 * versions wrote for a session whose blinds could not be read, even though the
 * blinds are now honestly null rather than zero.
 *
 * Tournaments are new, so they are free to say what they are.
 */
const importKeyFor = (venueName: string, draft: ImportedSessionDraft): string => {
  const venue = venueName.trim().toLowerCase().replace(/\|/g, '/');
  if (draft.format === 'tournament') {
    return [
      'csv',
      'tournament',
      draft.startedAt,
      venue,
      draft.currency,
      draft.buyIn,
      draft.fee ?? 0,
      draft.cashOut,
    ].join('|');
  }
  const level =
    draft.stakes === null ? `${draft.currency}:0/0` : stakesKey(draft.stakes, draft.currency);
  return ['csv', draft.startedAt, venue, level, draft.buyIn, draft.cashOut].join('|');
};

const isBlankRow = (row: CsvRow): boolean => row.cells.every((cell) => cell.trim() === '');

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Read a CSV or TSV of session summaries.
 *
 * Pure but for the clock, which one guard needs: a date that has not happened
 * is a typed year, and telling requires knowing what now is. `options.now`
 * supplies it, defaulting to the wall clock, which is the same shape `isAhead`
 * and `formatRelativeDay` take.
 *
 * Nothing is written, no venue is created, and the caller is expected to show
 * the result to the player before any of that happens -- an import that
 * silently rewrites a bankroll is not one anybody would run twice.
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
    return { ...base, error: 'That file is empty: there is no header row to read.' };
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
        'No date column. Log needs to know when each session happened: a column called “Date”, “Start” or “Session date” will do.',
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
  const now = options.now ?? Date.now();

  const dateSamples = table.rows
    .filter((row) => !isBlankRow(row))
    .map((row) => cellAt(row, indexes.startedAt));
  const detected = detectDateOrder(dateSamples);
  const dateOrder = options.dateOrder ?? (detected === 'unknown' ? 'mdy' : detected);
  // One reading of the column, used twice, because the toggle and the warning
  // were answering the same question differently. `detectDateOrder` says
  // `unknown` for an ISO column -- there is nothing to detect, the year is at
  // the front -- and that alone used to make the file uncertain. So Log's own
  // export arrived with no warning, which is right, under a "Dates are
  // day-first" chip, which is not: the file had already answered, and the
  // toggle could not change a thing it parsed either way.
  const ambiguous = hasAmbiguousDateShape(dateSamples);
  const dateOrderCertain =
    options.dateOrder !== undefined || detected !== 'unknown' || !ambiguous;

  if (!dateOrderCertain) {
    warn(
      null,
      'Dates like 03/04/2024 could be March 4th or the 3rd of April, and nothing in this file settles it. They are being read month-first.',
    );
  }

  const durationUnit = durationUnitFromHeader(columns.matched.duration ?? '');
  const feeIsAnEntry = feeNamesAnEntry(columns.matched.fee ?? '');
  const cashOutIsAPrize = cashOutNamesAPrize(columns.matched.cashOut ?? '');

  const sessions: ImportedSession[] = [];
  let skipped = 0;
  let noStakes = 0;
  let noDuration = 0;
  let missingBuyIn = 0;
  let tournaments = 0;
  // Split by what gave them away, so the warning can say which column did it.
  let inferredFromField = 0;
  let inferredFromFee = 0;

  for (const row of table.rows) {
    if (isBlankRow(row)) continue;

    const dateCell = cellAt(row, indexes.startedAt);
    const startedAt = parseTimestamp(dateCell, dateOrder);
    if (startedAt === null) {
      skipped += 1;
      warn(row.line, `Couldn’t read the date “${dateCell}”, so this row was skipped.`);
      continue;
    }

    // The rule the three typed screens already keep, kept here too. `isAhead`
    // exists because "2062-09-19 for 2026-09-19 parses, is a real date, and
    // used to be accepted in silence", and every screen a player types a date
    // into refuses one. The importer took it: `deriveDefaults` then opened
    // every later session from it, `assessRecentStretch` called it permanently
    // recent, and the bankroll curve got a point decades out that flattened
    // everything real into the left edge.
    //
    // Skipped rather than warned-and-kept, for the same reason those screens
    // refuse rather than confirm: there is no reading of a year forty years
    // out that is the session somebody played.
    if (isAhead(startedAt, now)) {
      skipped += 1;
      warn(row.line, `“${dateCell}” has not happened yet, so this row was skipped. Check the year.`);
      continue;
    }

    const buyInCell = parseMoney(cellAt(row, indexes.buyIn));
    const cashOutCell = parseMoney(cellAt(row, indexes.cashOut));
    const resultCell = parseMoney(cellAt(row, indexes.result));
    const feeCell = parseMoney(cellAt(row, indexes.fee));
    const stakesCell = cellAt(row, indexes.stakes);

    const currency =
      parseCurrency(cellAt(row, indexes.currency)) ??
      buyInCell?.currency ??
      cashOutCell?.currency ??
      resultCell?.currency ??
      parseCurrency(stakesCell) ??
      defaultCurrency;

    const entrants = parseCount(cellAt(row, indexes.entrants));
    const finishPosition = parseCount(cellAt(row, indexes.finishPosition));

    // What the file says, and failing that what it implies: a field size or a
    // finishing position only mean anything in a tournament, and so does a fee
    // column that names an *entry* fee.
    //
    // A fee alone used to be enough, and it was the wrong signal: `rake` is one
    // of this field's aliases and a rake column is ordinary in online cash
    // exports, which mostly carry no format column. See `feeNamesAnEntry`.
    const impliedByFee = (feeCell !== null && feeIsAnEntry) || cashOutIsAPrize;
    const impliedByField = entrants !== null || finishPosition !== null;
    const stated = parseSessionFormat(cellAt(row, indexes.format));
    const format: SessionFormat = stated ?? (impliedByField || impliedByFee ? 'tournament' : 'cash');
    const tournament = format === 'tournament';
    if (tournament && stated === null) {
      if (impliedByField) inferredFromField += 1;
      else inferredFromFee += 1;
    }

    // A cash-out column is the direct measurement; a result column is derived
    // from one, so it only fills in where the first is absent.
    //
    // **The entry fee is part of what the result was measured against.** A
    // file reporting a profit has already taken the fee off it, so a cash-out
    // rebuilt as buy-in plus result leaves the fee to be subtracted a second
    // time by `netResult`, which is `cashOut - (buyIn + fee + rebuys)`. Every
    // tournament row from a results-only export landed short by exactly its
    // fee: a $100+$10 that the file says made $50 stored as +$40. The losing
    // rows were worse, since `buyIn + result` goes negative and books a prize
    // nobody was ever paid.
    const entryFee = tournament ? (feeCell?.cents ?? 0) : 0;
    let buyIn = buyInCell?.cents ?? 0;
    let cashOut: number | null;
    if (cashOutCell !== null) {
      cashOut = cashOutCell.cents;
    } else if (resultCell !== null) {
      if (buyInCell === null && resultCell.cents < 0) {
        // Nothing says what went on the table, but a loss entails at least as
        // much as was lost -- that is entailed, not invented. Booking it keeps
        // the net exact and both figures readable: a cash-out of minus forty
        // is not a thing that happens. The fee is part of that cost where the
        // file named one, so it comes out of the buy-in rather than being
        // added on top of a total the result already fixes.
        buyIn = Math.max(0, -resultCell.cents - entryFee);
        cashOut = 0;
      } else {
        cashOut = buyIn + entryFee + resultCell.cents;
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
    } else if (endedAt < startedAt) {
      warn(row.line, 'The end time is before the start time; this session was given no duration.');
      endedAt = startedAt;
    }
    // Counted on the outcome rather than inside the two branches above, so the
    // third way of getting here is counted too: an end that parses to exactly
    // the start. That is the ordinary shape of a spreadsheet whose date
    // columns carry no time of day, and of any duration cell holding 0 or
    // 0:00, since `parseDurationMs` reads those as zero rather than as
    // nothing. Those rows landed with no hours and no warning, so their profit
    // went into the dashboard while their hours did not, and the one sentence
    // that would have explained the hourly rate moving never appeared.
    if (endedAt <= startedAt) noDuration += 1;

    // A tournament has no blinds, so an unreadable stakes cell is only worth
    // counting against a cash game -- where it is the difference between
    // reaching the variance view and not.
    const stakes = tournament ? null : parseStakes(stakesCell);
    if (!tournament && stakes === null) noStakes += 1;
    if (tournament) tournaments += 1;

    const venueCell = cellAt(row, indexes.venue);
    const venueName = venueCell === '' ? defaultVenue : venueCell;
    const notes = cellAt(row, indexes.notes);

    const draft: ImportedSessionDraft = {
      format,
      gameType: parseGameType(cellAt(row, indexes.gameType)) ?? 'OTHER',
      stakes,
      currency,
      buyIn,
      fee: tournament ? (feeCell?.cents ?? null) : null,
      cashOut,
      entrants: tournament ? entrants : null,
      finishPosition: tournament ? finishPosition : null,
      startedAt,
      endedAt,
      notes: notes === '' ? null : notes,
    };

    sessions.push({ importKey: importKeyFor(venueName, draft), venueName, line: row.line, draft });
  }

  // Two rows can be genuinely identical -- a daily export with no times, played
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
      `${plural(noStakes, 'cash session')} had no readable stakes. They count toward profit and the bankroll curve, but the variance view skips them: it works in big blinds and cannot place a session without them.`,
    );
  }
  if (tournaments > 0) {
    // Named, not just counted. A row read as a tournament loses its stakes and
    // drops out of the variance view, and the old warning said that had
    // happened without ever saying which column decided it -- so a file that
    // guessed wrong gave the player nothing to act on.
    const sentences = [
      `${plural(tournaments, 'row')} read as a tournament.`,
      'Tournaments land in your bankroll and in the tournament figures, and stay out of the cash-game variance view: their results are the wrong shape for it.',
    ];
    if (inferredFromField > 0) {
      sentences.push(
        `${plural(inferredFromField, 'row')} gave itself away with a field size or a finishing position.`,
      );
    } else if (inferredFromFee > 0) {
      sentences.push(
        `Nothing in the file says so outright: ${plural(inferredFromFee, 'row')} was read that way because “${
          cashOutIsAPrize ? columns.matched.cashOut : (columns.matched.fee ?? 'fee')
        }” is a tournament column.`,
      );
    }
    if (inferredFromField + inferredFromFee > 0) {
      sentences.push(
        'If that is wrong, add a column saying “Cash” or “Tournament” and import again.',
      );
    }
    warn(null, sentences.join(' '));
  }
  if (noDuration > 0) {
    warn(
      null,
      `${plural(noDuration, 'session')} had no duration. They count toward profit, but not toward hours played, hourly rate or variance.`,
    );
  }
  if (columns.duplicates.length > 0) {
    const listed = columns.duplicates.map((entry) => `“${entry.header}”`).join(', ');
    warn(null, `Ignored ${listed}: an earlier column already supplied the same field.`);
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
