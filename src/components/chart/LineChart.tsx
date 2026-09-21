/**
 * A small SVG line chart.
 *
 * react-native-svg renders to real SVG on web and to native drawing on iOS and
 * Android, so one implementation covers all three targets -- which is the reason
 * for hand-rolling this rather than pulling in a charting library that is
 * web-only or native-only.
 *
 * ## It has to say what it draws
 *
 * A chart is a picture and a picture read by a screen reader is silence. The
 * bankroll curve is the largest thing on the dashboard and it carried no text
 * at all, so somebody using VoiceOver went from the headline figure straight
 * past it to the tiles, with nothing in between.
 *
 * `label` is required rather than optional, and it is the caller's to write:
 * only the screen knows what its own series mean. The shape stays hidden
 * underneath it -- a list of path elements read one by one would be worse than
 * the silence it replaced.
 */

import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { colors, radius } from '../../theme';
import { Text } from '../Text';
import {
  areaPath,
  bandPath,
  boundsOf,
  linePath,
  padBounds,
  projector,
  type Point,
} from './scale';

export interface Series {
  points: readonly Point[];
  color: string;
  width?: number;
  /** Fills between the line and zero -- used for the bankroll curve. */
  fill?: string;
  dashed?: boolean;
}

export interface Band {
  upper: readonly Point[];
  lower: readonly Point[];
  color: string;
}

interface LineChartProps {
  series: readonly Series[];
  /**
   * What this chart says, in a sentence. Read in place of the drawing.
   *
   * Required, because a chart nobody can hear is the bug this prop exists to
   * fix and an optional prop is one a caller forgets.
   */
  label: string;
  band?: Band;
  height?: number;
  /** Draws a horizontal rule at y = 0 -- break-even. */
  showZeroLine?: boolean;
  /**
   * Where the axis is anchored and where a filled series is filled down to.
   *
   * Zero for a curve that is a movement, which is what break even means and
   * what every caller wanted before this existed. A curve that is a *balance*
   * starts somewhere else, and forcing zero into its range leaves the data in
   * a few pixels at the top of the plot. See `padBounds`.
   */
  baseline?: number;
  /** Marks the final point of the first series. */
  showEndPoint?: boolean;
  emptyMessage?: string;
}

const PADDING = { top: 12, right: 6, bottom: 12, left: 6 };

export const LineChart = ({
  series,
  label,
  band,
  height = 180,
  showZeroLine = true,
  showEndPoint = true,
  baseline = 0,
  emptyMessage = 'Not enough data yet',
}: LineChartProps) => {
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  const allPoints = [
    ...series.map((entry) => entry.points),
    ...(band ? [band.upper, band.lower] : []),
  ];
  const hasData = allPoints.some((points) => points.length > 1);

  const bounds = padBounds(boundsOf(allPoints), baseline);
  const area = { width, height, padding: PADDING };
  const project = projector(bounds, area);
  const primary = series[0];
  const last = primary && primary.points.length > 0
    ? primary.points[primary.points.length - 1]
    : null;

  return (
    <View
      style={[styles.root, { height }]}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      // The empty state has its own words on screen; announcing the caller's
      // summary of a chart that is not drawn would describe data that is not
      // there.
      accessibilityLabel={hasData ? label : emptyMessage}
    >
      {width > 0 && hasData ? (
        <Svg width={width} height={height}>
          {band ? (
            <Path d={bandPath(band.upper, band.lower, project)} fill={band.color} />
          ) : null}

          {showZeroLine && bounds.minY <= 0 && bounds.maxY >= 0 ? (
            <Line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={project.y(0)}
              y2={project.y(0)}
              stroke={colors.borderStrong}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ) : null}

          {series.map((entry, index) =>
            entry.fill ? (
              <Path
                key={`fill-${index}`}
                d={areaPath(entry.points, project, baseline)}
                fill={entry.fill}
              />
            ) : null,
          )}

          {series.map((entry, index) => (
            <Path
              key={`line-${index}`}
              d={linePath(entry.points, project)}
              stroke={entry.color}
              strokeWidth={entry.width ?? 2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={entry.dashed ? '5 5' : undefined}
              fill="none"
            />
          ))}

          {showEndPoint && last ? (
            <Circle
              cx={project.x(last.x)}
              cy={project.y(last.y)}
              r={4}
              fill={primary.color}
              stroke={colors.background}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
      ) : (
        <View style={styles.empty}>
          <Text variant="caption" color={colors.textTertiary}>
            {emptyMessage}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    width: '100%',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
