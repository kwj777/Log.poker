/**
 * Root layout: opens the database, then renders the navigator.
 *
 * Nothing renders until the repository is ready. That costs a beat on cold start
 * but removes an entire class of "empty dashboard flashes before data arrives"
 * bugs, and on a warm start it is imperceptible.
 */

import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '../src/components/Button';
import { Text } from '../src/components/Text';
import { useLogStore } from '../src/store/useLogStore';
import { colors, spacing } from '../src/theme';

export default function RootLayout() {
  const status = useLogStore((state) => state.status);
  const error = useLogStore((state) => state.error);
  const hydrate = useLogStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {status === 'ready' ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="session/new"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="session/hand"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack>
      ) : (
        <View style={styles.centre}>
          {status === 'error' ? (
            <>
              <Text variant="heading" centre>
                Couldn’t open your log
              </Text>
              <Text color={colors.textSecondary} centre style={styles.message}>
                {error ?? 'The local database could not be opened.'}
              </Text>
              <Button label="Try again" onPress={() => void hydrate()} style={styles.retry} />
            </>
          ) : (
            <ActivityIndicator color={colors.accent} size="large" />
          )}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  message: {
    marginTop: spacing.sm,
  },
  retry: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
});
