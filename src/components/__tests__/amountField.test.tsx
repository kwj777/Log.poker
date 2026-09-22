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
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AmountInput } from '../AmountInput';

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
  const input = row.children[1] as { props: { style?: unknown } };

  return {
    field: StyleSheet.flatten(row.props.style as never) as Record<string, number>,
    input: StyleSheet.flatten(input.props.style as never) as Record<string, number | string>,
  };
};

describe('the amount field', () => {
  it('leaves more room for the text than the text needs', async () => {
    const { field, input } = await boxes();

    const padding = (input.paddingVertical as number) * 2;
    const forTheText = field.minHeight - padding;

    // 1.2 is the loosest line box a 30pt face is drawn in; anything tighter
    // than its own font size would clip outright, and the gap between the two
    // is the margin this field has to stay wrong-proof.
    expect(forTheText).toBeGreaterThanOrEqual((input.fontSize as number) * 1.2);
  });

  it('takes that height from the field rather than measuring its own', async () => {
    // The assertion above is arithmetic about the field. This is what makes the
    // input actually use it: without stretching, `flex: 1` governs only the
    // width and the height falls back to whatever the platform decides, which
    // is exactly what drew the half zero.
    expect((await boxes()).input.alignSelf).toBe('stretch');
  });
});
