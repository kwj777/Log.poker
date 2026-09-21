/**
 * Root layout: opens the database, then renders the navigator.
 *
 * Nothing renders until the repository is ready. That costs a beat on cold start
 * but removes an entire class of "empty dashboard flashes before data arrives"
 * bugs, and on a warm start it is imperceptible.
 */

import { useEffect } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorNote } from '../src/components/ErrorNote';
import { ErrorScreen } from '../src/components/ErrorScreen';
import { APP_DESCRIPTION, PageMeta } from '../src/components/PageMeta';
import { syncOnResume } from '../src/data';
import { useLogStore } from '../src/store/useLogStore';
import { colors, spacing } from '../src/theme';

/**
 * What a render throwing looks like, rather than what it used to look like.
 *
 * Expo Router ships an `ErrorBoundary` and **does not apply it**: a route is
 * wrapped only if it exports one. Nothing here did, so a throw anywhere in the
 * tree unmounted the tree, and on web that is a white page with the app's
 * background color and nothing to do next. Exported from the root layout, so it
 * is the backstop for every screen at once.
 *
 * `retry` re-renders the route rather than reloading the app, which is the
 * right first move: the local database is untouched by a render throwing, so
 * whatever was logged is still logged, and a screen that fell over on one odd
 * record often comes back.
 *
 * A boundary per screen would keep the tab bar alive so the other three tabs
 * stayed reachable, which is nicer. It needs `unstable_settings.screenErrorBoundary`,
 * and reaching for an unstable API is a decision to make on purpose rather than
 * on the way past.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ErrorScreen
      title="Something went wrong"
      // The message, because it is the only thing anybody can act on -- a bug
      // report that says "it broke" and one that quotes a line are different
      // reports. It is a local error about local data and goes nowhere.
      detail={error.message || 'This screen stopped working.'}
      onRetry={() => void retry()}
    />
  );
}

/**
 * A read that failed after the app was already open.
 *
 * `refresh` catches every read failure, records it on the store and leaves
 * `status` at `ready`. The root layout was the only reader of that field and
 * drew it inside the `status === 'error'` branch below -- which only `hydrate`
 * can enter. So once the app was up, the catch wrote a value nothing could
 * read back: the rows on screen quietly stopped matching the database, and the
 * write that triggered the re-read still reported success. Three store actions
 * carry a comment saying "a failed read here is the local database being
 * unavailable, which the root layout already reports", and that was true only
 * before this existed.
 *
 * `ErrorNote` rather than `ErrorScreen`, which is the distinction that
 * component is for: nothing is broken and every screen still works, the data on
 * them is just older than it should be. `status === 'error'` is the database
 * failing to open at all and takes the whole screen, so this stays out of its
 * way -- two notices about one problem is worse than one.
 *
 * It clears itself, because the next read that lands sets `error` back to null.
 *
 * Exported so it can be rendered on its own, the way `ErrorBoundary` above is:
 * the layout it sits in hydrates in an effect and brings its own
 * `SafeAreaProvider`, and a test of this would spend all of itself on neither.
 */
export function StaleDataNote() {
  const status = useLogStore((state) => state.status);
  const error = useLogStore((state) => state.error);
  if (status !== 'ready' || error === null) return null;
  return (
    <View style={styles.stale}>
      <ErrorNote message={`What is on screen may be out of date. ${error}`} />
    </View>
  );
}

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
      <StaleDataNote />
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
            name="session/past"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
              title: 'Add a past session · Log',
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
          <Stack.Screen name="hands" options={{ title: 'Hands · Log' }} />
          {/* Where a purchase made at another of the family's apps lands. The
              route has to exist under /app, because that is where this site
              serves the app from and a link to /claim would be answered by the
              marketing site's catch-all -- which is the failure that kept the
              hand-off to TiltProof broken for its whole shipped life. */}
          <Stack.Screen name="claim" options={{ title: 'Signing you in · Log' }} />
          <Stack.Screen name="session/active" options={{ title: 'Live session · Log' }} />
          <Stack.Screen name="session/[id]" options={{ title: 'Session · Log' }} />
          <Stack.Screen name="session/edit" options={{ title: 'Edit session · Log' }} />
        </Stack>
      ) : (
        status === 'error' ? (
          <ErrorScreen
            title="Couldn’t open your log"
            detail={error ?? 'The local database could not be opened.'}
            onRetry={() => void hydrate()}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  stale: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
});
