/**
 * The money field's text box, against the font it has to hold.
 *
 * Every amount a player types goes through `AmountInput`: buy-in, rebuy,
 * cash-out, fee, prize, bankroll. It set a 30pt bold font on the input and
 * left the height of the box to the platform, and iOS measured one too short
 * for that line and clipped the top off the glyph. A placeholder zero drew as
 * a U. Not on web, where it had always been fine, and not anywhere a test was
 * looking.
 *
 * The clipping itself is a native drawing detail no JS test can see. What a
 * test can hold is the arithmetic underneath it: the field declares a height,
 * the input's padding takes a bite out of it, and what is left has to be
 * bigger than the font. That is the invariant that was never written down, and
 * the one a later change to any of those three numbers would break silently.
 *
 * ## The half zero came back
 *
 * The first version of this file compared the box against `fontSize`, which is
 * the size the font is declared at and not the size it is drawn at. A
 * `TextInput` does not come through `Text`, so it carried none of the Dynamic
 * Type caps every string in the app has, and at a larger system text size a
 * 30pt digit grew past a box that did not. Kevin found it on a phone, again,
 * with the same U-shaped zero and a different cause.
 *
 * So the number the box is held against is `fontSize * maxFontSizeMultiplier`
 * now: the largest line this field can be asked to draw, rather than the
 * smallest. A missing cap fails the first test below rather than passing it by
 * multiplying by one.
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AmountInput } from '../AmountInput';
import { MAX_SCALE } from '../Text';

/**
 * The field and the input inside it, read off the rendered tree.
 *
 * `AmountInput` renders a wrapper, whose first child is the bordered row, whose
 * children are the currency symbol and the input. Read from the render rather
 * than the stylesheet for the reason `tapTargets.test.tsx` gives: what a player
 * sees is the flattened style, and a style can be overridden at the call site.
 */
const boxes = async () => {
  const tree = (await render(<AmountInput value="" onChangeText={() => undefined} />)).toJSON();
  const row = (tree as { children: unknown[] }).children[0] as {
    props: { style?: unknown };
    children: unknown[];
  };
  const input = row.children[1] as { props: { style?: unknown; maxFontSizeMultiplier?: number } };

  return {
    field: StyleSheet.flatten(row.props.style as never) as Record<string, number>,
    input: StyleSheet.flatten(input.props.style as never) as Record<string, number | string>,
    cap: (input.props as { maxFontSizeMultiplier?: number }).maxFontSizeMultiplier,
  };
};

describe('the amount field', () => {
  it('leaves more room for the text than the text needs at any text size', async () => {
    const { field, input, cap } = await boxes();

    // The cap is the whole point: without one the field is held against a size
    // the player may never be shown. `toBeGreaterThan(1)` rather than
    // `toBeDefined`, because a cap of 1 would turn Dynamic Type off to pass.
    expect(cap).toBeGreaterThan(1);
    expect(cap).toBeLessThanOrEqual(MAX_SCALE.display);

    const padding = (input.paddingVertical as number) * 2;
    const forTheText = field.minHeight - padding;
    const biggestLine = (input.fontSize as number) * (cap as number) * 1.2;

    // 1.2 is the loosest line box a face is drawn in; anything tighter than
    // the scaled font size would clip outright, and the gap between the two is
    // the margin this field has to stay wrong-proof.
    expect(forTheText).toBeGreaterThanOrEqual(biggestLine);
  });

  it('caps the input the way every string in the app is capped', async () => {
    // `Text` sets one per variant and this field is the one control that draws
    // type large enough for the difference to clip. Reading the same constant
    // rather than a copy of the number is what keeps them from drifting.
    expect((await boxes()).cap).toBe(MAX_SCALE.display);
  });

  it('takes that height from the field rather than measuring its own', async () => {
    // The assertion above is arithmetic about the field. This is what makes the
    // input actually use it: without stretching, `flex: 1` governs only the
    // width and the height falls back to whatever the platform decides, which
    // is exactly what drew the half zero.
    expect((await boxes()).input.alignSelf).toBe('stretch');
  });
});
