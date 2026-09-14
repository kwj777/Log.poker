/**
 * Build-time flags.
 *
 * `__DEV__` is defined by Metro on every platform (and by the web bundler), so
 * dev-only surfaces are stripped from a production bundle by dead-code
 * elimination rather than merely hidden at runtime.
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
 * the card out of the next build and the endpoint keeps refusing on its own
 * limits meanwhile. One line, and it strips rather than hides.
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
