/**
 * Build-time flags.
 *
 * `__DEV__` is defined by Metro on every platform (and by the web bundler), so
 * the constants below are decided while the bundle is built: in a production
 * web build `IS_DEV` and `ALLOW_DEMO_SEED` both compile down to a literal
 * `false` inside this module.
 *
 * That is as far as it goes, and the difference matters. Every export here
 * leaves the module through a getter, and a use site in another file reads it
 * through that getter, which the minifier will not fold. So
 * `{ALLOW_DEMO_SEED ? <card /> : null}` survives as a runtime ternary, and
 * everything on the branch that can never be taken ships with it: a real
 * production bundle of this app contains the demo seeder, its venue names and
 * the "Load demo data" button, and simply never draws them.
 *
 * So these flags hide; they do not strip. A `false` here means no player can
 * reach the surface, not that the code is gone. Anything that must not run in
 * a real build wants a second guard at the point where it would do the damage.
 */

export const IS_DEV: boolean = typeof __DEV__ !== 'undefined' && __DEV__;

/** Gates the demo-data seeder in Settings. */
export const ALLOW_DEMO_SEED = IS_DEV;

/**
 * Gates the sign-in card in Settings.
 *
 * On, because the thing it unlocks exists now. It was `IS_DEV` for two phases
 * on the argument that a form which cannot succeed is worse than an absence,
 * and that argument expired the day the chain worked end to end against the
 * live site: ask, mail, redeem, and a free-tier token accepted by `/api/sync`.
 *
 * **Left as a constant rather than deleted, because it is the kill switch.**
 * `/api/signin` mails a code to anybody who types an address, which is the
 * point of it and also the whole risk in it. If that is ever being abused, or
 * the mail costs something worth caring about, setting this to `false` takes
 * the card off the one screen that renders it, and the endpoint keeps refusing
 * on its own limits meanwhile. One line, and there is nowhere left to reach
 * the form. The card's code still ships either way, per the header above, so
 * this is a switch on the door rather than a wall: what stops a request made
 * some other way is the endpoint, not this.
 */
export const ALLOW_SIGN_IN = true;

/**
 * The id on the bottom tab bar, and the one thing two layers have to agree on.
 *
 * `app/+html.tsx` styles that element by hand, because clearing iOS Safari's
 * toolbar needs `calc(100dvh - 100svh)` and a React Native style cannot say it.
 * A selector and an element that drift apart do not fail: the rule stops
 * matching and the bar quietly goes back under the toolbar. So the string lives
 * here, where neither side owns it, rather than being written out twice.
 *
 * Here rather than beside the component because the web shell should not have
 * to import a component to render its own stylesheet, and because a test can
 * read this file without standing up React Native.
 */
export const BOTTOM_BAR_ID = 'log-tab-bar';

const TILTPROOF_HOST = 'https://tiltproof.poker';

/**
 * Where each app lives. `log.poker` is the family's front door and Log itself
 * is under /app, so a link meant to open the app has to say so.
 *
 * **TiltProof is laid out the same way, and that turns out to be load-bearing.**
 * It serves a landing page at `/`, the app under `/app` and `/app/*`, and
 * answers everything else with the app shell under a 404. So `tiltproof` is the
 * front door -- the right thing for a cross-promo card, which wants the landing
 * page -- and anything meant to open a *screen* in that app has to go through
 * `tiltproofApp`.
 *
 * Kept as two entries rather than one because a link that drops the prefix does
 * not fail loudly. It renders "That page does not exist", which is how the
 * hand-off at `/drill?hand=...` stayed broken for its whole shipped life.
 * Neither repository had the prefix written down anywhere, which is most of why
 * nobody caught it, so it is written down here.
 */
export const FAMILY_LINKS = {
  untilt: 'https://untilt.poker',
  tiltproof: TILTPROOF_HOST,
  tiltproofApp: `${TILTPROOF_HOST}/app`,
  log: 'https://log.poker/app',
} as const;

/** The marketing site, for a link that means the family rather than the app. */
export const FAMILY_HOME = 'https://log.poker';

/**
 * The guides on the marketing site, for a screen that wants to hand somebody
 * the long version of what it is showing them.
 *
 * Absolute rather than relative, because this app also runs natively, where
 * "/running-bad" means nothing. On web the app is under /app on the same
 * origin, so these stay same-site there too.
 *
 * `/pot-odds` and `/tilt` exist as well, and belong to TiltProof and Untilt
 * rather than to any screen here.
 */
export const GUIDES = {
  runningBad: `${FAMILY_HOME}/running-bad`,
  bankroll: `${FAMILY_HOME}/bankroll`,
} as const;

/**
 * The two addresses an app store asks for and a person occasionally needs.
 *
 * Absolute for the same reason the guides above are: this app runs natively,
 * where "/privacy" means nothing. On web it is the same origin, since the app
 * is served from /app on the site that hosts the page.
 *
 * **The privacy policy is a submission requirement, not a nicety.** App Store
 * Connect will not accept a build without a URL for one, and the page it
 * points at has to still be there afterwards. It is generated by
 * `scripts/build-content.mjs` alongside the guides, so it is deployed with
 * every build of the site rather than being a document somebody has to
 * remember to keep hosted.
 *
 * `SUPPORT_EMAIL` is the other half of the same requirement. It is an address
 * at the apex, which is the domain `netlify/functions/signin.mts` already
 * sends from, so it is a mailbox on a domain this project controls rather
 * than a third party's form. It has to actually receive mail before the first
 * submission: a support address that bounces is worse than none, and is one
 * of the few things App Review checks by using it.
 */
export const PRIVACY_POLICY = `${FAMILY_HOME}/privacy`;

/** Where somebody writes when the app is wrong. See `PRIVACY_POLICY` above. */
export const SUPPORT_EMAIL = 'support@log.poker';
