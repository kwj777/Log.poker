/**
 * Chart scaling. Pure maths, no rendering — so the pixel positions a chart draws
 * can be reasoned about (and tested) without a renderer.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ChartArea {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export const boundsOf = (series: readonly (readonly Point[])[]): Bounds => {
  const points = series.flat();
  if (points.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, maxX, minY, maxY };
};

/**
 * Pad the vertical range by 10% and always include zero.
 *
 * Including zero is not cosmetic: a bankroll chart that crops the axis to the
 * data makes a $40 downswing look like a catastrophe, which is precisely the
 * misreading this app exists to prevent.
 */
export const padBounds = (bounds: Bounds): Bounds => {
  const minY = Math.min(0, bounds.minY);
  const maxY = Math.max(0, bounds.maxY);
  const span = maxY - minY;
  // A perfectly flat series still needs a non-zero range to divide by.
  const margin = span === 0 ? 1 : span * 0.1;
  return { ...bounds, minY: minY - margin, maxY: maxY + margin };
};

export interface Projector {
  x: (value: number) => number;
  y: (value: number) => number;
}

export const projector = (bounds: Bounds, area: ChartArea): Projector => {
  const { padding } = area;
  const innerWidth = Math.max(1, area.width - padding.left - padding.right);
  const innerHeight = Math.max(1, area.height - padding.top - padding.bottom);
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;

  return {
    x: (value) => padding.left + ((value - bounds.minX) / spanX) * innerWidth,
    // SVG's y axis grows downward, so the scale is inverted here rather than at
    // every call site.
    y: (value) => padding.top + innerHeight - ((value - bounds.minY) / spanY) * innerHeight,
  };
};

/** An SVG path through the points; empty string for an empty series. */
export const linePath = (points: readonly Point[], project: Projector): string => {
  if (points.length === 0) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${project.x(point.x)} ${project.y(point.y)}`)
    .join(' ');
};

/** A closed path from the line down to `baseline`, for the area fill. */
export const areaPath = (
  points: readonly Point[],
  project: Projector,
  baseline: number,
): string => {
  if (points.length === 0) return '';
  const base = project.y(baseline);
  const line = linePath(points, project);
  const firstX = project.x(points[0].x);
  const lastX = project.x(points[points.length - 1].x);
  return `${line} L${lastX} ${base} L${firstX} ${base} Z`;
};

/** A closed band between two series — the confidence envelope. */
export const bandPath = (
  upper: readonly Point[],
  lower: readonly Point[],
  project: Projector,
): string => {
  if (upper.length === 0 || lower.length === 0) return '';
  const top = linePath(upper, project);
  const bottom = lower
    .slice()
    .reverse()
    .map((point) => `L${project.x(point.x)} ${project.y(point.y)}`)
    .join(' ');
  return `${top} ${bottom} Z`;
};
