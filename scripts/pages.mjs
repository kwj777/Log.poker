/**
 * The pages the site has, named once.
 *
 * Two generators need this list and they used to have half of it each:
 * `build-content.mjs` carried the guide titles for the cross-links at the foot
 * of every guide, and nothing else knew them. The sitemap page needs the same
 * four with the same names, and a second copy of a list is a list that goes
 * wrong in one place -- which is the argument that put the guides in a
 * generator to begin with.
 *
 * **What is here is what a person can be sent to.** The addresses that exist
 * and are not pages stay out, on the same reasoning `public/sitemap.xml`
 * gives for leaving them out of the XML: `/chip` is noindex, `/apps` is a 301,
 * and the prerendered routes under `/app` are one document canonicalizing onto
 * `/app`. The blog is not here either, because its posts are read from
 * `content/blog` at build time and a list of them typed here would be stale
 * the next time somebody published one.
 */

/** The front door and the app, in the order somebody arriving wants them. */
export const TOP = [
  ['/', 'The three apps'],
  ['/app', 'Log, the session log'],
];

/**
 * The four guides.
 *
 * The order is the one the guides cross-link in, which is roughly the order
 * somebody meets the questions: whether the last month means anything, then
 * how much money it takes, then the arithmetic at the table, then what it
 * costs to lose your temper.
 */
export const GUIDES = [
  ['/running-bad', 'Running bad or playing bad'],
  ['/bankroll', 'How big a bankroll'],
  ['/pot-odds', 'Pot odds and outs'],
  ['/tilt', 'Tilt'],
];
