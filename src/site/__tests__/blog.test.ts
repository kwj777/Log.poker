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

import { FAMILY_LINKS } from '../../config';
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

/** What the build printed when it last ran, which is its own account of itself. */
let said = '';

/** Runs the real build. `posts` points it at fixtures instead of content/blog. */
const build = (posts?: string): string => {
  const out = temporary();
  said = execFileSync('node', posts ? [SCRIPT, out, posts] : [SCRIPT, out], { encoding: 'utf8' });
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
const summary = said;
const index = readFileSync(join(site, 'blog', 'index.html'), 'utf8');
const feed = readFileSync(join(site, 'blog', 'feed.xml'), 'utf8');
const sitemap = readFileSync(join(site, 'sitemap.xml'), 'utf8');
/** Every post the build published, by the slug it published it at. The listing
 * only, not the footer, which links the feed at a /blog path of its own. */
const sitemapPage = readFileSync(join(site, 'sitemap', 'index.html'), 'utf8');
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

  it('offers the App Store app the way the front door does', () => {
    const eas = JSON.parse(read('eas.json'));
    const id: string = eas.submit.production.ios.ascAppId;
    for (const page of [index, ...published.map((slug) => readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8'))]) {
      expect(page).toContain(`<meta name="apple-itunes-app" content="app-id=${id}" />`);
    }
    expect(index).toContain(`<a class="store" href="https://apps.apple.com/app/id${id}">`);
    expect(index).toContain('<img src="/badges/app-store.svg"');
  });

  it('offers the Google Play app beside it', () => {
    const pkg: string = JSON.parse(read('app.json')).expo.android.package;
    expect(index).toContain(`<a class="store" href="https://play.google.com/store/apps/details?id=${pkg}">`);
    expect(index).toContain('<img src="/badges/google-play.svg"');
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

  it('ends every post on exactly one call to action', () => {
    // It used to be the button on all of them. Now a post hands off to the one
    // app it has earned the right to mention, so what is asserted is the count
    // rather than which: one, never two, never none.
    for (const slug of published) {
      const page = readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8');
      const button = page.includes('<a class="btn" href="/app">') ? 1 : 0;
      const handoff = [...page.matchAll(/class="next"/g)].length;
      expect(button + handoff).toBe(1);
    }
  });
  it('offers every post to share, by link, with nothing fetched until a tap', () => {
    for (const slug of published) {
      const page = readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8');
      const url = encodeURIComponent(`https://log.poker/blog/${slug}`);
      expect(page).toContain('<section class="share"');
      expect(page).toContain(`https://www.facebook.com/sharer/sharer.php?u=${url}`);
      expect(page).toContain(`mailto:?subject=`);
      expect(page).toContain('<a href="/blog/feed.xml">follow the blog by RSS</a>');
      expect(page).toContain('<a href="https://buttondown.com/logPoker">Get them by email</a>');
    }
  });
});

describe('the front door', () => {
  it('lists the three newest posts once the export has made home.html the index', () => {
    // build-web renames home.html to index.html and then runs this build over
    // dist, so that is the shape reproduced here rather than a fixture of it.
    const out = temporary();
    writeFileSync(join(out, 'index.html'), read('public', 'home.html'));
    execFileSync('node', [SCRIPT, out], { encoding: 'utf8' });
    const home = readFileSync(join(out, 'index.html'), 'utf8');
    for (const slug of published.slice(0, 3)) expect(home).toContain(`<a class="app l" href="/blog/${slug}">`);
    if (published[3]) expect(home).not.toContain(`href="/blog/${published[3]}"`);
    expect(home).not.toContain('latest-posts');
  });

  it('reads on its own before the build has filled it in', () => {
    const home = read('public', 'home.html');
    expect(home).toContain('<section id="blog">');
    expect(home).toMatch(/<!-- latest-posts:[^>]*-->[\s\S]*href="\/blog"[\s\S]*<!-- \/latest-posts -->/);
  });
});

describe('the share card', () => {
  /** Width and height out of a PNG's header, which also proves it is one. */
  const pngSize = (...parts: string[]) => {
    const bytes = readFileSync(join(ROOT, ...parts));
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };

  it('is drawn for every post, and for the blog itself', () => {
    // The one image on the site that Claude, Slack and everything else shows
    // before anybody has read a word, and the one the pages cannot draw.
    for (const name of ['blog', ...published]) {
      expect(pngSize('public', 'og', `${name}.png`)).toEqual({ width: 1200, height: 630 });
    }
  });

  it('is what each page points at, at the size it actually is', () => {
    for (const slug of published) {
      const page = readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8');
      expect(page).toContain(`<meta property="og:image" content="https://log.poker/og/${slug}.png" />`);
      expect(page).toContain('<meta property="og:image:width" content="1200" />');
      expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
    }
    expect(index).toContain('<meta property="og:image" content="https://log.poker/og/blog.png" />');
  });

  it('falls back to the app icon for a post that has none yet', () => {
    // The honest failure: the right brand in the wrong shape, rather than an
    // unfurl with a hole in it, and never a build that refuses to publish.
    const out = build(fixture({ '2026-01-02-uncarded.md': post('No card drawn for this one.') }));
    const page = readFileSync(join(out, 'blog', 'uncarded', 'index.html'), 'utf8');
    expect(page).toContain('<meta property="og:image" content="https://log.poker/icons/icon-512.png" />');
    expect(page).toContain('<meta name="twitter:card" content="summary" />');
  });

  it('is not drawn by the site build, so a deploy never needs a rasterizer', () => {
    // build-og is an authoring tool. The PNG is committed, and build-blog only
    // looks for it, which is what keeps @resvg out of the deploy's way.
    expect(read('scripts', 'build-blog.mjs')).not.toContain('resvg');
    expect(read('scripts', 'build-web.mjs')).not.toContain('build-og');
    expect(read('scripts', 'build-og.mjs')).toContain('@resvg/resvg-js');
  });
});

describe('where a post sends you next', () => {
  const model = read('scripts', 'posts.mjs');

  it('keeps the button on a post that hands off to Log', () => {
    // Which is the default, and the right answer for most posts: the button is
    // the thing to press, and the post has just spent a thousand words on it.
    const out = build(fixture({ '2026-01-02-plain.md': post('No hand-off declared.') }));
    const page = readFileSync(join(out, 'blog', 'plain', 'index.html'), 'utf8');
    expect(page).toContain('<a class="btn" href="/app">Get the log');
    expect(page).not.toContain('class="next"');
  });

  it('replaces it on a post that hands off elsewhere', () => {
    // Instead of, not underneath. Two calls to action stacked is one too many,
    // and the second one is the one nobody reads.
    const out = build(fixture({
      '2026-01-02-drill.md': post('A mistake worth drilling.', 'next: tiltproof\n'),
      '2026-01-03-reset.md': post('A walk back to baseline.', 'next: untilt\n'),
    }));
    const drill = readFileSync(join(out, 'blog', 'drill', 'index.html'), 'utf8');
    expect(drill).toContain('<span class="name">TiltProof</span>');
    expect(drill).toContain('href="https://tiltproof.poker"');
    expect(drill).not.toContain('class="btn"');

    const reset = readFileSync(join(out, 'blog', 'reset', 'index.html'), 'utf8');
    expect(reset).toContain('<span class="name">Untilt</span>');
    expect(reset).not.toContain('class="btn"');
  });

  it('refuses a hand-off to an app that does not exist', () => {
    expect(refusal(fixture({ '2026-01-02-nope.md': post('Body.', 'next: tiltpoof\n') })))
      .toMatch(/next must be one of/);
  });

  it('points at the hosts the family actually serves', () => {
    // A typo here is a dead link on the one line of a post that asks for a
    // click, so the two outbound ones are pinned to the app's own config.
    expect(model).toContain(`href: '${FAMILY_LINKS.tiltproof}'`);
    expect(model).toContain(`href: '${FAMILY_LINKS.untilt}'`);
    // Log's is relative, because the blog is served from the same site.
    expect(model).toContain("href: '/app'");
  });

  it('says how much of each app is free, wherever it sends you', () => {
    // The half of the price rule that is easy to lose: a page that only ever
    // says "free" makes a promise on behalf of apps that are paid past a
    // point. See README, "The copy rule, and its second half".
    const handoffs = model.slice(model.indexOf('export const HANDOFFS'), model.indexOf('};', model.indexOf('export const HANDOFFS')));
    const blurbs = [...handoffs.matchAll(/what:\s*\n?\s*'([^']+)'/g)].map((match) => match[1]);
    expect(blurbs).toHaveLength(3);
    for (const blurb of blurbs) expect(blurb).toMatch(/\bfree\b/);
  });

  it('quotes no price, the same as every other page', () => {
    for (const slug of published) {
      const page = readFileSync(join(site, 'blog', slug, 'index.html'), 'utf8');
      const ending = page.slice(page.indexOf('</article>'));
      expect(ending).not.toMatch(/\$\s*\d/);
    }
  });
});

describe('the blog is findable', () => {
  it('is linked from the front door, which is the only way in', () => {
    expect(read('public', 'home.html')).toContain('<a href="/blog">');
  });

  it('adds itself and its posts to the one sitemap robots.txt names', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    // The hand-written public/sitemap.xml first -- the front door, the app and
    // the four guides -- then the blog.
    expect(locs.slice(0, 2)).toEqual(['https://log.poker/', 'https://log.poker/app']);
    expect(locs).toContain('https://log.poker/blog');
    for (const slug of published) expect(locs).toContain(`https://log.poker/blog/${slug}`);
  });

  it('and counts them honestly in the line it prints', () => {
    // The summary said `posts.length + 2`, which was the arithmetic back when
    // the hand-written sitemap held the front door and the app alone. It holds
    // six URLs now, so the build reported 7 while writing 12 -- a line whose
    // whole job is to be read by somebody deploying, quietly off by five.
    const written = (sitemap.match(/<loc>/g) ?? []).length;
    expect(summary).toContain(`${written} sitemap entries`);
    expect(written).toBeGreaterThan(published.length + 2);
  });

  it('and lists the same pages again at /sitemap, for the people', () => {
    // The XML is a list of addresses with no names on it. This is the same
    // list a reader can use, and the build refuses to publish them if they
    // disagree -- so what this asserts from outside is that the refusal works.
    const crawled = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((match) => match[1].replace('https://log.poker', '') || '/')
      .sort();
    const linked = [...sitemapPage.matchAll(/<li>\s*<a href="([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    expect(linked).toEqual(crawled);
  });

  it('names every page rather than only addressing it', () => {
    expect(sitemapPage).toContain('Running bad or playing bad');
    expect(sitemapPage).toContain('How big a bankroll');
    expect(sitemapPage).toContain('Pot odds and outs');
    expect(sitemapPage).toContain('Tilt');
    for (const slug of published) expect(sitemapPage).toContain(`/blog/${slug}`);
  });

  it('is reachable from the pages it lists, or nobody will ever see it', () => {
    expect(read('public', 'home.html')).toContain('href="/sitemap"');
    expect(read('public', 'running-bad.html')).toContain('href="/sitemap"');
    expect(index).toContain('href="/sitemap"');
    expect(readFileSync(join(site, 'blog', published[0], 'index.html'), 'utf8')).toContain(
      'href="/sitemap"',
    );
  });

  it('fetches nothing to render, same as every other page here', () => {
    expect(sitemapPage).not.toMatch(/<script\b/);
    expect(sitemapPage).not.toMatch(/<link[^>]+stylesheet/);
    // Every URL it reaches for is this site's own.
    for (const [, url] of sitemapPage.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
      expect(url.startsWith('https://log.poker') || url === 'https://gamblingtherapy.org').toBe(
        true,
      );
    }
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

  it('and every link in it points somewhere a reader can follow', () => {
    // The page pipeline keeps hrefs as the Markdown wrote them, which for
    // these posts is root-relative, and that is right on the site. RSS has no
    // base URL and `content:encoded` carries no `xml:base`, so a reader
    // resolves them against its own origin or against nothing: the call to
    // action every post ends on was dead in every reader that renders full
    // content, and so was every cross-link between the posts.
    expect(feed).not.toMatch(/(href|src)="\/(?!\/)/);
    // And the ones that matter are really there, absolutely, rather than the
    // assertion above passing because nothing links anywhere.
    expect(feed).toContain('href="https://log.poker/app"');
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
