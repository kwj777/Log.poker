/**
 * Contextual hand-offs to the rest of the app family.
 *
 * These are the seams for the post-MVP integrations, deliberately built as one
 * function each so the call sites never learn how the hand-off works. Today they
 * produce a URL and the caller opens it; when the apps share an account and a
 * deep link (or a native module), only these functions change.
 *
 * The hand-off payload is the stable notation from `handNotation.ts` — the whole
 * reason hands are stored in that format rather than as free text.
 */

import { Linking } from 'react-native';

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
 * Post-MVP this becomes a real hand-off — the drill opens preloaded with the
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

export const openHandOff = (url: string): void => {
  void Linking.openURL(url).catch(() => {
    // A missing browser or a blocked pop-up is not worth an error dialog over a
    // cross-promo link.
  });
};
