/**
 * A custom bottom tab bar.
 *
 * React Navigation's default bar lays out at 43pt on web -- too short for an icon
 * above a label, so the labels were clipped -- and it is absolutely positioned,
 * which means content scrolls underneath it. Rather than fight both behaviors
 * with style overrides that differ per platform, Log draws its own bar: one
 * height, one look, identical on iOS, Android and the web, and centered with the
 * content column on desktop.
 */

import { createContext, useContext, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';

import { BOTTOM_BAR_ID } from '../config';
import { colors, layout, spacing, typography } from '../theme';
import { tapFeedback } from './haptics';
import { Text } from './Text';

/** Height of the bar itself, above the device's bottom safe-area inset. */
export const TAB_BAR_HEIGHT = 58;


/**
 * Whether a tab bar sits below the current screen.
 *
 * The bar renders in normal flow and already absorbs the bottom safe-area inset,
 * so a tabbed screen must not add that inset a second time. Stack and modal
 * screens have no bar below them and get the default `false`.
 */
export const HasTabBarContext = createContext(false);

export const useHasTabBar = (): boolean => useContext(HasTabBarContext);

/** Derived from the public API rather than a deep import into expo-router. */
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export const TabBar = ({ state, descriptors, navigation }: TabBarProps) => {
  const insets = useSafeAreaInsets();

  return (
    // `nativeID` is an `id` on web and inert on native. The shell stylesheet
    // needs to reach this one element to clear iOS Safari's toolbar, and this
    // is the one prop that survives the trip. See `app/+html.tsx`.
    <View nativeID={BOTTOM_BAR_ID} style={[styles.wrapper, { paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label =
            typeof options.title === 'string' ? options.title : route.name;
          const color = focused ? colors.accent : colors.textTertiary;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (focused || event.defaultPrevented) return;
            tapFeedback();
            navigation.navigate(route.name, route.params);
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              style={styles.tab}
            >
              {options.tabBarIcon?.({ focused, color, size: 24 })}
              <Text style={[typography.caption, styles.label]} color={color} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bar: {
    flexDirection: 'row',
    height: TAB_BAR_HEIGHT,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});
