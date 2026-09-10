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

export const renderScreen = (element: ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{element}</SafeAreaProvider>);
