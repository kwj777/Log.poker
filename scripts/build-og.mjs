/**
 * Share cards: one 1200x630 PNG per post, under `public/og`.
 *
 * A link to a post gets unfurled by Slack, iMessage, Discord and every social
 * site, and none of them render SVG, so the one image the blog cannot draw in
 * the browser is the one everybody sees first. This draws it as SVG anyway,
 * using the same card art as the hand diagrams, and then rasterizes it.
 *
 * **The PNG is the artifact and it is committed.** Nothing in the site build
 * runs this file: `scripts/build-blog.mjs` only points `og:image` at what it
 * finds in `public/og`, and falls back to the app icon for a post with no card
 * yet. So a deploy never depends on a rasterizer being installable, which is
 * the whole reason to keep it out of the build.
 *
 *     npm run build:og
 *
 * An argument writes the cards somewhere else, which is how the tests check
 * one without touching what is committed.
 *
 * A card opens on the hand the post is about: the cards its figure marks as
 * played, which for these two posts is exactly the straight flush and the
 * flush that never arrived, with the post's first stat in gold beside it. A
 * post with no hand in it opens on that stat alone, under the title, so a link to an essay still unfurls
 * as a picture with something in it. A post with neither gets the title alone.
 *
 * Fonts are the one thing here that is not fully in the repository's hands.
 * The card asks for the same stack the site does, Georgia first, and a Linux
 * machine will not have it: it renders in Liberation Serif, which is metric
 * compatible with Times New Roman and already second in that stack. Two
 * machines can therefore draw very slightly different cards, which is exactly
 * why the PNG is committed rather than generated on the way to production.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD, PALETTE, SANS, SERIF, card, playedHand } from './draw-hand.mjs';
import { TAGLINE, TITLE, figureOf, longDate, readPosts, statOf } from './posts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'public', 'og'));
const POSTS = resolve(process.argv[3] ?? join(ROOT, 'content', 'blog'));

const W = 1200;
const H = 630;
const PAD = 80;
/** The title never runs to the edge; a share card is read at thumbnail size. */
const TITLE_WIDTH = W - PAD * 2;
/** Big enough to read in a Slack unfurl, and it steps down if it has to. */
const TITLE_SIZES = [64, 56, 48];
const TITLE_LINES = 3;
/** The hand, drawn a quarter larger than it is in the post. */
const HAND_SCALE = 1.25;
const HAND_CARDS = 5;
/** The break between the two that were mine and what the board gave. */
const HOLE_GAP = 24;
/** A post's first stat, for a card with no hand to draw. */
const STAT_SIZE = 112;
const STAT_BASELINE = 500;
/** The stat beside a hand: right-aligned, bottom level with the cards. */
const BESIDE_SIZE = 80;
const BESIDE_BASELINE = 494;
/** The widest a hand can draw: five cards and the break, at card scale. */
const HAND_SPAN = (HAND_CARDS * (CARD.w + 10) + HOLE_GAP) * HAND_SCALE;

/** Hole cards, a break, then the board, up to what fits across the card. */
const layout = ({ hole, board }) => {
  const step = CARD.w + 10;
  const shown = [];
  let x = 0;
  for (const spec of hole.slice(0, HAND_CARDS)) {
    shown.push({ spec, x });
    x += step;
  }
  if (shown.length && board.length) x += HOLE_GAP;
  for (const spec of board.slice(0, HAND_CARDS - shown.length)) {
    shown.push({ spec, x });
    x += step;
  }
  return shown;
};

const { Resvg } = await import('@resvg/resvg-js').catch(() => {
  throw new Error('share cards need @resvg/resvg-js: run npm install');
});

const FONT = { loadSystemFonts: true, defaultFontFamily: 'Liberation Serif' };

const escapeXml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Text width, measured by rendering it.
 *
 * Estimating from a character count puts a long title through the edge of the
 * card, and the only thing that knows the real width is the renderer that is
 * about to draw it, so ask that.
 */
const widths = new Map();
const measure = (text, size) => {
  const key = `${size}:${text}`;
  if (!widths.has(key)) {
    const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${size * 3}">` +
      `<text x="0" y="${size * 2}" font-family="${SERIF}" font-size="${size}">${escapeXml(text)}</text></svg>`;
    widths.set(key, new Resvg(probe, { font: FONT }).getBBox()?.width ?? 0);
  }
  return widths.get(key);
};

const wrap = (text, size, maxWidth) => {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

/** The largest size at which the title fits in three lines. */
const fitTitle = (text) => {
  for (const size of TITLE_SIZES) {
    const lines = wrap(text, size, TITLE_WIDTH);
    if (lines.length <= TITLE_LINES) return { size, lines };
  }
  const size = TITLE_SIZES[TITLE_SIZES.length - 1];
  return { size, lines: wrap(text, size, TITLE_WIDTH).slice(0, TITLE_LINES) };
};

/** The family mark, nothing lit, because the blog is the family rather than an app. */
const mark = (x, y, size) => `  <g transform="translate(${x} ${y}) scale(${size / 200})"
    fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M100 125 L100 163" stroke="${PALETTE.GOLD}" stroke-width="8" />
    <path d="M34 125 L166 125 L100 37 Z" stroke="#9aae80" stroke-width="6" />
    <path d="M56 125 L100 66 L144 125" stroke="#75886a" stroke-width="6" />
    <path d="M78 125 L100 96 L122 125" stroke="#55665e" stroke-width="6" />
  </g>`;

const label = (x, y, text, { size = 22, fill = PALETTE.DIM, anchor = 'start' } = {}) =>
  `  <text x="${x}" y="${y}" font-family="${SANS}" font-size="${size}" letter-spacing="3"
    text-anchor="${anchor}" fill="${fill}">${escapeXml(text)}</text>`;

/**
 * The card. Title bottom-anchored above the hand, so a one-line title and a
 * three-line one both sit where the eye lands rather than drifting up the page.
 */
const shareCard = ({ title, subtitle, footer, cards, stat = null }) => {
  const { size, lines } = fitTitle(title);
  const leading = Math.round(size * 1.2);
  const lastBaseline = cards.length || stat ? 344 : 380;
  const parts = [];

  parts.push(`  <rect width="${W}" height="${H}" fill="${PALETTE.GROUND}" />`);
  parts.push(`  <rect y="${H - 8}" width="${W}" height="8" fill="${PALETTE.GOLD}" />`);
  parts.push(mark(PAD, 48, 60));
  parts.push(label(PAD + 78, 92, TITLE.toUpperCase(), { fill: PALETTE.MUTED }));

  lines.forEach((line, index) => {
    const baseline = lastBaseline - (lines.length - 1 - index) * leading;
    parts.push(`  <text x="${PAD}" y="${baseline}" font-family="${SERIF}" font-size="${size}"
    fill="${PALETTE.CREAM}">${escapeXml(line)}</text>`);
  });

  if (subtitle) {
    wrap(subtitle, 30, TITLE_WIDTH).slice(0, 3).forEach((line, index) => {
      parts.push(`  <text x="${PAD}" y="${lastBaseline + 70 + index * 42}" font-family="${SERIF}"
    font-size="30" fill="${PALETTE.MUTED}">${escapeXml(line)}</text>`);
    });
  }

  if (cards.length) {
    parts.push(`  <g transform="translate(${PAD} 408) scale(${HAND_SCALE})">
${cards.map(({ spec, x }) => card(x, 0, spec)).join('\n')}
  </g>`);
  }

  if (cards.length && stat) {
    // Beside the hand rather than under it: the right half of a hand card is
    // empty, and the number is what the hand cost or meant.
    const room = W - PAD - (PAD + HAND_SPAN) - 60;
    const besideSize = Math.min(BESIDE_SIZE, Math.floor(BESIDE_SIZE * room / measure(stat, BESIDE_SIZE)));
    parts.push(`  <text x="${W - PAD}" y="${BESIDE_BASELINE}" font-family="${SERIF}" font-size="${besideSize}"
    text-anchor="end" fill="${PALETTE.GOLD}">${escapeXml(stat)}</text>`);
  }

  if (!cards.length && stat) {
    const statSize = Math.min(STAT_SIZE, Math.floor(STAT_SIZE * TITLE_WIDTH / measure(stat, STAT_SIZE)));
    parts.push(`  <rect x="${PAD}" y="${STAT_BASELINE - statSize * 0.78}" width="4" height="${statSize * 0.86}" fill="${PALETTE.GOLD}" />`);
    parts.push(`  <text x="${PAD + 28}" y="${STAT_BASELINE}" font-family="${SERIF}" font-size="${statSize}"
    fill="${PALETTE.GOLD}">${escapeXml(stat)}</text>`);
  }

  parts.push(label(PAD, H - 46, 'log.poker/blog', { size: 24, fill: PALETTE.DIM }));
  if (footer) parts.push(label(W - PAD, H - 46, footer, { size: 24, fill: PALETTE.DIM, anchor: 'end' }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${parts.join('\n')}
</svg>
`;
};

const write = (name, svg) => {
  const png = new Resvg(svg, { font: FONT }).render().asPng();
  writeFileSync(join(OUT, `${name}.png`), png);
  console.log(`og/${name}.png  ${(png.length / 1024).toFixed(1)}KB`);
};

const posts = readPosts(POSTS);
mkdirSync(OUT, { recursive: true });

// The blog itself, for a link to the index rather than to a post.
write('blog', shareCard({ title: TITLE, subtitle: TAGLINE, footer: null, cards: [] }));

for (const post of posts) {
  write(post.slug, shareCard({
    title: post.title,
    subtitle: null,
    footer: longDate(post.date),
    cards: layout(playedHand(figureOf(post) ?? '')),
    stat: statOf(post),
  }));
}
