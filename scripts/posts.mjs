/**
 * What a blog post is, for everything that has to agree about one.
 *
 * `scripts/build-blog.mjs` renders the pages and `scripts/build-og.mjs` draws
 * the share cards, and both need the same answers: where a post lives, what it
 * is called, when it went out, and what URL it will be read at. That is a
 * model rather than a detail of either build, so it lives here and neither one
 * gets to have its own opinion about a date or a slug.
 *
 * The file name carries the date and the URL, and the front matter carries the
 * rest. Every complaint names the file it came from, because these are read at
 * build time by somebody who has just written a post and wants to know which
 * line of it is wrong.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SITE = 'https://log.poker';
export const BLOG = `${SITE}/blog`;
export const TITLE = 'The Log Blog';
export const TAGLINE =
  'Notes from the three apps: what the numbers can tell you, what they cannot, and the part of the game that is not the cards.';

/** `<YYYY-MM-DD>-<slug>.md`. The date orders the directory; the rest is the URL. */
const FILENAME = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** Every front matter key a post may set. An unknown one is a typo, and throws. */
const FIELDS = new Set(['title', 'description', 'updated', 'draft']);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A date is a day, so it becomes a moment at noon UTC and no reader shifts it. */
export const at = (date) => new Date(`${date}T12:00:00Z`);

/** 3 September 2026. Spelled out here rather than left to a host's locale data. */
export const longDate = (date) => {
  const day = at(date);
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
};

/** RFC 822, which is what a feed reader parses. */
export const feedDate = (date) => {
  const day = at(date);
  const dayOfMonth = String(day.getUTCDate()).padStart(2, '0');
  return `${SHORT_DAYS[day.getUTCDay()]}, ${dayOfMonth} ${SHORT_MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()} 12:00:00 GMT`;
};

/**
 * One file in, one post out. `render` turns the Markdown body into HTML, and
 * is left out by anything that only needs to know what the post is: the share
 * cards do not care how a paragraph is marked up.
 */
export const parsePost = (filename, source, render) => {
  const named = FILENAME.exec(filename);
  if (!named) throw new Error(`${filename}: name a post <YYYY-MM-DD>-<slug>.md, lowercase`);
  const [, date, slug] = named;
  if (at(date).toISOString().slice(0, 10) !== date) throw new Error(`${filename}: ${date} is not a real date`);

  const split = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!split) throw new Error(`${filename}: needs a --- front matter block, then the post`);

  const fields = {};
  for (const line of split[1].split('\n')) {
    if (!line.trim()) continue;
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`${filename}: cannot read front matter line "${line}"`);
    if (!FIELDS.has(field[1])) throw new Error(`${filename}: unknown front matter "${field[1]}"`);
    fields[field[1]] = field[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  for (const required of ['title', 'description']) {
    if (!fields[required]) throw new Error(`${filename}: needs a ${required}`);
  }
  if (fields.updated && at(fields.updated).toISOString().slice(0, 10) !== fields.updated) {
    throw new Error(`${filename}: updated ${fields.updated} is not a real date`);
  }

  return {
    slug,
    date,
    updated: fields.updated ?? null,
    title: fields.title,
    description: fields.description,
    draft: fields.draft === 'true',
    url: `${BLOG}/${slug}`,
    path: `/blog/${slug}`,
    markdown: split[2],
    body: render ? render(split[2], filename) : null,
  };
};

/** Newest first, which is the order the index and the feed both want. */
export const readPosts = (dir, render) => {
  if (!existsSync(dir)) return [];
  const posts = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parsePost(name, readFileSync(join(dir, name), 'utf8'), render))
    .filter((post) => !post.draft)
    .sort((a, b) => (a.date === b.date ? (a.slug < b.slug ? 1 : -1) : a.date < b.date ? 1 : -1));

  const slugs = new Set();
  for (const post of posts) {
    if (slugs.has(post.slug)) throw new Error(`two posts claim /blog/${post.slug}`);
    slugs.add(post.slug);
  }
  return posts;
};

/** The figure a post inlines, which is also the hand its share card opens on. */
export const figureOf = (post) => /^:::\s*figure\s+(\S+)\s*$/m.exec(post.markdown)?.[1] ?? null;
