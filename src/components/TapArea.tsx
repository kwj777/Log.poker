/**
 * The compensation `hitSlop` makes on native, made real on the web.
 *
 * Four controls in this app draw smaller than `layout.tapTarget` on purpose
 * and make the shortfall up in touch area rather than in pixels: a `small`
 * Button, the amount presets, the search field's clear glyph and `Explain`'s
 * badge. Each says so in its own comment, and one of them cites another.
 *
 * **None of it was happening on the web.** `hitSlop` is not implemented by
 * react-native-web: the prop appears nowhere in `modules/forwardedProps`, so
 * `createDOMProps` drops it and nothing reaches the DOM. `grep -rn hitSlop
 * node_modules/react-native-web/dist` finds it only inside the legacy
 * `exports/Touchable`. So on the platform `app/+html.tsx` calls "the one
 * platform most people will meet Log on first" -- iOS Safari, where these are
 * thumbs and not a mouse -- those controls really were 36, 40, 22 and 18
 * points, with no compensation at all, under four comments saying otherwise.
 *
 * ## Why a child rather than a bigger box
 *
 * Growing the element grows what it paints: these all carry a background, a
 * border or both, so padding would make a `small` button look like a medium
 * one on the web and nowhere else. An absolutely positioned child extends past
 * its parent's box without touching what the parent draws, and a press on it
 * is a press inside the parent as far as the DOM is concerned.
 *
 * Measured in Chromium rather than assumed, on the shape react-native-web
 * really renders (a `<button>` with `position: relative` and RN-web's own base
 * style):
 *
 *     computed overflow: visible
 *     middle      REACHES BUTTON (SPAN.area)
 *     3px above   REACHES BUTTON (SPAN.area)
 *     5px above   REACHES BUTTON (SPAN.area)
 *     10px above  misses (DIV.spacer)
 *
 * So the area reaches exactly as far as it is given and no further, which is
 * the same bargain `hitSlop` makes.
 *
 * Web only. On native `hitSlop` already does this, and a second mechanism
 * would be two things to keep in step.
 */

import { Platform, StyleSheet, View } from 'react-native';

import { layout } from '../theme';

/** What a control is short of the floor, split evenly above and below it. */
export const slopFor = (drawn: number): { top: number; bottom: number } | undefined => {
  const short = layout.tapTarget - drawn;
  return short > 0 ? { top: Math.ceil(short / 2), bottom: Math.ceil(short / 2) } : undefined;
};

/** The same shape `hitSlop` takes: one number for every side, or a side each. */
export type Slop = number | { top?: number; bottom?: number; left?: number; right?: number };

/** Negated, and `0` rather than `-0`, which is a real value in a style object. */
const out = (points = 0) => (points === 0 ? 0 : -points);

const insets = (slop: Slop) =>
  typeof slop === 'number'
    ? { top: out(slop), bottom: out(slop), left: out(slop), right: out(slop) }
    : {
        top: out(slop.top),
        bottom: out(slop.bottom),
        left: out(slop.left),
        right: out(slop.right),
      };

/**
 * Renders inside the Pressable it belongs to, and is given the same `slop`
 * that Pressable hands `hitSlop`, so the two cannot drift apart.
 */
export const TapArea = ({ slop }: { slop?: Slop }) => {
  if (Platform.OS !== 'web' || slop === undefined) return null;
  return <View style={[styles.area, insets(slop)]} />;
};

const styles = StyleSheet.create({
  area: {
    position: 'absolute',
  },
});
