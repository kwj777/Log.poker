import { cellAt, parseCsv, sniffDelimiter } from '../csv';

describe('sniffDelimiter', () => {
  it('picks the delimiter that yields the most columns', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('ignores delimiters inside quotes', () => {
    expect(sniffDelimiter('"a;b;c;d"\tx\n')).toBe('\t');
  });

  it('falls back to a comma when there is nothing to go on', () => {
    expect(sniffDelimiter('')).toBe(',');
    expect(sniffDelimiter('single')).toBe(',');
  });

  it('skips leading blank lines', () => {
    expect(sniffDelimiter('\n\na\tb\n')).toBe('\t');
  });
});

describe('parseCsv', () => {
  it('reads a header and rows', () => {
    const table = parseCsv('Date,Result\n2024-01-15,120\n2024-01-16,-40\n');
    expect(table.header).toEqual(['Date', 'Result']);
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['2024-01-15', '120'],
      ['2024-01-16', '-40'],
    ]);
  });

  it('trims header cells but leaves data alone', () => {
    const table = parseCsv(' Date , Result \na, b\n');
    expect(table.header).toEqual(['Date', 'Result']);
    expect(table.rows[0].cells).toEqual(['a', ' b']);
  });

  it('keeps delimiters inside quoted fields', () => {
    const table = parseCsv('a,b\n"one, two",three\n');
    expect(table.rows[0].cells).toEqual(['one, two', 'three']);
  });

  it('reads a doubled quote as a literal quote', () => {
    const table = parseCsv('a\n"he said ""hi"""\n');
    expect(table.rows[0].cells).toEqual(['he said "hi"']);
  });

  it('keeps a quote that opens mid-field as data', () => {
    const table = parseCsv('a,b\n5" pot,x\n');
    expect(table.rows[0].cells).toEqual(['5" pot', 'x']);
  });

  it('keeps newlines inside quoted fields and still counts lines', () => {
    const table = parseCsv('a,b\n"first\nsecond",x\nlast,y\n');
    expect(table.rows[0].cells).toEqual(['first\nsecond', 'x']);
    expect(table.rows[0].line).toBe(2);
    expect(table.rows[1].line).toBe(4);
  });

  it('handles CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows[0].cells).toEqual(['1', '2']);
    expect(parseCsv('a,b\r1,2\r').rows[0].cells).toEqual(['1', '2']);
  });

  it('strips a byte-order mark', () => {
    const table = parseCsv('﻿Date,Result\n1,2\n');
    expect(table.header).toEqual(['Date', 'Result']);
  });

  it('skips blank lines but keeps a quoted empty field', () => {
    const table = parseCsv('a\n\n1\n\n""\n');
    expect(table.rows.map((row) => row.cells)).toEqual([['1'], ['']]);
  });

  it('reads a final row with no trailing newline', () => {
    const table = parseCsv('a,b\n1,2');
    expect(table.rows[0].cells).toEqual(['1', '2']);
  });

  it('returns an empty header for empty input', () => {
    expect(parseCsv('').header).toEqual([]);
    expect(parseCsv('   \n').rows).toEqual([]);
  });

  it('reads tab-separated text pasted out of a spreadsheet', () => {
    const table = parseCsv('Date\tResult\n2024-01-15\t120\n');
    expect(table.delimiter).toBe('\t');
    expect(table.rows[0].cells).toEqual(['2024-01-15', '120']);
  });
});

describe('cellAt', () => {
  const row = { line: 2, cells: ['  spaced  ', 'b'] };

  it('trims the cell it returns', () => {
    expect(cellAt(row, 0)).toBe('spaced');
  });

  it('reads a short row as empty rather than throwing', () => {
    expect(cellAt(row, 7)).toBe('');
  });

  it('reads an unmapped column as empty', () => {
    expect(cellAt(row, undefined)).toBe('');
  });
});
