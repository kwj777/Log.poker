/**
 * The four places Log has: your numbers, your sessions, your variance, your settings.
 *
 * A tab bar rather than a drawer: everything here should be one thumb-reach away
 * from a poker table, and a drawer costs a tap and a gesture to reach anything.
 */

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { HasTabBarContext, TabBar } from '../../src/components/TabBar';
import { colors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const icon =
  (active: IconName, inactive: IconName) =>
  ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : inactive} color={color} size={size} />
  );

export default function TabsLayout() {
  return (
    // Tells every screen below that the bar already covers the bottom inset.
    <HasTabBarContext.Provider value>
      <Tabs
        tabBar={(props) => <TabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: 'Dashboard', tabBarIcon: icon('stats-chart', 'stats-chart-outline') }}
        />
        <Tabs.Screen
          name="history"
          options={{ title: 'Sessions', tabBarIcon: icon('list', 'list-outline') }}
        />
        <Tabs.Screen
          name="variance"
          options={{ title: 'Variance', tabBarIcon: icon('pulse', 'pulse-outline') }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: 'Settings', tabBarIcon: icon('settings', 'settings-outline') }}
        />
      </Tabs>
    </HasTabBarContext.Provider>
  );
}
