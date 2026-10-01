/**
 * The Log Blog: Markdown in `content/blog`, static HTML at /blog.
 *
 * There is no back office and no database, because a blog that publishes a few
 * times a month needs neither and both would outlive their usefulness. A post
 * is a file. Publishing is adding one and deploying, and every URL the blog
 * owns (the index, the posts, the feed, the sitemap entries) is derived from
 * that directory rather than written down a second time somewhere else.
 *
 * The pages obey the same rule as `public/home.html`: **no bundle and no
 * external request of any kind, not even a font.** Whatever else the blog is,
 * it gets read on a phone in a card room on one bar of signal, so it paints
 * from a single document or it does not paint.
 *
 * Run by `scripts/build-web.mjs` after the export has been moved under /app,
 * which is what keeps this output at the root. Also runnable alone, to read a
 * draft before it ships:
 *
 *     npm run build:blog -- .preview && npx serve .preview
 *
 * The Markdown is a deliberate subset: headings from `##` down, paragraphs,
 * `-` and `1.` lists, `>` quotes, fenced code, `---`, the two `:::` blocks
 * below, and inline `**bold**`, `*italic*`, `` `code` `` and `[links](/here)`.
 * Raw HTML in a post is escaped rather than passed through, so a stray `<` in
 * prose can never silently eat a paragraph, and anything the grammar does not
 * recognize throws at build time rather than reaching a live page.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOG, HANDOFFS, SITE, TAGLINE, TITLE, feedDate, longDate, readPosts } from './posts.mjs';
import { APP_STORE_BANNER, APP_STORE_URL, GUIDES, TOP } from './pages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

/** Where this build writes. `dist` is what Netlify publishes. */
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist'));

/**
 * Where the posts are read from. A second argument points the build at some
 * other directory, which is how `src/site/__tests__/blog.test.ts` runs this
 * renderer over fixtures, so the grammar that ships is the grammar the tests
 * exercise, rather than a second copy of it that agrees with itself.
 */
const POSTS = resolve(process.argv[3] ?? join(ROOT, 'content', 'blog'));
const FIGURES = join(POSTS, 'figures');

/** Only what cannot execute: `javascript:` and its friends throw rather than ship. */
const SAFE_HREF = /^(https?:\/\/|\/|mailto:|#)/;

/** Where a code span parks while the emphasis rules run over the rest. */
const SPAN = '\u0000';

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline Markdown, over already-escaped text.
 *
 * Code spans come out first and go back last, so nothing between backticks is
 * read as emphasis, which is the entire reason anybody writes `**` inside a
 * post about Markdown.
 */
const inline = (text, where) => {
  const spans = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, body) => `${SPAN}${spans.push(body) - 1}${SPAN}`);

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    if (!SAFE_HREF.test(href)) throw new Error(`${where}: unsupported link target "${href}"`);
    return `<a href="${href}">${label}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${spans[Number(index)]}</code>`);
};

/**
 * A drawing lives in `content/blog/figures` as an SVG rather than inside the
 * post, because a hand diagram is a hundred lines of coordinates and prose
 * should stay readable. It is inlined into the page, so the illustration costs
 * no request either.
 */
const figure = (name, caption, where) => {
  const file = join(FIGURES, `${name}.svg`);
  if (!existsSync(file)) throw new Error(`${where}: no figure at ${file}`);
  const svg = readFileSync(file, 'utf8').replace(/<\?xml[^>]*\?>\s*/, '').trim();
  if (!svg.startsWith('<svg')) throw new Error(`${where}: ${name}.svg is not an <svg> element`);
  if (/<script/i.test(svg)) throw new Error(`${where}: ${name}.svg contains a script`);
  return `<figure class="figure">
          ${svg.split('\n').join('\n          ')}
          ${caption ? `<figcaption>${inline(caption, where)}</figcaption>` : ''}
        </figure>`;
};

/** A number worth stopping on, pulled out of the paragraph that earned it. */
const stat = (headline, note, where) => `<aside class="stat">
          <p class="stat-figure">${inline(headline, where)}</p>
          ${note ? `<p class="stat-note">${inline(note, where)}</p>` : ''}
        </aside>`;

/** The block grammar. Anything it does not recognize is a paragraph. */
const renderMarkdown = (markdown, where) => {
  const out = [];
  let paragraph = [];
  let quote = [];
  let list = null;
  let fence = null;
  let block = null;

  const closeParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '), where)}</p>`);
    paragraph = [];
  };
  const closeQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(' '), where)}</p></blockquote>`);
    quote = [];
  };
  const closeList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${inline(item, where)}</li>`).join('');
      out.push(`<${list.tag}>${items}</${list.tag}>`);
    }
    list = null;
  };
  const close = () => { closeParagraph(); closeQuote(); closeList(); };

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\s+$/, '');

    if (fence !== null) {
      if (line.trim() === '```') {
        out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
        fence = null;
      } else {
        fence.push(raw);
      }
      continue;
    }

    if (block !== null) {
      if (line.trim() === ':::') {
        const body = block.lines.join(' ').trim();
        out.push(block.kind === 'figure'
          ? figure(block.argument, body, where)
          : stat(block.argument, body, where));
        block = null;
      } else {
        block.lines.push(line.trim());
      }
      continue;
    }

    if (line.startsWith(':::')) {
      const opener = /^:::\s*(figure|stat)\s+(.+)$/.exec(line);
      if (!opener) throw new Error(`${where}: ":::" opens a figure or a stat, then closes on its own line`);
      close();
      block = { kind: opener[1], argument: opener[2].trim(), lines: [] };
      continue;
    }

    if (line.trim().startsWith('```')) { close(); fence = []; continue; }
    if (!line.trim()) { close(); continue; }

    if (/^#\s/.test(line)) {
      throw new Error(`${where}: a post's h1 is its title, so headings start at ##`);
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      close();
      out.push(`<h${level}>${inline(heading[2], where)}</h${level}>`);
      continue;
    }
    if (/^-{3,}$/.test(line)) { close(); out.push('<hr />'); continue; }

    const quoted = /^>\s?(.*)$/.exec(line);
    if (quoted) { closeParagraph(); closeList(); quote.push(quoted[1]); continue; }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      closeParagraph();
      closeQuote();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) closeList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? numbered)[1]);
      continue;
    }

    // Wrapped prose: a bare line under a list item or a quote belongs to it.
    if (list) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    if (quote.length) { quote.push(line.trim()); continue; }
    paragraph.push(line.trim());
  }

  if (fence !== null) throw new Error(`${where}: unterminated code fence`);
  if (block !== null) throw new Error(`${where}: unterminated ::: ${block.kind}`);
  close();
  return out.join('\n        ');
};

/**
 * The family mark, the same one on the front door and the 404: the canopy in
 * one green ramp with nothing lit, because this is every app rather than one
 * of them. See BRAND.md.
 */
const MARK = `<svg class="mark" viewBox="0 0 200 200" role="img" aria-label="Three nested triangles sharing a baseline">
          <g fill="none" stroke-linejoin="round" stroke-linecap="round">
            <path d="M100 125 L100 163" stroke="#c9a86a" stroke-width="8" />
            <path d="M34 125 L166 125 L100 37 Z" stroke="#9aae80" stroke-width="6" />
            <path d="M56 125 L100 66 L144 125" stroke="#75886a" stroke-width="6" />
            <path d="M78 125 L100 96 L122 125" stroke="#55665e" stroke-width="6" />
          </g>
        </svg>`;

/** The front door's stylesheet, inlined, because a blog is not worth a request. */
const STYLE = `      :root {
        --ground: #1c211f; --raised: #232a27; --rim: #2e3a35; --ring: #333f39;
        --gold: #c9a86a; --sage: #6b7a5e; --forest: #3d4a44;
        --cream: #e8e4da; --muted: #b7c0ba; --dim: #828e89;
        --serif: Georgia, "Times New Roman", "Nimbus Roman", serif;
        --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      html { -webkit-text-size-adjust: 100%; }
      body {
        margin: 0; background: var(--ground); color: var(--cream);
        font-family: var(--sans); font-size: 16px; line-height: 1.62;
        -webkit-font-smoothing: antialiased;
      }
      .wrap {
        max-width: 40rem; margin: 0 auto;
        padding: clamp(1.75rem, 6vw, 3.25rem) clamp(1.25rem, 6vw, 2rem) 3rem;
        display: flex; flex-direction: column; gap: clamp(2.25rem, 7vw, 3.25rem);
      }
      .top { display: flex; align-items: center; gap: .7rem; }
      .top .mark { width: 30px; height: auto; flex: none; }
      .top a {
        color: var(--muted); text-decoration: none;
        font-size: .72rem; letter-spacing: .2em; text-transform: uppercase;
      }
      .top a:hover, .top a:focus-visible { color: var(--gold); }
      .masthead { display: flex; flex-direction: column; gap: .9rem; }
      h1 {
        font-family: var(--serif); font-weight: normal; margin: 0;
        font-size: clamp(1.9rem, 6.6vw, 2.6rem); line-height: 1.12; text-wrap: balance;
      }
      h2 {
        font-family: var(--serif); font-weight: normal; margin: 2.4rem 0 0;
        font-size: clamp(1.28rem, 3.6vw, 1.5rem); line-height: 1.25; text-wrap: balance;
      }
      h3 {
        font-family: var(--sans); font-weight: 600; margin: 1.9rem 0 0;
        font-size: 1rem; color: var(--cream);
      }
      .eyebrow {
        margin: 0; font-size: .68rem; letter-spacing: .22em;
        text-transform: uppercase; color: var(--dim);
      }
      .lede {
        margin: 0; color: var(--muted); font-family: var(--serif);
        font-size: clamp(1.02rem, 2.5vw, 1.15rem); line-height: 1.55;
      }
      p { margin: 1.05rem 0 0; }
      .posts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .8rem; }
      .posts a {
        display: block; border: 1px solid var(--rim); border-radius: 3px;
        background: var(--raised); padding: 1.1rem 1.2rem;
        text-decoration: none; color: inherit;
      }
      .posts a:hover, .posts a:focus-visible { border-color: var(--ring); }
      .posts time {
        display: block; font-size: .67rem; letter-spacing: .22em;
        text-transform: uppercase; color: var(--dim); margin-bottom: .3rem;
      }
      .posts .name { font-family: var(--serif); font-size: 1.24rem; display: block; color: var(--cream); }
      .posts .what { display: block; margin-top: .25rem; color: var(--muted); font-size: .9rem; }
      article { display: flex; flex-direction: column; gap: 1.9rem; }
      article header { display: flex; flex-direction: column; gap: .9rem; }
      article header time { font-size: .68rem; letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }
      .body > :first-child { margin-top: 0; }
      .body ul, .body ol { margin: 1.05rem 0 0; padding-left: 1.25rem; }
      .body li { margin-top: .4rem; }
      .body blockquote { margin: 1.7rem 0 0; border-left: 2px solid var(--forest); padding-left: 1.15rem; }
      .body blockquote p { margin: 0; font-family: var(--serif); font-size: 1.06rem; color: var(--muted); }
      .body hr { border: 0; border-top: 1px solid var(--rim); margin: 2.1rem 0 0; }
      .body strong { color: var(--cream); }
      .body code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: .86em; background: var(--raised); border: 1px solid var(--rim);
        border-radius: 2px; padding: .08em .32em;
      }
      .body pre {
        margin: 1.5rem 0 0; padding: .9rem 1rem; overflow-x: auto;
        background: var(--raised); border: 1px solid var(--rim); border-radius: 3px;
      }
      .body pre code { background: none; border: 0; padding: 0; font-size: .82rem; line-height: 1.6; }
      .figure { margin: 1.9rem 0 0; display: flex; flex-direction: column; gap: .7rem; }
      .figure svg { width: 100%; height: auto; display: block; }
      .figure figcaption { color: var(--dim); font-size: .82rem; line-height: 1.55; }
      .stat {
        margin: 1.9rem 0 0; border: 1px solid var(--rim); border-left: 2px solid var(--gold);
        border-radius: 3px; background: var(--raised); padding: 1.15rem 1.25rem;
      }
      .stat-figure {
        margin: 0; font-family: var(--serif); color: var(--gold);
        font-size: clamp(1.8rem, 6vw, 2.3rem); line-height: 1.05;
      }
      .stat-note { margin: .5rem 0 0; color: var(--muted); font-size: .92rem; }
      .next {
        border: 1px solid var(--rim); border-radius: 3px; background: var(--raised);
        padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: .55rem;
      }
      .next .verb { font-size: .67rem; letter-spacing: .22em; text-transform: uppercase; color: var(--gold); }
      .next .name { font-family: var(--serif); font-size: 1.24rem; }
      .next p { margin: 0; color: var(--muted); font-size: .93rem; }
      .cta { display: flex; flex-direction: column; align-items: center; gap: .8rem; text-align: center; }
      .btn {
        display: inline-block; background: var(--gold); color: #1c211f;
        font-weight: 600; font-size: 1.02rem; text-decoration: none;
        padding: .85rem 2.1rem; border-radius: 3px;
      }
      .btn:hover, .btn:focus-visible { background: #d8ba80; }
      .store { display: block; line-height: 0; }
      .store img { display: block; width: 144px; height: 48px; }
      .cta .sub { font-family: var(--serif); color: var(--muted); font-size: 1.02rem; margin: 0; }
      a { color: var(--gold); text-underline-offset: 2px; }
      :focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
      .share { display: flex; flex-direction: column; gap: .5rem; }
      .share .verb { font-size: .67rem; letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }
      .share p { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1.1rem; font-size: .93rem; }
      .share .native {
        font: inherit; color: var(--gold); background: none;
        border: 1px solid var(--gold); border-radius: 3px; padding: .3rem .9rem; cursor: pointer;
      }
      .share .native[hidden] { display: none; }
      footer {
        border-top: 1px solid var(--rim); padding-top: 1.5rem;
        color: var(--dim); font-size: .8rem; line-height: 1.55;
        display: flex; flex-direction: column; gap: .8rem;
      }
      footer p { margin: 0; }
      footer strong { color: var(--muted); }`;

/**
 * The front door's note, on every page here for the same reason it is there:
 * this is writing about poker, and somebody reading it at 3am may need a
 * number rather than an essay.
 */
const HELPLINE = `        <p>
          These are record keeping and practice tools, not gambling advice. If
          poker has stopped being a choice: in the US, the National Problem
          Gambling Helpline is <strong>1-800-522-4700</strong>, 24/7, free and
          confidential. Anywhere else,
          <a href="https://gamblingtherapy.org">Gambling Therapy</a> is free,
          answers in any language, and is not a phone call.
        </p>`;

/**
 * Share cards, drawn by `scripts/build-og.mjs` and committed under
 * `public/og`. They have to be rasters, because no crawler renders SVG, so
 * this build only points at one: it does not draw it and does not depend on
 * anything that can.
 *
 * A post without one falls back to the app icon and a small card. That is the
 * honest failure: the right brand in the wrong shape, rather than a link
 * preview with a hole in it.
 */
const shareCard = (name) => (existsSync(join(PUBLIC, 'og', `${name}.png`))
  ? { url: `${SITE}/og/${name}.png`, card: 'summary_large_image', width: 1200, height: 630 }
  : { url: `${SITE}/icons/icon-512.png`, card: 'summary', width: 512, height: 512 });

const head = ({ title, description, canonical, ogType, share, extra = '' }) => `  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" type="application/rss+xml" title="${TITLE}" href="/blog/feed.xml" />
    <meta name="theme-color" content="#1c211f" />
    <meta name="color-scheme" content="dark" />
    ${APP_STORE_BANNER}
    <link rel="icon" href="/icons/icon-192.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="${TITLE}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${share.url}" />
    <meta property="og:image:width" content="${share.width}" />
    <meta property="og:image:height" content="${share.height}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="${share.card}" />
${extra}    <style>
${STYLE}
    </style>
  </head>`;

/** Structured data, inline. `<` is escaped so it cannot close the tag early. */
const jsonLd = (data) =>
  `    <script type="application/ld+json">\n${JSON.stringify(data, null, 2)
    .replace(/</g, '\\u003c')
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n')}\n    </script>\n`;

/**
 * What a post ends on, after it has said what it had to say.
 *
 * A post about Log keeps the button, because the button is the thing to press
 * and the post has just spent a thousand words earning it. A post handing off
 * to one of the other two gets the guides' block instead, and gets it *instead
 * of* rather than underneath: two calls to action stacked is one too many, and
 * the second one is the one nobody reads.
 */
const handoff = (post) => {
  const next = HANDOFFS[post.next];
  if (post.next === 'log') {
    return `      <div class="cta">
        <a class="btn" href="${next.href}">Get the log</a>
        <p class="sub">${next.what}</p>
      </div>`;
  }
  return `      <section>
        <div class="next">
          <span class="verb">${next.verb}</span>
          <span class="name">${escapeHtml(next.name)}</span>
          <p>${escapeHtml(next.what)}</p>
          <p><a href="${next.href}">${next.href.replace('https://', '')}</a></p>
        </div>
      </section>`;
};

/**
 * A row of share links under every post. Plain links, so they work with no
 * script at all and fetch nothing until somebody taps one; the four targets
 * are the ones that take a URL and a line of text in the query string. On a
 * phone with a share sheet, one more button appears that opens it, which is
 * how most posts actually get passed on: to a group chat, not to a timeline.
 * It is the only script on the page and it is inline, so the promise above
 * that nothing is fetched to render still holds.
 */
const shareRow = (post) => {
  const url = encodeURIComponent(post.url);
  const title = encodeURIComponent(post.title);
  const links = [
    ['X', `https://x.com/intent/post?text=${title}&url=${url}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${url}`],
    ['Reddit', `https://www.reddit.com/submit?url=${url}&title=${title}`],
    ['Email', `mailto:?subject=${title}&body=${url}`],
  ];
  return `      <section class="share" aria-label="Share this post">
        <span class="verb">Share this post</span>
        <p>
          <button type="button" class="native" hidden>Share</button>
          ${links.map(([name, href]) => `<a href="${escapeHtml(href)}"${name === 'Email' ? '' : ' target="_blank" rel="noopener"'}>${name}</a>`).join('\n          ')}
        </p>
        <script>
          (() => {
            const button = document.querySelector('.share .native');
            if (!navigator.share) return;
            button.hidden = false;
            button.addEventListener('click', () => {
              const title = document.querySelector('h1').textContent;
              const url = document.querySelector('link[rel=canonical]').href;
              navigator.share({ title, url }).catch(() => {});
            });
          })();
        </script>
      </section>`;
};

const indexPage = (posts) => `<!doctype html>
<!--
  ${TITLE}. Generated by scripts/build-blog.mjs from content/blog, so edit a
  post there rather than this file. No bundle and no external request of any
  kind, same as the front door.
-->
<html lang="en">
${head({
  title: `${TITLE}: notes from log.poker`,
  description: TAGLINE,
  canonical: BLOG,
  ogType: 'website',
  share: shareCard('blog'),
  extra: jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: TITLE,
    description: TAGLINE,
    url: BLOG,
    inLanguage: 'en',
  }),
})}
  <body>
    <div class="wrap">
      <nav class="top">
        ${MARK}
        <a href="/">log.poker</a>
      </nav>

      <header class="masthead">
        <p class="eyebrow">Writing</p>
        <h1>${TITLE}</h1>
        <p class="lede">${TAGLINE}</p>
      </header>

      ${posts.length
    ? `<ul class="posts">
${posts.map((post) => `        <li>
          <a href="${post.path}">
            <time datetime="${post.date}">${longDate(post.date)}</time>
            <span class="name">${escapeHtml(post.title)}</span>
            <span class="what">${escapeHtml(post.description)}</span>
          </a>
        </li>`).join('\n')}
      </ul>`
    : '<p class="lede">Nothing published yet.</p>'}

      <div class="cta">
        <a class="btn" href="/app">Get the log</a>
        <a class="store" href="${APP_STORE_URL}">
          <img src="/badges/app-store.svg" width="144" height="48" alt="Download on the App Store" />
        </a>
        <p class="sub">On the web or on an iPhone. Log is free, all of it, and works offline with no account. Nothing leaves your device unless you sign in to carry it to another one.</p>
      </div>

      <footer>
        <p>
          <a href="/">The three apps</a> &middot; <a href="/app">Log</a> &middot;
          <a href="/blog/feed.xml">RSS</a> &middot; <a href="/sitemap">Sitemap</a>
        </p>
${HELPLINE}
      </footer>
    </div>
  </body>
</html>
`;

const postPage = (post) => `<!doctype html>
<!--
  Generated by scripts/build-blog.mjs from
  content/blog/${post.date}-${post.slug}.md. Edit the Markdown, not this file.
-->
<html lang="en">
${head({
  title: `${post.title} · ${TITLE}`,
  description: post.description,
  canonical: post.url,
  ogType: 'article',
  share: shareCard(post.slug),
  extra:
    `    <meta property="article:published_time" content="${post.date}" />\n` +
    (post.updated ? `    <meta property="article:modified_time" content="${post.updated}" />\n` : '') +
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      ...(post.updated ? { dateModified: post.updated } : {}),
      url: post.url,
      inLanguage: 'en',
      isPartOf: { '@type': 'Blog', name: TITLE, url: BLOG },
      publisher: { '@type': 'Organization', name: 'Log', url: SITE },
    }),
})}
  <body>
    <div class="wrap">
      <nav class="top">
        ${MARK}
        <a href="/blog">${TITLE}</a>
      </nav>

      <article>
        <header>
          <time datetime="${post.date}">${longDate(post.date)}</time>
          <h1>${escapeHtml(post.title)}</h1>
          <p class="lede">${escapeHtml(post.description)}</p>
        </header>
        <div class="body">
        ${post.body}
        </div>
      </article>

${shareRow(post)}

${handoff(post)}

      <footer>
        <p>
          <a href="/blog">${TITLE}</a> &middot; <a href="/">The three apps</a> &middot;
          <a href="/blog/feed.xml">RSS</a> &middot; <a href="/sitemap">Sitemap</a>
        </p>
${HELPLINE}
      </footer>
    </div>
  </body>
</html>
`;

/**
 * RSS 2.0. `lastBuildDate` is the newest post rather than the clock, so two
 * builds of the same posts produce the same bytes and nobody's reader is told
 * something changed when nothing did.
 */
/**
 * The same HTML, with its links pointing somewhere a reader can follow.
 *
 * The page pipeline keeps hrefs exactly as the Markdown wrote them, which for
 * these posts means root-relative: `/app`, `/running-bad`, `/blog/<slug>`.
 * That is right on the site and wrong in a feed. RSS has no base URL and
 * `content:encoded` carries no `xml:base`, so a reader resolves them against
 * its own origin or against nothing at all, and the call to action every post
 * ends on is dead in every reader that renders full content.
 *
 * Only on the way into the feed. The HTML the site serves is untouched, and
 * `<link>` and `<guid>` beside this were already absolute, so the generator
 * had the absolute form to hand the whole time.
 */
const absolute = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${SITE}/`);

const feed = (posts) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeHtml(TITLE)}</title>
    <link>${BLOG}</link>
    <atom:link href="${BLOG}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeHtml(TAGLINE)}</description>
    <language>en</language>${posts.length ? `
    <lastBuildDate>${feedDate(posts[0].updated ?? posts[0].date)}</lastBuildDate>` : ''}
${posts.map((post) => `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${post.url}</link>
      <guid isPermaLink="true">${post.url}</guid>
      <pubDate>${feedDate(post.date)}</pubDate>
      <description>${escapeHtml(post.description)}</description>
      <content:encoded><![CDATA[${absolute(post.body).replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
    </item>`).join('\n')}
  </channel>
</rss>
`;

/**
 * One sitemap, at the address robots.txt already names.
 *
 * `public/sitemap.xml` stays the hand-written truth for the front door, the app
 * and the four guides, and the posts are appended to a copy of it here, so that
 * publishing never means remembering to edit a second file.
 */
const sitemap = (posts) => {
  const base = readFileSync(join(PUBLIC, 'sitemap.xml'), 'utf8');
  if (!base.includes('</urlset>')) throw new Error('public/sitemap.xml has no </urlset> to extend');
  if (!posts.length) return base;

  const entry = (loc, lastmod, changefreq, priority) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>
`;
  const urls =
    entry(BLOG, posts[0].updated ?? posts[0].date, 'weekly', '0.7') +
    posts.map((post) => entry(post.url, post.updated ?? post.date, 'yearly', '0.6')).join('');

  return base.replace('</urlset>', `${urls}</urlset>`);
};

/**
 * The sitemap a person can read, at /sitemap.
 *
 * The XML one is for crawlers and says nothing a reader would want: a list of
 * addresses, no titles, no order that means anything. This is the same list
 * with the names on, which is the page somebody lands on when they know the
 * site has written something about bankrolls and cannot remember where.
 *
 * Built here rather than beside the guides because this is the generator that
 * knows the posts. `build-content.mjs` writes four fixed files and has never
 * read `content/blog`; a sitemap page it produced would be missing every post
 * published after it last ran.
 */
const sitemapPage = (posts) => {
  const section = (heading, rows) => `      <h2>${heading}</h2>
      <ul class="posts">
${rows.join('\n')}
      </ul>`;

  const fixed = ([href, label]) => `        <li>
          <a href="${href}">
            <span class="name">${escapeHtml(label)}</span>
            <span class="what">${escapeHtml(href)}</span>
          </a>
        </li>`;

  const written = (post) => `        <li>
          <a href="${post.path}">
            <time datetime="${post.date}">${longDate(post.date)}</time>
            <span class="name">${escapeHtml(post.title)}</span>
            <span class="what">${escapeHtml(post.description)}</span>
          </a>
        </li>`;

  const body = [
    section('The site', TOP.map(fixed)),
    section('Guides', GUIDES.map(fixed)),
    // The index itself, then what is in it. It is in the XML sitemap and a
    // reader wants it for the same reason a crawler does: it is where the
    // next post will appear.
    posts.length
      ? section('Writing', [fixed([BLOG.replace(SITE, ''), TITLE]), ...posts.map(written)])
      : '',
  ].filter(Boolean).join('\n\n');

  return `<!doctype html>
<!--
  Everything on log.poker, generated by scripts/build-blog.mjs. The fixed pages
  come from scripts/pages.mjs and the posts from content/blog, so nothing here
  is a list anybody maintains by hand.
-->
<html lang="en">
${head({
  title: 'Everything on log.poker',
  description: 'Every page on log.poker: the app, the four guides, and every post.',
  canonical: `${SITE}/sitemap`,
  ogType: 'website',
  share: shareCard('blog'),
})}
  <body>
    <div class="wrap">
      <nav class="top">
        ${MARK}
        <a href="/">log.poker</a>
      </nav>

      <header class="masthead">
        <p class="eyebrow">Sitemap</p>
        <h1>Everything on log.poker</h1>
        <p class="lede">Every page here, which is not many. That is on purpose.</p>
      </header>

${body}

      <footer>
        <p>
          <a href="/">The three apps</a> &middot; <a href="/app">Log</a> &middot;
          <a href="/blog">Writing</a> &middot; <a href="/blog/feed.xml">RSS</a>
        </p>
${HELPLINE}
      </footer>
    </div>
  </body>
</html>
`;
};

/**
 * The two sitemaps list the same pages, and this is what makes that true.
 *
 * They are generated from different sources -- the XML from the hand-written
 * `public/sitemap.xml` plus the posts, the page from `scripts/pages.mjs` plus
 * the posts -- so nothing but a comparison stops one gaining an address the
 * other never hears about. Adding a page to the XML and forgetting the list
 * publishes a sitemap that is missing a page, which is a worse failure than no
 * sitemap: it reads as complete.
 */
const agree = (xml, page) => {
  const crawled = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].replace(SITE, '').replace(/^$/, '/'))
    .sort();
  const linked = [...page.matchAll(/<li>\s*<a href="([^"]+)"/g)].map((match) => match[1]).sort();

  const missing = crawled.filter((loc) => !linked.includes(loc));
  const extra = linked.filter((href) => !crawled.includes(href));
  if (missing.length || extra.length) {
    throw new Error(
      'the two sitemaps disagree; /sitemap is built from scripts/pages.mjs and ' +
      'sitemap.xml from public/sitemap.xml' +
      (missing.length ? `\n  in the XML and not on the page: ${missing.join(', ')}` : '') +
      (extra.length ? `\n  on the page and not in the XML: ${extra.join(', ')}` : ''),
    );
  }
};

const write = (relative, contents) => {
  const target = join(OUT, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

const posts = readPosts(POSTS, renderMarkdown);

// Cleared rather than written over, so a renamed or deleted post stops being
// served instead of lingering at its old URL for as long as the site exists.
rmSync(join(OUT, 'blog'), { recursive: true, force: true });
write(join('blog', 'index.html'), indexPage(posts));
write(join('blog', 'feed.xml'), feed(posts));
for (const post of posts) write(join('blog', post.slug, 'index.html'), postPage(post));
const xml = sitemap(posts);
const page = sitemapPage(posts);
agree(xml, page);
write('sitemap.xml', xml);
write(join('sitemap', 'index.html'), page);

console.log(
  `${TITLE}: ${posts.length} post${posts.length === 1 ? '' : 's'} at /blog` +
  `${posts.length ? `, newest ${posts[0].slug}` : ''}, a feed, and ` +
  // Counted out of the file rather than worked out again. This said
  // `posts.length + 2`, which was the arithmetic when `public/sitemap.xml`
  // held the front door and the app; it holds six URLs now, and the line
  // under-reported by five without anything going wrong.
  `${(xml.match(/<loc>/g) ?? []).length} sitemap entries`,
);
