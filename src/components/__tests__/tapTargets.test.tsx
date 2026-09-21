/**
 * Every short control, against the floor this design system declares.
 *
 * `layout.tapTarget` is 48 and three files already derive from it: `Button`
 * makes up whatever a size draws short in touch area, and `SearchField` and
 * `Explain` do the same arithmetic inline for their icons. Two did not.
 *
 * `Chip` is the app's main input -- game type, stakes, position, tag, mood,
 * currency, format -- and its own header says chips "are sized to the 48pt
 * target so they can be hit without looking", which `Button.tsx` then cites as
 * the authority for treating 48 as the floor at all. It drew at 44. The
 * presets under `AmountInput` drew at 40, the largest shortfall in the app, on
 * the control that file calls "the point".
 *
 * Read off the rendered element rather than out of the stylesheet, because
 * what a player's thumb meets is the flattened style and the hit slop
 * together, and either one can be added without the other.
 */

import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AmountInput } from '../AmountInput';
import { Chip } from '../Chip';
import { layout } from '../../theme';

/** The style of a pressable, flattened the way React Native resolves it. */
const drawn = (element: { props: Record<string, unknown> }) => {
  const style = element.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved) as { minHeight?: number };
};

/** Total reachable height: what is drawn, plus whatever slop is added above and below. */
const reachable = (element: { props: Record<string, unknown> }) => {
  const slop = (element.props.hitSlop ?? {}) as { top?: number; bottom?: number };
  return (drawn(element).minHeight ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0);
};

describe('a chip', () => {
  it('is as tall as the target its own header says it is sized to', async () => {
    await render(<Chip label="NLHE" onPress={() => undefined} />);
    const chip = screen.getByRole('button');

    expect(drawn(chip).minHeight).toBe(layout.tapTarget);
    expect(reachable(chip)).toBeGreaterThanOrEqual(layout.tapTarget);
  });
});

describe('an amount preset', () => {
  it('reaches the target, whatever it draws at', async () => {
    // Smaller than a chip on purpose: it is the secondary control beneath the
    // field. Smaller to hit is not part of that, which is the same trade
    // `Button.slopFor` spells out for its own `small`.
    await render(
      <AmountInput value="" onChangeText={() => undefined} presets={[30_000]} />,
    );
    const preset = screen.getByRole('button');

    expect(drawn(preset).minHeight).toBeLessThan(layout.tapTarget);
    expect(reachable(preset)).toBeGreaterThanOrEqual(layout.tapTarget);
  });

  it('and takes none of it sideways, where the next preset is', async () => {
    // Presets wrap in a row a `spacing.sm` gap apart. Slop on the sides would
    // have neighbors overlapping in the middle, and a tap aimed at $300
    // landing on $400 writes a number the player did not choose -- which is
    // worse than the miss it would be preventing.
    await render(
      <AmountInput value="" onChangeText={() => undefined} presets={[30_000, 40_000]} />,
    );
    for (const preset of screen.getAllByRole('button')) {
      const slop = (preset.props.hitSlop ?? {}) as { left?: number; right?: number };
      expect(slop.left ?? 0).toBe(0);
      expect(slop.right ?? 0).toBe(0);
    }
  });
});
