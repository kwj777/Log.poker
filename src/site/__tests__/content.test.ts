import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Z_SCORES, normalCdf } from '../../domain/variance';

/**
 * The four guides, checked as published.
 *
 * A poker page that gets its own arithmetic wrong is worse than no page, and
 * a number typed from memory is how that happens. So every figure in every
 * table is re-derived here, from `src/domain/variance.ts` for the variance
 * math and from plain combinatorics for the card counting, and compared
 * against what is actually in the HTML.
 *
 * The distinction matters. `scripts/build-content.mjs` computes these numbers
 * too, and a test that imported its formulas would only prove it agrees with
 * itself. Reading the published file back is the only version that can catch a
 * formatter dropping a digit, a stale committed page, or a table wired to the
 * wrong column.
 *
 * The prose is checked alongside the tables, because the sentences quote the
 * numbers: "one time in six" and "roughly 55 times riskier" are claims a
 * reader will divide two cells to check, and they were both wrong once from
 * rounding alone.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const SLUGS = ['/running-bad', '/bankroll', '/pot-odds', '/tilt'] as const;
type Slug = (typeof SLUGS)[number];

const pages = Object.fromEntries(
  SLUGS.map((slug) => [slug, read('public', `${slug.slice(1)}.html`)]),
) as Record<Slug, string>;

const home = read('public', 'home.html');
const netlify = read('netlify.toml');
const sitemap = read('public', 'sitemap.xml');

/* ------------------------------------------------------------- the parser */

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&middot;/g, '.')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Every `<tbody>` row of the first table on a page, as arrays of cell text. */
function rows(html: string): string[][] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  if (body === null) throw new Error('no table body on this page');
  return [...(body[1] as string).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...(row[1] as string).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      text(cell[1] as string),
    ),
  );
}

/**
 * The first number in a cell, with the thousands separators and signs removed.
 *
 * It has to start on a digit. Starting on `[\d,]` matched the comma in
 * "A small winner, 2.5 bb/hour" and read the whole row as zero.
 */
const num = (cell: string): number => {
  const found = /-?\d[\d,]*(?:\.\d+)?/.exec(cell.replace(/\+/g, ''));
  if (found === null) throw new Error(`no number in "${cell}"`);
  return Number(found[0].replace(/,/g, ''));
};

/** n choose k, computed here rather than imported, so the check is independent. */
const choose = (n: number, k: number): number => {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
};

/** The example player the running-bad and bankroll pages both use. */
const WIN_RATE = 5;
const STD_DEV = 50;

/* ---------------------------------------------------------------- the math */

describe('the running bad page states the variance math correctly', () => {
  const table = rows(pages['/running-bad']);

  it('has a row for every horizon the page claims', () => {
    expect(table.map((row) => num(row[0] as string))).toEqual([20, 50, 100, 250, 500, 1000]);
  });

  it.each(rows(pages['/running-bad']).map((row) => [num(row[0] as string), row] as const))(
    'is right at %i hours',
    (hours, row) => {
      const spread = Z_SCORES[95] * STD_DEV * Math.sqrt(hours);
      const expected = WIN_RATE * hours;

      // Expected result, and the two ends of the 95% envelope.
      expect(num(row[1] as string)).toBe(Math.round(expected));
      const band = (row[2] as string).split(' to ').map(num);
      expect(band[0]).toBe(Math.round(expected - spread));
      expect(band[1]).toBe(Math.round(expected + spread));

      // And the chance of being behind, which is the column that carries the
      // whole page: the z-score of zero under the same random walk.
      const behind = normalCdf(-(WIN_RATE * Math.sqrt(hours)) / STD_DEV);
      expect(num(row[3] as string)).toBeCloseTo(behind * 100, 1);
      const frequency = /1 in ([\d,]+)/.exec(row[3] as string);
      expect(Number((frequency?.[1] as string).replace(/,/g, ''))).toBe(Math.round(1 / behind));
    },
  );

  it('and the sentence about a hundred hours quotes its own table', () => {
    // This is the claim the page is built around, so it is the one most worth
    // holding to the arithmetic rather than to whatever was true when it was
    // first written.
    const behind = normalCdf(-(WIN_RATE * Math.sqrt(100)) / STD_DEV);
    expect(Math.round(1 / behind)).toBe(6);
    expect(text(pages['/running-bad'])).toContain('still behind one time in six');
  });
});

describe('the pot odds page counts cards correctly', () => {
  const table = rows(pages['/pot-odds']);

  it.each(table.map((row) => [num(row[0] as string), row] as const))(
    'is right with %i outs',
    (outs, row) => {
      // Forty-seven unseen after the flop, forty-six after the turn.
      const byRiver = 1 - choose(47 - outs, 2) / choose(47, 2);
      expect(num(row[1] as string)).toBeCloseTo(byRiver * 100, 1);
      expect(num(row[2] as string)).toBe(4 * outs);
      expect(num(row[3] as string)).toBeCloseTo((outs / 46) * 100, 1);
      expect(num(row[4] as string)).toBe(2 * outs);
    },
  );

  it('names the draws by the right number of outs', () => {
    const named = Object.fromEntries(
      table.filter((row) => /\(/.test(row[0] as string)).map((row) => [row[0], num(row[0] as string)]),
    );
    expect(named['4 (gutshot)']).toBe(4);
    expect(named['8 (open-ended)']).toBe(8);
    expect(named['9 (flush draw)']).toBe(9);
  });

  it('gets the size of the rule of 4 error right where it calls it out', () => {
    const byRiver = 1 - choose(47 - 15, 2) / choose(47, 2);
    const drift = Math.round((0.6 - byRiver) * 100);
    expect(drift).toBe(6);
    expect(text(pages['/pot-odds'])).toContain('an overstatement of about 6 points');
    // And the one-card number for a flush draw, which is the page's own point.
    expect(text(pages['/pot-odds'])).toContain(`is a ${((9 / 46) * 100).toFixed(1)}% shot`);
  });
});

describe('the bankroll page states risk of ruin correctly', () => {
  const table = rows(pages['/bankroll']);
  const RATES = [2.5, 5, 8];
  const BUY_INS = [5, 10, 20, 30, 40];
  const ruin = (buyIns: number, winRate: number): number =>
    Math.exp((-2 * winRate * (buyIns * 100)) / (STD_DEV * STD_DEV));

  it('has a row for every win rate', () => {
    expect(table.map((row) => num(row[0] as string))).toEqual(RATES);
  });

  it.each(table.map((row) => [num(row[0] as string), row] as const))(
    'is right at %d bb an hour',
    (winRate, row) => {
      BUY_INS.forEach((buyIns, column) => {
        const value = ruin(buyIns, winRate);
        const cell = row[column + 1] as string;
        if (value < 0.00001) {
          expect(cell).toBe('under 0.001%');
          return;
        }
        // Three significant figures, so a cell that lost a digit fails here.
        expect(num(cell)).toBeCloseTo(value * 100, -Math.floor(Math.log10(value * 100)) + 1);
      });
    },
  );

  it('and the comparison in the prose divides its own two cells', () => {
    const ratio = Math.round(ruin(20, 2.5) / ruin(20, 5));
    expect(ratio).toBe(55);
    expect(text(pages['/bankroll'])).toContain(`roughly ${ratio} times riskier`);
  });

  it('and the diagonal it points at really is a diagonal', () => {
    // The page claims doubling the win rate buys what doubling the roll buys,
    // and then says the table shows it. This is that claim, checked.
    expect(ruin(5, 5)).toBeCloseTo(ruin(10, 2.5), 10);
    expect(ruin(10, 5)).toBeCloseTo(ruin(20, 2.5), 10);
  });
});

/* --------------------------------------------------------------- the pages */

describe('every guide is a page this site can serve', () => {
  it('is what the generator would write right now', () => {
    // The committed HTML is the deployed artifact; the generator is the source.
    // This is what stops the two from parting company.
    execFileSync('node', ['scripts/build-content.mjs', '--check'], { cwd: ROOT });
  });

  it.each(SLUGS)('%s renders with nothing fetched, not even a font', (slug) => {
    const page = pages[slug];
    expect(page).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(page).not.toMatch(/<link[^>]+stylesheet/i);
    expect(page).not.toMatch(/@import|fonts\.(googleapis|gstatic)\.com/i);
  });

  it.each(SLUGS)('%s has exactly one h1, a title and a description', (slug) => {
    const page = pages[slug];
    expect([...page.matchAll(/<h1>/g)]).toHaveLength(1);
    expect(/<title>([^<]{20,70})<\/title>/.exec(page)).not.toBeNull();
    const description = /<meta name="description" content="([^"]+)"/.exec(page);
    expect((description?.[1] as string).length).toBeGreaterThan(70);
    expect((description?.[1] as string).length).toBeLessThan(200);
  });

  it.each(SLUGS)('%s is canonical at its own extensionless address', (slug) => {
    expect(pages[slug]).toContain(`<link rel="canonical" href="https://log.poker${slug}" />`);
    // Which is what makes the .html address, which Netlify also serves,
    // fold into this one rather than compete with it.
    expect(netlify).toContain(`from = "${slug}"`);
    expect(netlify).toContain(`to = "${slug}.html"`);
  });

  it.each(SLUGS)('%s has a share card, the front door\'s, at its real size', (slug) => {
    // A link to a guide used to unfurl with no picture at all.
    expect(pages[slug]).toContain('<meta property="og:image" content="https://log.poker/og/home.png" />');
    expect(pages[slug]).toContain('<meta property="og:image:width" content="1200" />');
    expect(pages[slug]).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it.each(SLUGS)('%s links the blog and the sitemap by their slashed addresses', (slug) => {
    // Both are directories, so the bare address is a 301 to the slashed one.
    expect(pages[slug]).toContain('href="/blog/"');
    expect(pages[slug]).toContain('href="/sitemap/"');
    expect(pages[slug]).not.toMatch(/href="\/(app|blog|sitemap)"/);
  });

  it.each(SLUGS)('%s says the same thing in its structured data as in its head', (slug) => {
    const page = pages[slug];
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page);
    const data = JSON.parse(block?.[1] as string) as Record<string, string>;
    expect(data['@type']).toBe('Article');
    expect(page).toContain(`<title>${data.headline}</title>`);
    expect(page).toContain(`content="${data.description}"`);
    expect(data.url).toBe(`https://log.poker${slug}`);
  });

  it.each(SLUGS)('%s quotes no price', (slug) => {
    // The same rule as the front door: somebody who has used none of the three
    // has no way to value one. The $20 into a $60 pot on the pot odds page is
    // an example of arithmetic, not a price, which is why this looks for a
    // currency figure next to a word about buying.
    expect(pages[slug]).not.toMatch(/\$\s*\d[\d.,]*\s*(a |per |\/)?(month|year|once|one-time)/i);
  });

  it.each(SLUGS)('%s is reachable from the front door and leads back to it', (slug) => {
    expect(home).toContain(`href="${slug}"`);
    expect(pages[slug]).toContain('href="/"');
  });

  it.each(SLUGS)('%s links to the other three', (slug) => {
    for (const other of SLUGS.filter((candidate) => candidate !== slug)) {
      expect(pages[slug]).toContain(`href="${other}"`);
    }
  });

  it('all four are in the sitemap, and nothing else was added with them', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual([
      'https://log.poker/',
      'https://log.poker/app/',
      ...SLUGS.map((slug) => `https://log.poker${slug}`),
    ]);
  });

  it('and each one sends the reader to exactly one app at the end', () => {
    const target: Record<Slug, string> = {
      '/running-bad': '/app/',
      '/bankroll': '/app/',
      '/pot-odds': 'https://tiltproof.poker',
      '/tilt': 'https://untilt.poker',
    };
    for (const slug of SLUGS) {
      const closing = pages[slug].slice(pages[slug].indexOf('<div class="next">'));
      expect(closing).toContain(`href="${target[slug]}"`);
    }
  });
});
