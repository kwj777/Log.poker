/**
 * Writing CSV, which is the mirror of `src/domain/import/csv.ts` reading it.
 *
 * The two belong together and are apart, which is worth saying out loud: the
 * parser is generous because it is given files somebody else's software wrote,
 * and the writer is strict because the file it produces is ours. What holds
 * them to each other is a round-trip test rather than shared code -- a writer
 * built out of the parser's internals would agree with it about a bug.
 *
 * ## What it quotes, and why it does not quote less
 *
 * A field is quoted when it holds a delimiter, a quote, a newline or a leading
 * or trailing space, per RFC 4180, and the quotes inside it are doubled. The
 * space rule is the one that is easy to leave out: a trailing space survives a
 * round trip through this and gets eaten by half the spreadsheets that will
 * open the file, so it is quoted to keep what somebody typed.
 *
 * ## CRLF
 *
 * Excel on Windows still wants it, the parser here reads either, and every
 * other reader has coped for twenty years. It is the safer of the two.
 *
 * ## The BOM
 *
 * Written by `toCsvFile`, not by `toCsv`. Excel reads a UTF-8 file as the
 * local code page without one, which turns a venue called "Café" into
 * something else in the one program most players will open this in. Anything
 * parsing the text itself gets it without, because a BOM in the middle of a
 * string is just a character.
 */

/** What everything below is separated by. Not configurable, on purpose. */
export const DELIMITER = ',';

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

const cell = (value: string): string =>
  NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** One row, already stringified. */
export const toCsvRow = (values: readonly string[]): string =>
  values.map(cell).join(DELIMITER);

/**
 * A header and its rows, as text.
 *
 * Ends with a newline, because a file that does not is a file whose last row
 * some readers drop and others keep.
 */
export const toCsv = (headers: readonly string[], rows: readonly (readonly string[])[]): string =>
  [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n') + '\r\n';

/** The same thing, with the byte order mark Excel needs. See above. */
export const toCsvFile = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string => `﻿${toCsv(headers, rows)}`;
