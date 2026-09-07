/**
 * Where a hand-off goes, as pure functions over records.
 *
 * Split from `hooks.ts`, which imports `Linking` from react-native and so
 * cannot be loaded by this repository's test runner: the suite is plain ts-jest
 * in Node, deliberately, because everything worth testing here is pure
 * TypeScript. That one import made these URL builders untestable by accident of
 * sharing a file with a two-line wrapper, which is why they had no tests until
 * one of them started being offered to somebody mid-session.
 *
 * The opening half stayed behind. Building a URL and following one are
 * different jobs and only the first has anything to get wrong.
 *
 * The hand-off payload is the stable notation from `handNotation.ts` -- the
 * whole reason hands are stored in that format rather than as free text.
 */

import { FAMILY_LINKS } from '../../config';
import { toHandClass } from '../../domain/handNotation';
import type { Hand, Position } from '../../domain/types';

export interface DrillHandOff {
  url: string;
  label: string;
  /** The hand class (`AKo`) when the cards are known, else null. */
  handClass: string | null;
}

/**
 * "Drill this in TiltProof" for a hand the player flagged as misplayed.
 *
 * Post-MVP this becomes a real hand-off -- the drill opens preloaded with the
 * spot. For now it carries the hand class and position as query parameters so
 * the landing page can at least greet the player with the right spot, and so
 * the link shape does not have to change later.
 */
export const drillHandOff = (hand: Pick<Hand, 'holeCards' | 'position'>): DrillHandOff => {
  const handClass = toHandClass(hand.holeCards);
  const params = new URLSearchParams({ source: 'log' });
  if (handClass !== null) params.set('hand', handClass);
  if (hand.position !== null) params.set('position', hand.position as Position);

  return {
    url: `${FAMILY_LINKS.tiltproof}/drill?${params.toString()}`,
    label: handClass === null ? 'Drill this spot in TiltProof' : `Drill ${handClass} in TiltProof`,
    handClass,
  };
};

/**
 * The Untilt suggestion shown when the variance view finds a rough stretch.
 * Post-MVP this passes the stretch itself so Untilt can open on the right
 * exercise instead of the front page.
 */
export const untiltHandOff = (verdict: string): { url: string; label: string } => ({
  url: `${FAMILY_LINKS.untilt}?source=log&context=${encodeURIComponent(verdict)}`,
  label: 'Open Untilt.poker',
});

/**
 * The meditation Untilt opens for a mid-session reset.
 *
 * Verified rather than guessed. Untilt's own `#quick-reset` button opens this
 * id, it appears in that app's `SAMPLE_IDS`, which its source documents as
 * "the free meditation a sample comes from", and its `isLocked` only ever
 * returns true for a premium meditation with no cues. So this is free, it needs
 * no account, and it is sixty seconds, which is what makes it the right thing
 * to put in front of somebody sitting at a table.
 *
 * An id Untilt does not recognize fails safe over there: `readArrival` resolves
 * it to null and the app opens normally. That is worth knowing but is not a
 * reason to be careless, because the failure is silent.
 */
export const RESET_MEDITATION_ID = 'sixty-second-reset';

/**
 * "Take sixty seconds", for a player who just logged that they are rattled.
 *
 * `play=<id>` is Untilt's shareable form of a meditation, so this lands in the
 * exercise rather than on a home screen the player then has to navigate. The
 * mood score is deliberately **not** in the URL: nothing over there reads it,
 * Untilt strips the whole query on arrival anyway, and a link that says out
 * loud how tilted somebody is has no business being in an address bar or a
 * browser history.
 */
export const resetHandOff = (): { url: string; label: string } => ({
  url: `${FAMILY_LINKS.untilt}?source=log&play=${RESET_MEDITATION_ID}`,
  label: 'Take sixty seconds',
});
