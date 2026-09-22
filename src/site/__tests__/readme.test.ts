/**
 * The README's test table, checked from the inside.
 *
 * `npm run test:table` generates it from a real run, and `-- --check` proves it
 * matches one. Neither can run inside `npm test`, because finding out what the
 * suite does means running the suite. What can run here is everything that does
 * not need the suite's results: that the table is internally consistent, and
 * that nobody left a placeholder where a sentence belongs.
 *
 * The generator handles the numbers; this handles the part a person still owns.
 * A suite that exists but is missing from the table is the one thing only
 * `--check` can see, because seeing it means knowing what suites there are.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(__filename), '..', '..', '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

const block = /```\nTest Suites: (\d+) passed\nTests:\s+(\d+) passed\n\n([\s\S]*?)```/.exec(readme);

interface Row {
  name: string;
  count: number;
  description: string;
}

const rows: Row[] = (block?.[3] ?? '')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => {
    const parsed = /^ {2}(\S+)\s+(\d+)\s{2,}(.+)$/.exec(line);
    if (!parsed) throw new Error(`Unreadable row in the README test table: ${JSON.stringify(line)}`);
    return { name: parsed[1], count: Number(parsed[2]), description: parsed[3].trim() };
  });

describe('the README test table', () => {
  it('is there at all', () => {
    expect(block).not.toBeNull();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('counts its own rows correctly', () => {
    expect(rows).toHaveLength(Number(block?.[1]));
  });

  it('adds up to the total it states', () => {
    const summed = rows.reduce((total, row) => total + row.count, 0);
    expect(summed).toBe(Number(block?.[2]));
  });

  it('names every suite once', () => {
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
  });

  it('is ordered by size, then by name', () => {
    const sorted = [...rows].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    expect(rows.map((row) => row.name)).toEqual(sorted.map((row) => row.name));
  });

  it('says what every suite is for', () => {
    // A new suite lands with a placeholder from the generator. This is the
    // nudge to replace it with a sentence somebody wrote.
    const undescribed = rows.filter((row) => /^TODO/.test(row.description));
    expect(undescribed.map((row) => row.name)).toEqual([]);
  });
});

describe('numbers in the prose that the code can settle', () => {
  /**
   * Each of these was written true and went stale, and each is the kind a
   * reader has no way to doubt: a citation, a fixture's shape, a count of call
   * sites, a threshold. They are asserted against the thing they describe
   * rather than against themselves.
   */
  const root = join(__dirname, '..', '..', '..');
  const file = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

  it('cites the approximation `normalCdf` actually uses', () => {
    // The constants below the citation -- 0.3275911 and 0.254829592 -- are
    // Abramowitz & Stegun 7.1.26, the error function. 26.2.17 is a different
    // approximation with different constants.
    const source = file('src', 'domain', 'variance.ts');
    expect(source).toContain('0.3275911');
    expect(source).toMatch(/Abramowitz & Stegun 7\.1\.26/);
  });

  it('and describes the demo tournament set by its own contents', () => {
    const seed = file('src', 'data', 'seed.ts');
    const plan = seed.slice(seed.indexOf('TOURNAMENT_PLAN'), seed.indexOf('];', seed.indexOf('TOURNAMENT_PLAN')));
    const results = [...plan.matchAll(/resultDollars: (-?\d+)/g)].map((m) => Number(m[1]));
    expect(results).toHaveLength(12);
    expect(results.filter((result) => result > 0)).toHaveLength(3);
    expect(seed).toMatch(/twelve entries, three cashes/);
  });

  it('and agrees with the rest of the repository about the backstop', () => {
    // Three documents said six months and `bundle.ts` said three.
    for (const source of [file('README.md'), file('SYNC.md'), file('src', 'sync', 'bundle.ts')]) {
      expect(source).toMatch(/six months offline/);
    }
  });

  it('and puts the ROI threshold where the code puts it', () => {
    expect(file('src', 'domain', 'tournaments.ts')).toMatch(/MIN_ENTRIES_FOR_INTERVAL = 10;/);
    expect(file('README.md')).toMatch(/Below ten entries/);
  });
});

