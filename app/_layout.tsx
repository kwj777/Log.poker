/**
 * Root layout: opens the database, then renders the navigator.
 *
 * Nothing renders until the repository is ready. That costs a beat on cold start
 * but removes an entire class of "empty dashboard flashes before data arrives"
 * bugs, and on a warm start it is imperceptible.
 */

import { useEffect } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '../src/components/Button';
import { APP_DESCRIPTION, PageMeta } from '../src/components/PageMeta';
import { Text } from '../src/components/Text';
import { syncOnResume } from '../src/data';
import { useLogStore } from '../src/store/useLogStore';
import { colors, spacing } from '../src/theme';

export default function RootLayout() {
  const status = useLogStore((state) => state.status);
  const error = useLogStore((state) => state.error);
  const hydrate = useLogStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /**
   * Ask the server again whenever the app comes back to the front.
   *
   * `AppState` rather than a platform split, because react-native-web
   * implements it over `visibilitychange` and reports the same `active`: a
   * phone leaving the app switcher and a browser tab being selected are the
   * same event here, and they are the same event for the player too.
   *
   * Here rather than in the data layer, which is where the rest of the sync
   * wiring lives, for the ordinary reason: a listener needs somewhere to be
   * removed, and `compose` runs again on every sign-in. This runs once for the
   * life of the app.
   *
   * Nothing to do on the way back but ask. A pull that changes anything
   * announces itself through `onSyncApplied`, which the store is already
   * subscribed to, so the screens reload themselves.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncOnResume();
    });
    // Optional, because react-native-web hands back nothing at all when there
    // is no DOM to listen to, which is what a prerender is.
    return () => subscription?.remove();
  }, []);

  return (
    <SafeAreaProvider>
      {/*
        The default document title, set outside the readiness gate below.
        Log's content lives in a local database that is only opened in an
        effect, so the pre-rendered HTML is just this shell -- without a title
        here, the tab (and any crawler) would see an empty one until the app
        booted. Individual screens override it once they mount.
      */}
      <PageMeta title="Log: the session log that keeps you off tilt" description={APP_DESCRIPTION} />
      <StatusBar style="light" />
      {status === 'ready' ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
            // Screen titles are never displayed (there are no headers), but on
            // web expo-router writes them to `document.title`. Without one on
            // every route the browser tab ends up blank.
            title: 'Log',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ title: 'Log' }} />
          <Stack.Screen
            name="session/new"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              title: 'New session · Log',
            }}
          />
          <Stack.Screen
            name="session/hand"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              title: 'Log a hand · Log',
            }}
          />
          <Stack.Screen name="import" options={{ title: 'Import sessions · Log' }} />
          <Stack.Screen name="session/active" options={{ title: 'Live session · Log' }} />
          <Stack.Screen name="session/[id]" options={{ title: 'Session · Log' }} />
        </Stack>
      ) : (
        <View style={styles.center}>
          {status === 'error' ? (
            <>
              <Text variant="heading" center>
                Couldn’t open your log
              </Text>
              <Text color={colors.textSecondary} center style={styles.message}>
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
  center: {
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
