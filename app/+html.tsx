/**
 * The web page shell.
 *
 * Expo Router renders every route into this document on web, so it is the one
 * place to put the PWA wiring: the manifest link, the theme color that paints
 * the browser and status bar to match the app, and the service-worker
 * registration.
 *
 * This file only ever runs on web -- it is not part of the native bundle.
 */

import type { ReactNode } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

import { BOTTOM_BAR_ID } from '../src/config';

/**
 * Registered from the document rather than from React so the worker is installed
 * even if the bundle is slow or fails, and only in a production build: a service
 * worker in front of the Metro dev server would serve yesterday's bundle.
 */
const SERVICE_WORKER_SCRIPT = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    // The file is at the root and the scope is /app/, because log.poker is the
    // marketing site for three apps and the worker has no business caching it.
    // A worker cannot normally claim a scope above where it is served from, so
    // netlify.toml sends Service-Worker-Allowed: /app/ with this file.
    navigator.serviceWorker.register('/sw.js', { scope: '/app/' }).catch(function () {
      // A blocked or unsupported worker just means no offline support.
    });
  });
}`;

/**
 * Paint the page background before the bundle loads, so a cold start on a slow
 * connection shows Log's charcoal rather than a white flash.
 *
 * ## And why the height is `dvh` rather than the `100%` it looks like
 *
 * `ScrollViewStyleReset` below sets `html, body, #root` to `height: 100%`, and
 * on iOS Safari 100% of the layout viewport is **taller than the window you can
 * see**: it runs on behind the browser's own bottom toolbar. So the tab bar,
 * which sits at the bottom of the app in normal flow, was drawn underneath that
 * toolbar with its labels cut in half. Not on a phone, where the app is a real
 * app, and not on desktop, where the chrome is at the top. Only on the one
 * platform most people will meet Log on first.
 *
 * The page itself never scrolls, which is what makes it permanent rather than
 * intermittent: `overflow: hidden` on the body means Safari never gets the
 * scroll it collapses that toolbar for, so the toolbar is always there.
 *
 * `100dvh` is the height of the window as it currently stands, and it got most
 * of the way. Not all of it, because Safari's compact toolbar **overlays** that
 * height rather than reducing it, so the last of the bar was still underneath.
 *
 * `100svh` is the height with every toolbar at its largest, which is the one
 * measurement guaranteed to be clear of them. But sizing the app to it would
 * leave a strip of page below the bar whenever the toolbar is smaller than its
 * largest, which is most of the time.
 *
 * So: the app is `100dvh` and fills the window, and the bar carries the
 * difference as padding.
 *
 *     max(env(safe-area-inset-bottom), calc(100dvh - 100svh))
 *
 * `100dvh - 100svh` is exactly how much of the window the browser is sitting on
 * top of right now: zero when it is not, and the toolbar's height when it is.
 * The `max` is the other case, and the two are never both non-zero. In a
 * browser the toolbar is what clears the home indicator, so the inset is zero.
 * Installed to the home screen there is no toolbar, the difference is zero, and
 * the inset is the whole of what lifts the bar clear.
 *
 * It is written here rather than in `TabBar` because a React Native style
 * cannot say `calc(100dvh - 100svh)`, and `!important` because the component
 * writes the inset it can see into the same property. That inset is the left
 * half of the `max` above, so nothing is lost by winning.
 */
const BASE_STYLE = `
html, body, #root { background-color: #1c211f; }
body { overscroll-behavior-y: none; }
#root { display: flex; flex: 1 1 auto; min-height: 100%; }

@supports (height: 100dvh) {
  html, body, #root { height: 100dvh; }
}

@supports (height: 100svh) {
  #${BOTTOM_BAR_ID} {
    padding-bottom: max(env(safe-area-inset-bottom), calc(100dvh - 100svh)) !important;
  }
}
`;

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* `viewport-fit=cover` lets the safe-area insets reach the layout on
            iOS, which is what keeps the tab bar clear of the home indicator. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover, user-scalable=no"
        />

        {/* The title and description are set per screen via `PageMeta`, which
            goes through expo-router's head manager. Declaring them here as well
            would produce two `<title>` elements, and the browser reads the
            first -- which is the manager's. */}

        {/* Every route under /app is the same document with the same
            description, so they collapse onto one URL rather than competing as
            near-duplicates. This is also why robots.txt disallows nothing: a
            crawler blocked from the bundle cannot render the app at all. */}
        <link rel="canonical" href="https://log.poker/app" />

        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#1c211f" />
        <meta name="color-scheme" content="dark" />

        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Log" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" href="/icons/icon-192.png" type="image/png" />

        <meta property="og:title" content="Log: the session log that keeps you off tilt" />
        <meta
          property="og:description"
          content="Poker session tracking and a hand journal for live cash players, with a variance view that tells you when a downswing is just variance."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://log.poker/app" />

        {/* Disables body scrolling on web so `ScrollView` behaves as it does on
            native, which is what expo-router recommends for a full-screen app. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: BASE_STYLE }} />
        {process.env.NODE_ENV === 'production' ? (
          <script dangerouslySetInnerHTML={{ __html: SERVICE_WORKER_SCRIPT }} />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
