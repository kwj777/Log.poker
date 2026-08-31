/**
 * The card protector campaign.
 *
 * This is the single source of truth for a string that gets fired into a kiln.
 * Once a chip is printed the URL it carries cannot be edited, so the value
 * belongs in one place that a test can check rather than in a design file, a
 * QR generator's input box, and a landing page's canonical tag separately.
 *
 * `log.poker/chip` is served by `public/chip.html` through a rewrite in
 * `netlify.toml` that sits above the single-page catch-all. It must resolve
 * for as long as any chip exists.
 */

/** How a chip was read. `nfc` is unbuilt and costs nothing to leave room for. */
export type ChipMedium = 'qr' | 'nfc';

export const CHIP_CAMPAIGN = {
  /** The landing itself, with no parameters. Also its canonical URL. */
  url: 'https://log.poker/chip',
  /** The path the rewrite answers on, for tests and for local checks. */
  path: '/chip',
  utmSource: 'protector',
  utmCampaign: 'giveaway',
} as const;

/**
 * What to encode. Pass `qr` for the printed code and `nfc` for a tag, which is
 * the only difference between the two and the whole reason the medium is a
 * parameter: it makes tap against scan answerable later without reprinting
 * anything.
 */
export const chipUrl = (medium: ChipMedium): string =>
  `${CHIP_CAMPAIGN.url}` +
  `?utm_source=${CHIP_CAMPAIGN.utmSource}` +
  `&utm_medium=${medium}` +
  `&utm_campaign=${CHIP_CAMPAIGN.utmCampaign}`;
