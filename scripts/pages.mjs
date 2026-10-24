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

/**
 * Log's App Store ID, the number every App Store address carries.
 *
 * It is the same number `eas.json` submits under, and a test holds the two
 * together. It is a fact about the app rather than about whoever submits it,
 * so it is public in every link to the listing and belongs here, where the
 * generated pages can reach it.
 *
 * It went on the site the day Log 1.0 was approved (2026-09-29) and not
 * before, because App Review opens the marketing URL and a download link to
 * an app that is not in the store yet is an easy rejection.
 */
export const APP_STORE_ID = '6814843842';

/** The listing itself. apps.apple.com resolves the bare ID to it. */
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

/**
 * Safari's Smart App Banner: on an iPhone it offers the app from the top of
 * the page, and says Open instead once the app is installed. Every other
 * browser ignores it.
 *
 * It goes on the marketing pages only, never on the app under `/app`. That is
 * where `/claim` spends a single-use handoff code for the family pass, and a
 * banner whose Open button leaves the page for the native app would leave the
 * code unspent and the pass on the web.
 */
export const APP_STORE_BANNER = `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}" />`;

/**
 * Log's Google Play package, which is also its address on Play.
 *
 * It is `expo.android.package` in `app.json`, and a test holds the two
 * together. Play never lets a package name change, so this is permanent.
 *
 * It went on the site once Log was live in production on Google Play
 * (2026-10-24), for the same reason the App Store ID waited for approval.
 *
 * There is no Android counterpart to the Safari banner here. Chrome's nearest
 * thing is `related_applications` with `prefer_related_applications` in the web
 * manifest, and that manifest belongs to the app under `/app`: it would swap
 * the app's own install prompt for a trip to Play, the same stranding the
 * banner is kept off `/app` to avoid.
 */
export const PLAY_PACKAGE = 'poker.log.app';

/** The listing itself. */
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

/**
 * The two store badges, side by side under "Get the log". Each is the store's
 * own artwork, unaltered, served from /badges so the page fetches nothing from
 * anywhere else. They render at the same height, as Google's badge guidelines
 * ask, and the gap between them is the clear space both guidelines want.
 */
export const STORE_BADGES = `<p class="stores">
          <a class="store" href="${APP_STORE_URL}">
            <img src="/badges/app-store.svg" width="144" height="48" alt="Download on the App Store" />
          </a>
          <a class="store" href="${PLAY_URL}">
            <img src="/badges/google-play.svg" width="162" height="48" alt="Get it on Google Play" />
          </a>
        </p>`;
