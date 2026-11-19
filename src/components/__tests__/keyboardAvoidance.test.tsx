/**
 * Both halves of getting out of the keyboard's way.
 *
 * The frame already lifted the footer clear, which is what a "Save hand" button
 * drawn underneath the keyboard needed. It did nothing for the field being
 * typed into: shrinking the frame puts whatever sat near the bottom of the
 * scroll area below the fold, and nothing scrolls it back. Adding a note to a
 * hand on a phone meant not seeing the line until the keyboard was dismissed.
 *
 * Asserted as props on the rendered tree, because that is all there is to
 * assert: a keyboard has no height under Jest and iOS does the layout. Neither
 * half can be shown to work here, so what is pinned is that both are still
 * asked for -- a later refactor dropping one of them is exactly how the first
 * half came to be the only half.
 */

import { render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { keyboardBehavior } from '../keyboardBehavior';
import { Screen } from '../Screen';
import { Text } from '../Text';

const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null;

/**
 * The scroll area, and the frame it sits in, read off the rendered tree.
 *
 * By name, because that is what survives to here: `ScrollView` renders as an
 * `RCTScrollView`, and `KeyboardAvoidingView` renders a plain `View` whose own
 * props are all consumed on the way. Its parent is that view.
 */
const scrollAndFrame = (node: Node, parent: Node = null): [Node, Node] => {
  if (node === null || typeof node === 'string') return [null, null];
  if (node.type === 'RCTScrollView') return [node, parent];

  for (const child of (node.children ?? []) as Node[]) {
    const found = scrollAndFrame(child, node);
    if (found[0] !== null) return found;
  }
  return [null, null];
};

const screen = async (): Promise<[Node, Node]> => {
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Screen footer={<Text>Save hand</Text>}>
        <Text>a form</Text>
      </Screen>
    </SafeAreaProvider>,
  );
  return scrollAndFrame(view.toJSON() as Node);
};

describe('a screen with something to type into', () => {
  it('scrolls the focused field out from under the keyboard', async () => {
    // Jest renders as iOS, which is the only platform this half is for:
    // `automaticallyAdjustKeyboardInsets` does nothing anywhere else.
    expect(Platform.OS).toBe('ios');

    const [scroll] = await screen();

    expect(scroll).not.toBeNull();
    expect((scroll as { props: Record<string, unknown> }).props.automaticallyAdjustKeyboardInsets).toBe(
      true,
    );
  });

  it('and still shortens the frame, which is what keeps the footer above it', async () => {
    const [, frame] = await screen();
    const style = StyleSheet.flatten(
      (frame as { props: Record<string, unknown> }).props.style as never,
    ) as Record<string, unknown>;

    // `behavior="padding"` composes `{ paddingBottom: <keyboard height> }` onto
    // the frame's own style, and that height is zero with no keyboard up. So
    // what is asserted is that the property is there at all: drop the behavior
    // and the frame carries only its stylesheet, which sets no bottom padding,
    // and this reads `undefined`.
    expect(style.paddingBottom).toBe(0);
  });
});

describe('which platforms get out of the keyboard\'s way', () => {
  it('includes Android, whose edge-to-edge windows the keyboard draws over', () => {
    // Found on a Moto G: the cash-out sheet's amount sat under the keyboard.
    // Android was left out on the theory that `adjustResize` shrank the window,
    // which an edge-to-edge window, and a modal made edge to edge, never is.
    expect(keyboardBehavior('android')).toBe('padding');
    expect(keyboardBehavior('ios')).toBe('padding');
  });

  it('but not the web, where the browser resizes its own viewport', () => {
    expect(keyboardBehavior('web')).toBeUndefined();
  });

  it('and both frames ask the one helper, rather than each testing the platform', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    for (const file of ['Screen.tsx', 'Sheet.tsx']) {
      const source = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(source).toContain('behavior={keyboardBehavior()}');
    }
  });
});
