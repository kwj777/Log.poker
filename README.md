# Log

**The session log that keeps you off tilt.**

A poker session tracker and hand journal for live cash game and home game
players. Log a session in under ten seconds, log a hand in under fifteen, and
get an honest answer to the question every downswing provokes: *am I running
bad, or am I playing bad?*

Log is the hub of a three-app family:

| App | What it's for |
| --- | --- |
| **Log** (this repo) | What happened — sessions, hands, results, variance |
| [Untilt.poker](https://untilt.poker) | How it felt — mental game work |
| [TiltProof](https://tiltproof.com) | What to do differently — odds and spot training |

How the three are priced together — speculatively, and the short version is that
Log stays free — is worked out in
[FAMILY-PRICING.md](https://github.com/kwj777/Untilt/blob/main/FAMILY-PRICING.md),
over in Untilt beside the monetization document it extends.

---

## What's in the MVP

- **Session logging** — start and end a session with stakes, game type, venue
  and buy-in; rebuys mid-session; cash-out at the end. Duration, profit/loss and
  hourly rate are computed, never typed. The new-session screen is pre-filled
  from your last session, so the common path is open, glance, Start.
- **Quick hand journal** — a two-taps-per-card picker, position, one line of
  note, and tags (*bad beat*, *misplayed?*, *cooler*, *bluff*). Everything is
  optional; the hand saves as soon as anything at all has been entered.
- **Mood check-in** — an optional one-tap tilt meter at the start and end of a
  session, plus a deliberately subtle inline prompt two hours in. Stored
  alongside the result, so "I left three steps more rattled than I arrived" is a
  thing you can see.
- **Dashboard** — bankroll curve, hourly rate, session count, hours played, and
  profit broken down by stakes, venue or game type.
- **Variance view** — your own win rate and standard deviation, with your recent
  stretch placed inside the confidence band those numbers predict. See
  [The variance model](#the-variance-model).
- **Session history** — filter by period, venue and game type; every filter
  recomputes the totals above the list.
- **Family cross-promo** — a shared "More from the family" card, plus two
  contextual hand-offs: a rough stretch on the variance view offers Untilt, and
  a hand tagged *misplayed?* offers to drill the spot in TiltProof.

Offline throughout. There is no account, no server, and no network call — your
log never leaves your device.

---

## Running it

Requires Node 22+.

```bash
npm install
npm start          # Expo dev server; press i / a / w, or scan the QR code
```

Or go straight to one platform:

```bash
npm run ios        # iOS simulator (macOS only)
npm run android    # Android emulator or device
npm run web        # http://localhost:8081
```

### Checks

```bash
npm test           # 219 unit tests
npm run typecheck  # strict TypeScript, app and tests
npm run lint       # eslint-config-expo
```

### Demo data

Settings → **Load demo data** seeds 20 mixed-result sessions with hands and mood
entries — enough to fill the dashboard and give the variance view something to
say. The control is gated behind `__DEV__`, so it is stripped from production
builds entirely rather than merely hidden.

### App icons

The icons are generated, not checked in as opaque binaries:

```bash
node scripts/generate-icons.mjs
```

Editing the palette at the top of that script and re-running regenerates every
native and PWA size.

---

## Deploying to Netlify

`netlify.toml` is committed and complete; connecting the repo is the whole setup.

1. **New site from Git** → pick this repository.
2. Netlify reads `netlify.toml`, so the build command
   (`npx expo export --platform web`), publish directory (`dist`) and Node
   version are already configured. Leave them as detected.
3. Deploy, then point `log.poker` at the site under **Domain management**.
   Netlify provisions the TLS certificate; the PWA needs HTTPS to install and to
   run a service worker.

To check a production build locally before deploying:

```bash
npm run build:web
npx serve dist      # or any static server with a single-page fallback
```

### What `netlify.toml` does

- **SPA fallback** — `/*` → `/index.html` with status `200`, so a deep link like
  `/session/<id>` is served the app shell and resolved by the client router
  rather than 404ing.
- **Cache headers** — `index.html`, `sw.js` and the manifest are
  `must-revalidate` so a deploy reaches returning visitors immediately;
  everything under `_expo/` and `assets/` is content-hashed by the bundler and
  cached for a year.
- **Security headers** — `nosniff`, `SAMEORIGIN`, and a strict referrer policy.

---

## The PWA

The web build is installable and works fully offline — a hard requirement, since
card rooms are windowless basements with no reception. A player mid-session has
to be able to add a rebuy and log a hand with the network entirely gone.

That is achievable because Log has no backend: every read and write goes to
IndexedDB in the browser, so the only thing the network is ever needed for is
the app shell itself.

- **`public/manifest.webmanifest`** — standalone display, portrait, the charcoal
  theme colour, 192/512 icons plus a maskable one, and a "Start a session"
  shortcut.
- **`public/sw.js`** — network-first for navigations (so a deploy is picked up
  promptly) falling back to the cached shell; cache-first for the
  content-hashed bundle and icons; stale-while-revalidate for everything else.
  On install it parses the shell HTML for its script and stylesheet URLs and
  precaches them, so even the *first* offline visit works rather than the
  second. Bump `CACHE_VERSION` to force every client to discard its caches.
- **`app/+html.tsx`** — the document shell: manifest link, theme colour, Apple
  touch icon, `viewport-fit=cover` for safe areas, and the service-worker
  registration (production builds only — a worker in front of the Metro dev
  server would serve yesterday's bundle).

`app.json` sets `web.output: "static"`, which is what makes `+html.tsx` take
effect. Log's content lives entirely in a local database, so the pre-rendered
HTML is just the shell — the value is the customised `<head>`, not
pre-rendered content.

Verified in a headless Chromium against the real production build: the worker
installs and precaches the bundle, the manifest satisfies Chrome's installability
criteria, and with the network switched off the app boots from a cold reload,
resolves deep links, and reads and writes sessions, rebuys and hands.

---

## Architecture

```
app/                      Expo Router routes
  _layout.tsx             opens the database, then renders the navigator
  +html.tsx               web document shell (PWA wiring)
  (tabs)/                 dashboard · sessions · variance · settings
  session/                new · active · [id] · hand
src/
  domain/                 pure maths and types — no React, no storage
    types.ts              the data model
    money.ts              integer cents in, formatted strings out
    handNotation.ts       "AsKd" — the stable hand-off format
    stats.ts              P/L, hourly rate, bankroll curve, groupings
    variance.ts           win rate, standard deviation, confidence bands
  data/
    repository.ts         the storage contract
    sql/                  SqlRepository over a narrow SqlDriver
    dexie/                DexieRepository over IndexedDB
    repositoryFactory.ts  native: expo-sqlite   (.web.ts → Dexie)
    seed.ts               the demo dataset
  store/                  Zustand store and pure selectors
  features/               feature-scoped components
  components/             the design system
  theme/                  palette, spacing, type scale
```

### The repository interface

Persistence sits behind a single interface with two implementations:
**SQLite (`expo-sqlite`) on iOS and Android**, **IndexedDB (Dexie) on web**.
Metro picks between them via `repositoryFactory.web.ts`, so neither engine is
ever bundled into the other platform's build (verified against the emitted
bundles).

Both are relational stores with indexes, deliberately. Session data is
relational and grows for years; `AsyncStorage` and `localStorage` are
synchronous key–value string stores with no indexes, and querying five years of
sessions through one means deserialising all of them on every read.

`SqlRepository` talks to a five-method `SqlDriver` rather than to `expo-sqlite`
directly. `expo-sqlite` implements it on device and `node:sqlite` implements it
in the test suite — so the class that ships to iOS and Android is the class the
tests exercise, against a real SQLite engine, rather than a fake that would
agree with whatever the repository happens to do.

### Testing

One conformance suite, `src/data/__tests__/repositoryContract.ts`, runs against
**both** implementations — real SQLite via `node:sqlite`, real IndexedDB via
`fake-indexeddb`. Ordering, cascade behaviour, patch semantics and constraint
errors are asserted once, so a bug cannot reproduce on only one platform.

```
Test Suites: 8 passed
Tests:       219 passed

  sqlRepository      53   the SQLite path, against real SQLite
  dexieRepository    53   the IndexedDB path, against real IndexedDB
  stats              29   P/L, rebuys, duration, hourly rate, groupings
  variance           31   win rate, σ, confidence bands, verdicts
  money              23   cents arithmetic, parsing, formatting
  handNotation       21   parse, round-trip, hand classes
  seed               10   the demo dataset stays coherent
  selectors          10   store reads and filters
```

### Money

Every amount is an integer number of **cents**, everywhere, converted to a
string only at the edge. Dollars as floats accumulate rounding error across
thousands of sessions, and a bankroll that is wrong by a cent is a bankroll
nobody trusts.

### The variance model

Results are treated as a random walk in time: over `h` hours a player with win
rate `w` (big blinds per hour) and per-hour standard deviation `σ` has a result
with mean `w·h` and standard deviation `σ·√h`.

Both parameters are estimated from the player's own completed sessions — never
from a hard-coded "typical" number, which would be a guess dressed up as a
measurement. Win rate is total big blinds over total hours; the standard
deviation uses the method-of-moments estimator for a variance that scales with
time, `σ² = Σ(rᵢ − ŵ·hᵢ)² / Σhᵢ`, with a Bessel-style correction for the one
parameter estimated from the same data. Results are normalised to big blinds so
sessions across different stakes pool into one estimate.

Below eight sessions or twenty hours the view says it doesn't have enough data
rather than inventing a verdict. Above it, the copy is written to be true *and*
calming: a rough stretch inside the band is named as ordinary, an outlier is
named as an outlier, and a heater is called a heater so nobody banks on it. A
test asserts that no verdict branch ever implies the player is broken or that
they are "due".

### Hand notation

Hole cards are stored as `"AsKd"` — rank then suit, two characters per card, the
format every other poker tool already speaks. That is what makes the TiltProof
hand-off possible without a translation layer, and what a CSV export will emit.

---

## Post-MVP roadmap

Ordered roughly by how much each is worth against how much it costs.

1. **CSV export** — the data model is already designed for it: every record is
   timestamped, money is integer cents, and hands are in a portable notation.
   Wants a share sheet on native and a download on web.
2. **Cloud sync and auth** — the reason every record carries a client-generated
   id and an `updatedAt`. A syncing repository wraps the existing one behind the
   same interface, and `src/data/index.ts` is the single place it gets composed
   in; no feature folder changes. Last-write-wins per record to start, with the
   timestamps already in place to do better later.
3. **RevenueCat cross-platform subscriptions** — entitlements gate features at
   the store layer, not inside screens, so the free build and the paid build
   stay one codebase. Web entitlements via Stripe through the same RevenueCat
   account.
4. **Online session support** — multi-table sessions, hands per hour, and
   results per site. Needs `sessions` to grow a `format` discriminator and the
   hourly-rate maths to become per-table.
5. **Deep Untilt and TiltProof integration** — the seams already exist in
   `src/features/family/hooks.ts`. Today they build a URL; next they hand off a
   real payload — the flagged hand into a TiltProof drill, the rough stretch
   into the matching Untilt exercise — and eventually share an account across
   the three apps.
6. **Bankroll goals** — target roll, stop-loss and stop-win per session, and a
   move-up/move-down prompt driven by the variance model that is already here.

Also wanted, smaller: tournament support, session photos of the chip stack,
Apple Health–style weekly summaries, an Apple Watch companion for the timer, and
per-venue rake tracking.

---

## Licence

MIT
