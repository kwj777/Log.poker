/**
 * Writing CSV, and reading back what was written.
 *
 * The writer and the parser are separate code on purpose -- one is generous
 * because it is handed somebody else's file, the other is strict because the
 * file is ours -- so what holds them together is this: everything written here
 * is parsed back with the real parser and compared to what went in.
 */

import { parseCsv } from '../../import/csv';
import { toCsv, toCsvFile, toCsvRow } from '../csv';

describe('quoting', () => {
  it('leaves an ordinary value alone', () => {
    expect(toCsvRow(['Aria', 'NLHE', '300'])).toBe('Aria,NLHE,300');
  });

  it('quotes a value holding the delimiter', () => {
    expect(toCsvRow(['Bellagio, room 2'])).toBe('"Bellagio, room 2"');
  });

  it('doubles a quote, and quotes what holds it', () => {
    expect(toCsvRow(['he said "nice hand"'])).toBe('"he said ""nice hand"""');
  });

  it('quotes a value holding a newline, so one row stays one row', () => {
    expect(toCsvRow(['two\nlines'])).toBe('"two\nlines"');
  });

  it('quotes a leading or trailing space, which a spreadsheet would eat', () => {
    expect(toCsvRow([' padded '])).toBe('" padded "');
    expect(toCsvRow(['inner space'])).toBe('inner space');
  });

  it('writes an empty cell as nothing rather than as two quotes', () => {
    expect(toCsvRow(['a', '', 'b'])).toBe('a,,b');
  });
});

describe('the file', () => {
  it('separates rows with CRLF and ends with one', () => {
    expect(toCsv(['a'], [['1'], ['2']])).toBe('a\r\n1\r\n2\r\n');
  });

  it('writes a header and no rows, which is an empty log rather than an empty file', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });

  it('carries a byte order mark, because Excel reads UTF-8 as the code page without one', () => {
    expect(toCsvFile(['Venue'], [['Café']]).charCodeAt(0)).toBe(0xfeff);
    // And the text after it is untouched.
    expect(toCsvFile(['Venue'], [['Café']]).slice(1)).toBe(toCsv(['Venue'], [['Café']]));
  });
});

describe('what the parser reads back', () => {
  const round = (headers: string[], rows: string[][]) => {
    const table = parseCsv(toCsv(headers, rows));
    return { header: table.header, rows: table.rows.map((row) => row.cells) };
  };

  it('returns every awkward value unchanged', () => {
    const headers = ['Venue', 'Notes', 'Cash-out'];
    const rows = [
      ['Bellagio, room 2', 'he said "nice hand"', '1250.00'],
      ['Aria', 'two\nlines', ''],
      [' padded ', '', '0.00'],
      ['Café', 'a;b|c\td', '-40.50'],
    ];
    const back = round(headers, rows);
    expect(back.header).toEqual(headers);
    expect(back.rows).toEqual(rows);
  });

  it('and does not mistake a comma inside a value for a column', () => {
    const back = round(['a', 'b'], [['one, two', 'three']]);
    expect(back.rows[0]).toHaveLength(2);
  });
});
