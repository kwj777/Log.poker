/**
 * The sentence a chart says before it has been measured.
 *
 * `width` comes from `onLayout`, which cannot run until after the first
 * render, so every chart has a moment where it has data and no size. That was
 * drawn as the empty state, which means a dashboard with five years in it
 * opened by saying it had nothing. On web the moment is not sub-frame:
 * react-native-web drives `onLayout` from a `ResizeObserver` whose first
 * callback lands after paint, so the wrong sentence is really read.
 */

import { render, screen } from '@testing-library/react-native';

import { LineChart } from '../LineChart';

const LINE = [
  { series: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 40 }], color: '#fff' }] },
];

describe('before it has been measured', () => {
  it('says nothing, rather than saying there is nothing', async () => {
    await render(<LineChart {...LINE[0]} label="Bankroll over 2 sessions." />);
    expect(screen.queryByText('Not enough data yet')).toBeNull();
  });

  it('and still tells a screen reader what the chart is', async () => {
    // The label does not depend on the measurement, only the drawing does, so
    // this is the one thing that can be said straight away.
    await render(<LineChart {...LINE[0]} label="Bankroll over 2 sessions." />);
    expect(screen.getByLabelText('Bankroll over 2 sessions.')).toBeTruthy();
  });
});

describe('with nothing to draw', () => {
  it('says so, measured or not', async () => {
    await render(<LineChart series={[]} label="Bankroll over 0 sessions." />);
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
  });

  it('and one point is not a line', async () => {
    await render(
      <LineChart
        series={[{ points: [{ x: 0, y: 0 }], color: '#fff' }]}
        label="Bankroll over 1 session."
      />,
    );
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
  });

  it('announcing the empty words rather than the summary it was given', async () => {
    await render(<LineChart series={[]} label="Bankroll over 0 sessions." />);
    expect(screen.getByLabelText('Not enough data yet')).toBeTruthy();
  });
});
