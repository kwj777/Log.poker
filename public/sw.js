/**
 * Log's service worker.
 *
 * Offline is a hard requirement, not a nicety: this app is used in card rooms,
 * which are famously windowless basements with no reception. A player mid-session
 * has to be able to add a rebuy and log a hand with the network completely gone.
 *
 * That is achievable because Log has no backend -- every read and write goes to
 * IndexedDB in the browser. The only thing the network is needed for is the app
 * shell itself, so this worker's whole job is to make sure the shell is always
 * available from cache.
 *
 * Strategy
 * --------
 * - Navigations: network first (so a deploy is picked up promptly), falling back
 *   to the cached shell. The app is a single-page build, so every route resolves
 *   to the same `index.html`.
 * - Build assets and icons: cache first. Their URLs are content-hashed by the
 *   bundler, so a cached copy can never be stale -- a new build means a new URL.
 * - Everything else same-origin: stale-while-revalidate.
 *
 * Bump CACHE_VERSION to force every client to discard its caches on the next load.
 */

const CACHE_VERSION = 'v2';
const SHELL_CACHE = `log-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `log-assets-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

/**
 * The app's shell, which is under /app rather than at the root: log.poker is
 * first of all the marketing site for three apps, and this worker is
 * registered with a scope of /app/ so it never sees or caches that site.
 */
const SHELL_URL = '/app/index.html';

const SHELL_ASSETS = ['/app/', SHELL_URL, '/manifest.webmanifest'];

/** Content-hashed by the bundler, so safe to serve from cache indefinitely. */
const isImmutableAsset = (pathname) =>
  pathname.startsWith('/app/_expo/') ||
  pathname.startsWith('/app/assets/') ||
  pathname.startsWith('/icons/') ||
  /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|otf|ico)$/.test(pathname);

/**
 * Pull the bundle and stylesheet URLs out of the shell HTML.
 *
 * They are content-hashed by the bundler, so they cannot be hard-coded here.
 * Without this the worker would only cache the bundle once the browser had
 * already requested it through the worker -- which is one page load too late, and
 * would leave the very first offline visit staring at a blank page.
 */
const shellSubresources = (html) => {
  const urls = new Set();
  const patterns = [
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = match[1];
      if (url.startsWith('/')) urls.add(url);
    }
  }
  return [...urls];
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `reload` bypasses the HTTP cache so a freshly deployed shell is stored,
      // rather than whatever the browser happened to be holding.
      await cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' })));

      const shell = await cache.match(SHELL_URL);
      if (shell) {
        const assets = await caches.open(ASSET_CACHE);
        // Individually, not `addAll`: one missing asset must not fail the whole
        // install and leave the app with no offline support at all.
        await Promise.all(
          shellSubresources(await shell.clone().text()).map((url) =>
            assets.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
          ),
        );
      }

      // Take over immediately: the previous worker's shell may already be stale.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('log-') && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

const networkFirstShell = async (request) => {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(SHELL_URL, response.clone());
    return response;
  } catch {
    // Offline: serve the shell. The app boots from IndexedDB and the player
    // never sees a difference.
    const cached = (await cache.match(SHELL_URL)) ?? (await cache.match('/app/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Log</title><body style="background:#1c211f;color:#e8e4da;font-family:system-ui;padding:2rem"><h1>Log</h1><p>Open Log once while online and it will work offline from then on.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 },
    );
  }
};

const cacheFirst = async (request) => {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
};

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  const response = cached ?? (await network);
  if (response) return response;
  return new Response('', { status: 504, statusText: 'Offline' });
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch cross-origin requests: nothing in Log needs them, and caching a
  // third party's response is a good way to serve something stale forever.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  event.respondWith(
    isImmutableAsset(url.pathname) ? cacheFirst(request) : staleWhileRevalidate(request),
  );
});

/** Lets the page trigger an immediate update after a deploy. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});
