/**
 * A CSV/TSV reader.
 *
 * Log has no backend, so the only way an online player's history gets in here is
 * a file they exported themselves -- from PokerTracker, Holdem Manager,
 * PokerCraft, or a spreadsheet they have kept by hand for years. Those files
 * disagree about almost everything: the delimiter, the quoting, the line
 * endings, whether there is a byte-order mark on the front.
 *
 * So this is a real RFC 4180 parser rather than `text.split(',')`. A split
 * breaks on the first session note containing a comma, and it breaks silently --
 * every column after it shifts by one and the import lands wrong data rather
 * than failing. The state machine below cannot do that.
 *
 * Pure and platform-free: no React, no storage, no file system. The caller
 * supplies a string from wherever it got one.
 */

/** One parsed record, with the line it started on so warnings can point at it. */
export interface CsvRow {
  /** 1-based line number in the source text. */
  line: number;
  cells: string[];
}

export interface CsvTable {
  /** The first non-empty record. Never null -- an empty source yields `[]`. */
  header: string[];
  rows: CsvRow[];
  delimiter: string;
}

/**
 * Candidates in preference order. Comma first because it is the default
 * everywhere; semicolon because that is what a European locale exports when the
 * decimal separator is already a comma; tab because that is what a paste out of
 * a spreadsheet is.
 */
export const DELIMITERS = [',', '\t', ';', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

const stripBom = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

/** Normalize CRLF and lone-CR line endings so the parser only sees `\n`. */
const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

/**
 * Count unquoted delimiters in the first physical line.
 *
 * Sniffing on one line rather than parsing the whole file with each candidate is
 * deliberate: a header field containing a literal newline does not happen, and
 * scanning the file four times to find out would.
 */
const countInHeaderLine = (line: string, delimiter: string): number => {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      count += 1;
    }
  }
  return count;
};

/**
 * Pick the delimiter that splits the header into the most columns.
 *
 * Ties go to the earlier candidate, which is why `DELIMITERS` is ordered. A
 * single-column file has no delimiter to find, so it falls back to a comma and
 * parses as one column -- which is what the caller should report on, rather than
 * this function guessing something more interesting.
 */
export const sniffDelimiter = (text: string): Delimiter => {
  const firstLine = normalizeNewlines(stripBom(text)).split('\n').find((line) => line.trim() !== '');
  if (firstLine === undefined) return ',';

  let best: Delimiter = ',';
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    const count = countInHeaderLine(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Parse `text` into records.
 *
 * Quoting follows RFC 4180: a field that opens with `"` runs until the closing
 * quote, `""` inside it is a literal quote, and delimiters and newlines inside
 * it are data. A quote anywhere other than the start of a field is a literal
 * character -- spreadsheets emit `5" pot` unquoted and rejecting the file over it
 * would be pedantry.
 *
 * Blank lines are skipped rather than yielding an empty record, because trackers
 * pad their exports with them. A quoted empty field (`""`) on its own line is
 * kept: it was written deliberately.
 */
export const parseCsv = (text: string, delimiter: string = sniffDelimiter(text)): CsvTable => {
  const source = normalizeNewlines(stripBom(text));
  const rows: CsvRow[] = [];

  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let quotedAnywhere = false;
  let line = 1;
  let rowLine = 1;

  const endField = () => {
    cells.push(field);
    field = '';
  };

  const endRow = () => {
    endField();
    const blank = cells.length === 1 && cells[0] === '' && !quotedAnywhere;
    if (!blank) rows.push({ line: rowLine, cells });
    cells = [];
    quotedAnywhere = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      quotedAnywhere = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === '\n') {
      endRow();
      line += 1;
      rowLine = line;
      continue;
    }
    field += char;
  }

  // A file that does not end in a newline still has a final record.
  if (field !== '' || cells.length > 0 || quotedAnywhere) endRow();

  const [header, ...body] = rows;
  return {
    header: header ? header.cells.map((cell) => cell.trim()) : [],
    rows: body,
    delimiter,
  };
};

/**
 * Read a cell by column index, tolerating a ragged row.
 *
 * Exports are ragged more often than they should be -- a trailing empty column
 * dropped here, an extra delimiter in a note there. A missing cell reads as
 * empty, which every downstream parser already treats as "not provided".
 */
export const cellAt = (row: CsvRow, index: number | undefined): string =>
  index === undefined ? '' : (row.cells[index] ?? '').trim();
