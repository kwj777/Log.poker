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

export const FAMILY_LINKS = {
  untilt: 'https://untilt.poker',
  tiltproof: 'https://tiltproof.com',
  log: 'https://log.poker',
} as const;
