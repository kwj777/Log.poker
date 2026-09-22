/**
 * The top of a screen, against the notch it has never met.
 *
 * Every route in this app is drawn with `headerShown: false`, so nothing sits
 * above a screen to hold the status bar off it. That makes the top inset
 * `Screen`'s own responsibility, and it was not being applied: `insets.bottom`
 * was read and `insets.top` was not, anywhere in the tree.
 *
 * It survived because a browser tab reports a zero top inset and a browser was
 * the only place this app had ever run. The first time it opened on a phone the
 * Back control was drawn underneath the clock, half occluded and impossible to
 * tap, which is the shape of this bug: nothing throws, nothing logs, a control
 * is simply not there.
 *
 * `src/__tests__/support/screen.tsx` has modelled a notched phone since it was
 * written, "so the insets are non-zero and exercised". They were non-zero and
 * nothing exercised them. This is the assertion that was missing.
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { Screen } from '../Screen';
import { Text } from '../Text';
import { colors } from '../../theme';

const FRAME = { x: 0, y: 0, width: 390, height: 844 };

const NOTCH: Metrics = { frame: FRAME, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const FLAT: Metrics = { frame: FRAME, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

type Node = { props?: Record<string, unknown>; children?: unknown[] } | string | null;

/**
 * The screen's own outermost view, found by what only it looks like.
 *
 * `styles.root` is the one view in here that both fills the window and paints
 * the app background: `center` and `scroll` also flex, and neither carries a
 * color. Read off the rendered tree rather than out of the stylesheet, because
 * the inset is applied at the call site and a stylesheet cannot show that.
 */
const rootStyleOf = (node: Node): Record<string, unknown> | null => {
  if (node === null || typeof node === 'string') return null;

  const style = StyleSheet.flatten(node.props?.style as never) as
    | Record<string, unknown>
    | undefined;
  if (style !== undefined && style.flex === 1 && style.backgroundColor === colors.background) {
    return style;
  }

  for (const child of (node.children ?? []) as Node[]) {
    const found = rootStyleOf(child);
    if (found !== null) return found;
  }
  return null;
};

const paddingTopUnder = async (metrics: Metrics): Promise<unknown> => {
  const view = await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Screen>
        <Text>anything</Text>
      </Screen>
    </SafeAreaProvider>,
  );
  return rootStyleOf(view.toJSON() as Node)?.paddingTop;
};

describe('a screen, which has no header above it', () => {
  it('holds its first element below the status bar on a notched phone', async () => {
    expect(await paddingTopUnder(NOTCH)).toBe(NOTCH.insets.top);
  });

  it('and adds nothing where there is no inset, which is every browser tab', async () => {
    // The pair matters more than either half. A constant large enough to clear
    // a notch would pass the test above and put a gap at the top of the web
    // app, where this has always drawn correctly and must keep drawing.
    expect(await paddingTopUnder(FLAT)).toBe(0);
  });
});
