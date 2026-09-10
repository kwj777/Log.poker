/**
 * Rendering a screen, with the providers a screen assumes and nothing else.
 *
 * Screens live in `app/`, and their tests cannot: expo-router routes every file
 * it finds there, and it does not ignore `__tests__` -- so a test beside the
 * screen it tests would ship as a route. They live here and reach across.
 */

import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

/** A phone with a notch, so the insets are non-zero and exercised. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const wrap = (element: ReactElement) => (
  <SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>
);

/**
 * Renders inside the providers, and re-renders inside them too.
 *
 * The second half is the part worth having a helper for: `rerender` replaces
 * the whole tree, so handing it a bare screen drops the provider and the screen
 * throws on the safe-area hook. Every caller would have to remember the wrapper
 * a second time.
 */
export const renderScreen = async (element: ReactElement) => {
  const view = await render(wrap(element));
  return { ...view, rerender: (next: ReactElement) => view.rerender(wrap(next)) };
};
