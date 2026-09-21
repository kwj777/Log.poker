/**
 * The axis the bankroll curve is drawn against.
 *
 * Four lines of arithmetic, and the one thing that can go wrong with them is
 * invisible: a range that is technically correct and leaves the data in a few
 * pixels at the top of the plot. Nothing errors, nothing looks broken, and the
 * chart simply stops saying anything. So the assertions here are about how much
 * of the plot the data actually gets.
 */

import { boundsOf, padBounds, projector } from '../scale';

const points = (ys: number[]) => ys.map((y, x) => ({ x, y }));

/** How much of a 146 pixel plot the series actually travels through. */
const travel = (ys: number[], baseline?: number): number => {
  const bounds = padBounds(boundsOf([points(ys)]), baseline);
  const project = projector(bounds, {
    width: 300,
    height: 170,
    padding: { top: 12, right: 6, bottom: 12, left: 6 },
  });
  const drawn = ys.map((y) => project.y(y));
  return Math.max(...drawn) - Math.min(...drawn);
};

describe('padBounds', () => {
  it('keeps break even in view for a curve that is a movement', () => {
    // A profit curve that never went negative still has to show where negative
    // would be, or a $40 downswing reads as a catastrophe.
    expect(padBounds({ minX: 0, maxX: 1, minY: 20_000, maxY: 50_000 }).minY).toBeLessThanOrEqual(0);
  });

  it('and the other way round for one that never went positive', () => {
    expect(
      padBounds({ minX: 0, maxX: 1, minY: -50_000, maxY: -20_000 }).maxY,
    ).toBeGreaterThanOrEqual(0);
  });

  it('anchors to a balance instead when it is given one', () => {
    const bounds = padBounds({ minX: 0, maxX: 1, minY: 1_990_000, maxY: 2_050_000 }, 2_000_000);
    expect(bounds.minY).toBeLessThanOrEqual(1_990_000);
    expect(bounds.maxY).toBeGreaterThanOrEqual(2_050_000);
    // And it does not drag the floor all the way down to nothing.
    expect(bounds.minY).toBeGreaterThan(0);
  });

  it('gives a bankroll its own plot rather than the space under it', () => {
    // A $20,000 roll swinging between $19,900 and $20,500. Anchored at zero
    // the four points landed inside four pixels of a 146 pixel plot: a flat
    // line over a solid block of fill, on the chart whose job is the shape.
    const roll = [1_990_000, 2_050_000, 1_995_000, 2_030_000];
    expect(travel(roll, 0)).toBeLessThan(5);
    expect(travel(roll, 2_000_000)).toBeGreaterThan(80);
  });

  it('leaves a profit curve exactly where it drew before', () => {
    // The default is zero, so every caller plotting a movement is unchanged.
    const profit = [20_000, -10_000, 35_000, 50_000];
    expect(travel(profit)).toBe(travel(profit, 0));
  });

  it('still divides by something for a series that never moves', () => {
    const flat = padBounds({ minX: 0, maxX: 1, minY: 500, maxY: 500 }, 500);
    expect(flat.maxY - flat.minY).toBeGreaterThan(0);
  });
});
