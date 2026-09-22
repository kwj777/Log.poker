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
import { Platform, StyleSheet } from 'react-native';

import { AmountInput } from '../AmountInput';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { layout } from '../../theme';

/** The style of a pressable, flattened the way React Native resolves it. */
const drawn = (element: { props: Record<string, unknown> }) => {
  const style = element.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved) as { minHeight?: number };
};

/**
 * Total reachable height: what is drawn, plus whatever is added above and below.
 *
 * **On this platform.** These tests run in the `ui` project, whose preset is
 * plain `jest-expo`, so `Platform.OS` is native and `hitSlop` is the mechanism.
 * On the web it is not: react-native-web does not forward the prop at all, and
 * this number meant nothing there for as long as it was the only thing checked.
 * The web half is `TapArea`, and the tests at the bottom of this file are about
 * it.
 */
const reachable = (element: { props: Record<string, unknown> }) => {
  const slop = (element.props.hitSlop ?? {}) as { top?: number; bottom?: number };
  return (drawn(element).minHeight ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0);
};

/** What an area adds above and below what its parent draws. */
const grows = (area: { top?: number; bottom?: number }) => -(area.top ?? 0) - (area.bottom ?? 0);

/** Every absolutely positioned child of a control, which is what `TapArea` renders. */
const areas = (element: { children?: unknown[] }) =>
  ((element.children ?? []) as { props?: { style?: unknown } }[])
    .map(
      (child) =>
        StyleSheet.flatten(child.props?.style) as {
          position?: string;
          top?: number;
          bottom?: number;
          left?: number;
          right?: number;
        },
    )
    .filter((style) => style?.position === 'absolute');

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

/**
 * The same compensation, on the platform where `hitSlop` does nothing.
 *
 * react-native-web does not implement it: `grep -rn hitSlop
 * node_modules/react-native-web/dist` finds it only inside the legacy
 * `exports/Touchable`, never in `Pressable`, `View` or `modules/forwardedProps`,
 * so `createDOMProps` drops it and nothing reaches the DOM. Four controls drew
 * at 36, 40, 22 and 18 points on the web with no compensation at all, under
 * four comments saying the shortfall was "made up in touch area".
 *
 * `Platform.OS` is stood up rather than mocked, the way `claimHandoff.test.tsx`
 * does it, because the branch under test is the one this project does not run.
 */
describe('on the web, where hitSlop is dropped', () => {
  const realOS = Platform.OS;
  beforeAll(() => {
    (Platform as { OS: string }).OS = 'web';
  });
  afterAll(() => {
    (Platform as { OS: string }).OS = realOS;
  });

  it('a small button carries an area that reaches the floor', async () => {
    await render(<Button label="Edit" size="small" onPress={() => undefined} />);
    const button = screen.getByRole('button');
    const [area] = areas(button);

    expect(area).toBeDefined();
    // Drawn height plus what the area adds above and below it.
    expect((drawn(button).minHeight ?? 0) + grows(area)).toBeGreaterThanOrEqual(
      layout.tapTarget,
    );
  });

  it('and an amount preset does too', async () => {
    await render(<AmountInput value="" onChangeText={() => undefined} presets={[30_000]} />);
    const preset = screen.getByRole('button');
    const [area] = areas(preset);

    expect(area).toBeDefined();
    expect((drawn(preset).minHeight ?? 0) + grows(area)).toBeGreaterThanOrEqual(
      layout.tapTarget,
    );
  });

  it('and it still takes none of it sideways, where the next preset is', async () => {
    await render(
      <AmountInput value="" onChangeText={() => undefined} presets={[30_000, 40_000]} />,
    );
    for (const preset of screen.getAllByRole('button')) {
      const [area] = areas(preset);
      expect(area.left).toBe(0);
      expect(area.right).toBe(0);
    }
  });

  it('but a control that already reaches the floor gets no area at all', async () => {
    // Nothing to compensate for, so nothing is rendered: an extra node over
    // every medium button in the app would be a cost paid for no reason.
    await render(<Button label="Start session" onPress={() => undefined} />);
    expect(areas(screen.getByRole('button'))).toEqual([]);
  });
});

describe('on native, where it is not', () => {
  it('the area is not rendered, because hitSlop is the mechanism there', async () => {
    await render(<Button label="Edit" size="small" onPress={() => undefined} />);
    const button = screen.getByRole('button');
    expect(areas(button)).toEqual([]);
    expect(button.props.hitSlop).toEqual({ top: 6, bottom: 6 });
  });
});
