/**
 * The web page shell.
 *
 * Expo Router renders every route into this document on web, so it is the one
 * place to put the PWA wiring: the manifest link, the theme colour that paints
 * the browser and status bar to match the app, and the service-worker
 * registration.
 *
 * This file only ever runs on web — it is not part of the native bundle.
 */

import type { ReactNode } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

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
 */
const BASE_STYLE = `
html, body, #root { background-color: #1c211f; }
body { overscroll-behavior-y: none; }
#root { display: flex; flex: 1 1 auto; min-height: 100%; }
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
            first — which is the manager's. */}

        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#1c211f" />
        <meta name="color-scheme" content="dark" />

        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Log" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" href="/icons/icon-192.png" type="image/png" />

        <meta property="og:title" content="Log — the session log that keeps you off tilt" />
        <meta
          property="og:description"
          content="Poker session tracking and a hand journal for live cash players, with a variance view that tells you when a downswing is just variance."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://log.poker" />

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
