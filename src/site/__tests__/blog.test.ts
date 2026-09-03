/**
 * The Log Blog has no back office and no database, so its correctness is a
 * build-time property: a post is a file, and `scripts/build-blog.mjs` turns
 * the directory of them into the index, the pages, the feed and the sitemap.
 *
 * These tests run that script, the real one that Netlify runs, rather
 * than a copy of its rules, twice over. Once against `content/blog`, which is
 * what actually ships, and once against fixtures written into a temp
 * directory, which is the only way to assert what the grammar *refuses*: a
 * post that smuggles in HTML, a link that would execute, a typo in the front
 * matter that would otherwise publish a page missing its description.
 *
 * The quiet failures it is here to catch are the ones a type check and a
 * render both miss: a post that stops being reachable because the front door
 * lost its link, a page that starts fetching a font, a blog that generates
 * before the export is moved and so is buried under /app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { colors } from '../../theme';

const ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'build-blog.mjs');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const scratch: string[] = [];
const temporary = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'log-blog-'));
  scratch.push(directory);
  return directory;
};

/** Runs the real build. `posts` points it at fixtures instead of content/blog. */
const build = (posts?: string): string => {
  const out = temporary();
  execFileSync('node', posts ? [SCRIPT, out, posts] : [SCRIPT, out], { encoding: 'utf8' });
  return out;
};

/** A directory holding exactly the posts given, as `<name>: <source>`. */
const fixture = (posts: Record<string, string>): string => {
  const directory = temporary();
  for (const [name, source] of Object.entries(posts)) writeFileSync(join(directory, name), source);
  return directory;
};

const post = (body: string, front = ''): string =>
  `---\ntitle: A hand\ndescription: One hand, told once.\n${front}---\n\n${body}\n`;

/** What the build said when it refused to run. */
const refusal = (posts: string): string => {
  try {
    build(posts);
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error);
  }
  throw new Error('the build was expected to fail and did not');
};

const site = build();
const index = readFileSync(join(site, 'blog', 'index.html'), 'utf8');
const feed = readFileSync(join(site, 'blog', 'feed.xml'), 'utf8');
const sitemap = readFileSync(join(site, 'sitemap.xml'), 'utf8');
/** Every post the build published, by the slug it published it at. The listing
 * only, not the footer, which links the feed at a /blog path of its own. */
const listing = index.slice(index.indexOf('<ul class="posts">'), index.indexOf('</ul>'));
const published = [...listing.matchAll(/<a href="\/blog\/([^"]+)">/g)].map((match) => match[1]);

afterAll(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

describe('what a post becomes', () => {
  it('publishes every post in content/blog, and something to read', () => {
    expect(published.length).toBeGreaterThan(0);
    for (const slug of published) {
      expect(existsSync(join(site, 'blog', slug, 'index.html'))).toBe(true);
    }
  });

  it('gives each one a directory, so the URL carries no .html', () => {
    // Which is also what makes /blog/<slug> resolve on any static host without
    // a redirect rule, and netlify.toml therefore says nothing about the blog.
    for (const slug of published) {
      expect(readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8'))
        .toContain(`<link rel="canonical" href="https://log.poker/blog/${slug}" />`);
    }
  });

  it('renders with nothing fetched, not even a font', () => {
    // The same promise the front door makes, for the same reason: this is read
    // in a card room, on one bar of signal, on somebody else's phone.
    for (const page of [index, ...published.map((slug) => readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8'))]) {
      expect(page).not.toMatch(/<script[^>]+\ssrc=/i);
      expect(page).not.toMatch(/<link[^>]+stylesheet/i);
      expect(page).not.toMatch(/@import|fonts\.(googleapis|gstatic)\.com/i);
    }
  });

  it('is the family, not a page that happens to be dark', () => {
    // The palette is the app's own, so the blog cannot drift off-brand quietly.
    expect(index).toContain(`--ground: ${colors.background};`);
    expect(index).toContain(`--gold: ${colors.accent};`);
    expect(index).toContain(`--cream: ${colors.text};`);
  });

  it('draws its figures from the spec they are checked in with', () => {
    // The SVGs under content/blog/figures are committed artefacts and no build
    // regenerates them, so a spec edited without rerunning the script would
    // leave the post showing the old drawing and nothing would say so.
    const drawn = temporary();
    execFileSync('node', [join(ROOT, 'scripts', 'draw-hand.mjs'), drawn], { encoding: 'utf8' });
    for (const figure of readdirSync(drawn)) {
      expect(readFileSync(join(drawn, figure), 'utf8'))
        .toBe(read('content', 'blog', 'figures', figure));
    }
  });

  it('sends a reader who finished a post to the app', () => {
    for (const slug of published) {
      expect(readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8'))
        .toContain('<a class="btn" href="/app">');
    }
  });
});

describe('the blog is findable', () => {
  it('is linked from the front door, which is the only way in', () => {
    expect(read('public', 'home.html')).toContain('<a href="/blog">');
  });

  it('adds itself and its posts to the one sitemap robots.txt names', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    // The two the hand-written public/sitemap.xml maintains, then the blog.
    expect(locs.slice(0, 2)).toEqual(['https://log.poker/', 'https://log.poker/app']);
    expect(locs).toContain('https://log.poker/blog');
    for (const slug of published) expect(locs).toContain(`https://log.poker/blog/${slug}`);
  });

  it('dates every entry, in the past', () => {
    const dates = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]);
    expect(dates).toHaveLength([...sitemap.matchAll(/<loc>/g)].length);
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(date)).toBeLessThanOrEqual(Date.now());
    }
  });

  it('has a feed, with one item per post and a date a reader can parse', () => {
    expect(feed).toContain('<atom:link href="https://log.poker/blog/feed.xml" rel="self"');
    expect([...feed.matchAll(/<item>/g)]).toHaveLength(published.length);
    for (const slug of published) {
      expect(feed).toContain(`<guid isPermaLink="true">https://log.poker/blog/${slug}</guid>`);
    }
    for (const date of [...feed.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((match) => match[1])) {
      expect(date).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
  });

  it('rebuilds to the same bytes, so nobody is told a post changed when it did not', () => {
    expect(readFileSync(join(build(), 'blog', 'feed.xml'), 'utf8')).toBe(feed);
  });
});

describe('the blog stays at the root', () => {
  const buildScript = read('scripts', 'build-web.mjs');

  it('is generated after the export has been moved under /app', () => {
    // Generated before, every page of it would be swept under /app with the
    // bundle by the move loop, and /blog would 404 with nothing erroring.
    const move = buildScript.indexOf('renameSync(join(DIST, entry), join(APP, entry))');
    const blog = buildScript.indexOf("'build-blog.mjs'");
    expect(move).toBeGreaterThan(-1);
    expect(blog).toBeGreaterThan(move);
  });

  it('is what the deployed build actually runs', () => {
    expect(buildScript).toContain('execFileSync(\'node\', [join(ROOT, \'scripts\', \'build-blog.mjs\'), DIST]');
  });

  it('revalidates, or a new post never reaches a returning reader', () => {
    const netlify = read('netlify.toml');
    const rule = netlify.indexOf('for = "/blog/*"');
    expect(rule).toBeGreaterThan(-1);
    expect(netlify.slice(rule)).toMatch(/Cache-Control = "public, max-age=0, must-revalidate"/);
  });
});

describe('the grammar refuses what would break a live page', () => {
  it('escapes HTML in a post rather than passing it through', () => {
    // A stray < in prose is a typo. Rendered, it eats the rest of the page.
    const out = build(fixture({ '2026-01-02-raw.md': post('An <script>alert(1)</script> aside.') }));
    const page = readFileSync(join(out, 'blog', 'raw', 'index.html'), 'utf8');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toMatch(/<script>alert/);
  });

  it('will not publish a link that executes', () => {
    expect(refusal(fixture({ '2026-01-02-bad.md': post('[press here](javascript:alert(1))') })))
      .toMatch(/unsupported link target/);
  });

  it('reads a typo in the front matter as a typo', () => {
    expect(refusal(fixture({ '2026-01-02-typo.md': '---\ntitle: A hand\ndescriptino: no\n---\n\nBody.\n' })))
      .toMatch(/unknown front matter "descriptino"/);
  });

  it('insists on a description, which is the search result and the index line', () => {
    expect(refusal(fixture({ '2026-01-02-bare.md': '---\ntitle: A hand\n---\n\nBody.\n' })))
      .toMatch(/needs a description/);
  });

  it('insists the file name carries the date and the URL', () => {
    expect(refusal(fixture({ 'my-post.md': post('Body.') }))).toMatch(/name a post/);
    expect(refusal(fixture({ '2026-02-31-nope.md': post('Body.') }))).toMatch(/not a real date/);
  });

  it('keeps the h1 for the title, so a page never has two', () => {
    expect(refusal(fixture({ '2026-01-02-two.md': post('# A second title') })))
      .toMatch(/headings start at ##/);
  });

  it('names the figure it cannot find instead of rendering a hole', () => {
    expect(refusal(fixture({ '2026-01-02-art.md': post('::: figure missing\nA caption.\n:::') })))
      .toMatch(/no figure at/);
  });

  it('leaves a draft out of the index, the feed and the sitemap', () => {
    const out = build(fixture({
      '2026-01-02-done.md': post('Published.'),
      '2026-01-03-wip.md': post('Not yet.', 'draft: true\n'),
    }));
    expect(readFileSync(join(out, 'blog', 'index.html'), 'utf8')).not.toContain('/blog/wip');
    expect(readFileSync(join(out, 'blog', 'feed.xml'), 'utf8')).not.toContain('/blog/wip');
    expect(readFileSync(join(out, 'sitemap.xml'), 'utf8')).not.toContain('/blog/wip');
    expect(existsSync(join(out, 'blog', 'wip'))).toBe(false);
  });

  it('orders the index newest first', () => {
    const out = build(fixture({
      '2026-01-02-older.md': post('First.'),
      '2026-03-04-newer.md': post('Second.'),
    }));
    const listing = readFileSync(join(out, 'blog', 'index.html'), 'utf8');
    expect(listing.indexOf('/blog/newer')).toBeLessThan(listing.indexOf('/blog/older'));
  });

  it('stops serving a post that has been deleted', () => {
    // The output directory is cleared rather than written over, so a renamed
    // post does not keep answering at the URL it used to have.
    const posts = fixture({ '2026-01-02-gone.md': post('Here for now.') });
    const out = build(posts);
    expect(existsSync(join(out, 'blog', 'gone', 'index.html'))).toBe(true);

    rmSync(join(posts, '2026-01-02-gone.md'));
    mkdirSync(join(posts, 'figures'), { recursive: true });
    execFileSync('node', [SCRIPT, out, posts], { encoding: 'utf8' });
    expect(existsSync(join(out, 'blog', 'gone'))).toBe(false);
  });
});
