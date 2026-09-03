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
 * Signing in currently unlocks nothing, because cross-device history is not
 * built yet: somebody who typed their address, waited for mail and read a code
 * off a phone would arrive back at a screen that looks exactly as it did
 * before. A dead end is worse than an absence, so it stays out of production
 * builds until there is something on the other side of it.
 *
 * **Flip this to `true` when sync lands.** That is the whole of what it takes;
 * the card, the client and the endpoint it talks to are all built. See SYNC.md.
 */
export const ALLOW_SIGN_IN = IS_DEV;

/**
 * Where each app lives. `log.poker` is the family's front door and Log itself
 * is under /app, so a link meant to open the app has to say so.
 */
export const FAMILY_LINKS = {
  untilt: 'https://untilt.poker',
  tiltproof: 'https://tiltproof.poker',
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
