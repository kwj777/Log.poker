/**
 * The card protector scan counter.
 *
 * Two counters, one per medium, and that is the whole data model. No row per
 * scan, no identifier, no timestamp, no address, nothing about the visitor:
 * the store holds an integer for `qr` and an integer for `nfc` so a later NFC
 * batch can be compared against the printed code. That is the same shape
 * Untilt's cohort beacon holds itself to, and it is the reason this campaign
 * does not need an analytics script on the one domain the other two link to.
 *
 * It fails open in every direction. An unconfigured store, a blob write that
 * throws, a medium that is not one of the two: all of them return 204 and drop
 * the count. `public/chip.html` never waits on this and never reads it, so the
 * landing page works identically when this function is not deployed at all.
 */
import { getStore } from '@netlify/blobs';

const MEDIA = new Set(['qr', 'nfc']);
const NO_CONTENT = { statusCode: 204, headers: { 'Cache-Control': 'no-store' } };

export const handler = async (event) => {
  try {
    const medium = new URL(event.rawUrl).searchParams.get('m');
    if (!MEDIA.has(medium)) return NO_CONTENT;

    const store = getStore('chip-campaign');
    const current = Number(await store.get(medium)) || 0;
    await store.set(medium, String(current + 1));
  } catch {
    // A dropped count is not worth a 500 to somebody who scanned a chip.
  }
  return NO_CONTENT;
};
