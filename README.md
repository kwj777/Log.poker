# Log

**The session log that keeps you off tilt.**

A poker session tracker and hand journal for live cash game and home game
players. Log a session in under ten seconds, log a hand in under fifteen, and
get an honest answer to the question every downswing provokes: *am I running
bad, or am I playing bad?*

Log is the hub of a three-app family:

| App | What it's for |
| --- | --- |
| **Log** (this repo) | What happened -- sessions, hands, results, variance |
| [Untilt.poker](https://untilt.poker) | How it felt -- mental game work |
| [TiltProof](https://tiltproof.poker) | What to do differently -- odds and spot training |

How the three are priced together is worked out in
[FAMILY-PRICING.md](https://github.com/kwj777/Untilt/blob/main/FAMILY-PRICING.md),
over in Untilt beside the monetization document it extends. The short version
for this repo: **Log is free in its entirety and has no standalone price.** See
[What is free, and what is not](#what-is-free-and-what-is-not).

---

## What's in the MVP

- **Session logging** -- start and end a session with stakes, game type, venue
  and buy-in; rebuys mid-session; cash-out at the end. Duration, profit/loss and
  hourly rate are computed, never typed. The new-session screen is pre-filled
  from your last session, so the common path is open, glance, Start.
- **Quick hand journal** -- a two-taps-per-card picker, position, one line of
  note, and tags (*bad beat*, *misplayed?*, *cooler*, *bluff*). Everything is
  optional; the hand saves as soon as anything at all has been entered.
- **Mood check-in** -- an optional one-tap tilt meter at the start and end of a
  session, plus a deliberately subtle inline prompt two hours in. Stored
  alongside the result, so "I left three steps more rattled than I arrived" is a
  thing you can see.
- **Dashboard** -- bankroll curve, hourly rate, session count, hours played, and
  profit broken down by stakes, venue or game type.
- **Variance view** -- your own win rate and standard deviation, with your recent
  stretch placed inside the confidence band those numbers predict. See
  [The variance model](#the-variance-model).
- **Session history** -- filter by period, venue and game type; every filter
  recomputes the totals above the list.
- **Tournaments** -- entry and fee kept apart, re-entries, field size and where
  you finished, with a cash rate, a dry-run reading, and an ROI carrying a
  bootstrapped confidence interval rather than a false air of precision.
  See [Tournaments](#tournaments).
- **Session-summary import** -- bring an online history in from a CSV your site
  or your tracker exported, rather than typing out a year of sessions. See
  [Importing an online history](#importing-an-online-history).
- **Family cross-promo** -- a shared "More from the family" card, plus two
  contextual hand-offs: a rough stretch on the variance view offers Untilt, and
  a hand tagged *misplayed?* offers to drill the spot in TiltProof.

Offline throughout, and that is the default rather than the limit: no account,
no network call, nothing leaving the device. Signing in is optional and is the
only thing that changes it, carrying your own log to your own other devices.
See [Signing in](#signing-in-and-what-it-is-for).

---

## What is free, and what is not

**Everything above is free, permanently, and none of it needs an account.** Log
is the one app in the family with no standalone price, and that is a decision
rather than an oversight. What is valuable in a tracker is the player's own
record, so an app whose entire pitch is *am I running bad or playing bad* cannot
also charge rent for the answer. It is also the app that gets talked about,
which is how anybody arrives at the other two.

The paid side of the family is the longer material in TiltProof and Untilt, sold
as one payment rather than a subscription. **Log adds nothing to it.**
Cross-device history was going to: it was the one thing here with a price, it
came with owning the other two, and the argument was that a second device needs
an identity to sync to and paying is what creates one, which made it an honest
conversion moment rather than a hostage situation.

That argument lost to a simpler one. Every tracker worth using syncs for free,
so the only paid thing in this app would also have been the one thing a player
could get elsewhere for nothing, and *free in its entirety* would have carried a
footnote forever. It is unbuilt today, it is roadmap item 2, and when it lands it
lands free; [SYNC.md](SYNC.md) scopes what building it takes and names the one
thing still in the way, which is that Untilt's sign-in only mails a code to an
address that has bought something.

The numbers themselves live in
[FAMILY-PRICING.md](https://github.com/kwj777/Untilt/blob/main/FAMILY-PRICING.md)
and are deliberately not repeated here or anywhere in this repo. Three copies of
a price is three chances for two of them to go stale.

### The copy rule, and its second half

**No price appears anywhere on log.poker.** Not on the front door, not on the
four guides, not on `/chip`. Somebody who has used none of the three has no way
to value one, and a number in front of them prices the family before it has
earned anything; the pass is sold inside each app at the moment of need instead.
`src/site/__tests__` and `src/campaign/__tests__` enforce that on all six pages.

Carrying no number is not the same as saying nothing about money, though, and
that is the half that is easy to lose: **every page says how much of each app is
free.** All of Log, the early levels and the glossary in TiltProof, the
at-the-table resets in Untilt. Without it a page that only ever says *free*
makes a promise on behalf of two apps that do not keep it, and the front door
had been doing exactly that. Tested alongside the rule it qualifies.

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
npm test            # house style, then the unit tests
npm run typecheck   # strict TypeScript, app and tests
npm run lint        # eslint-config-expo
npm run check:prose # house style on its own
npm run test:table  # rewrite the README test table from a real run
npm run build:content -- --check  # the guides match their generator
npm run test:table -- --check     # the test table matches the suite
```

`npm test` runs the house-style check first and stops if it fails. It reads
files rather than compiling them, so it costs a fraction of a second and the
message it prints names the file, the line and the word. `npm run test:watch`
leaves it out: the tight loop is for the tests, and a half-written comment
should not interrupt it.

### Demo data

Settings → **Load demo data** seeds 20 mixed-result sessions with hands and mood
entries -- enough to fill the dashboard and give the variance view something to
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

## The site, and where the app lives

**log.poker is the marketing front door for all three apps, and Log itself is
under `/app`.** That split is worth understanding before changing anything about
the build.

| | |
|---|---|
| `/` | `public/home.html`, renamed to `index.html` at build time. Static, no bundle, no external request of any kind. |
| `/app` | Log. The whole Expo export, moved wholesale into `dist/app`. |
| `/running-bad`, `/bankroll`, `/pot-odds`, `/tilt` | The guides. See [The guides](#the-guides). |
| `/blog` | The Log Blog, generated from `content/blog`. See [The blog](#the-blog). |
| `/chip` | The card protector landing. See [The chip campaign](#the-chip-campaign). |
| `/apps` | 301 to `/`, which now lists the family. |

`scripts/build-web.mjs` is what makes that shape, and its rule is one line that
maintains itself: **everything the bundler emitted moves under `/app`, and
everything that came from `public/` stays at the root.** The names in `public/`
are read at build time rather than listed, so adding a file there needs no
change to the script.

Moving files rather than rewriting URLs is what keeps `netlify.toml` short: the
prerendered routes land as real files at the paths that serve them, so
`/app/history` is a document rather than a rule, and the only redirect the app
needs is the client-router fallback for paths that were never prerendered, like
`/app/session/<id>`. `experiments.baseUrl` in `app.json` is the other half, and
makes the export reference its bundle at `/app/_expo`.

Three things are load-bearing and quiet when broken, so `src/site/__tests__`
asserts them:

- **Netlify's build command is `npm run build:web`, not the bare export.**
  Running the export alone deploys the app at `/` with no front door, and
  nothing errors.
- **The manifest is scoped to `/app`.** Scoped to `/`, installing the app
  installs the marketing page.
- **The service worker is registered with `{ scope: '/app/' }`**, which a worker
  served from `/` may only claim because `netlify.toml` sends
  `Service-Worker-Allowed: /app/`. Without that header the registration throws
  and offline disappears without a trace.

## The blog

There is no back office. **A post is a Markdown file in `content/blog`, and
publishing one is committing it.** `scripts/build-blog.mjs` reads that
directory and generates the index, the post pages, an RSS feed and the sitemap
entries, so nothing about a post is written down in two places.

Name the file `<YYYY-MM-DD>-<slug>.md`: the date orders the directory and dates
the post, and the rest of the name is the URL.

```markdown
---
title: I flopped a straight flush in a bomb pot. He had a boat.
description: One sentence. It is the index line, the search result and the feed summary.
---

The body starts here. Headings start at `##`, because the title is the h1.
```

| Front matter | |
|---|---|
| `title` | Required. |
| `description` | Required, and it is doing three jobs: the index line, the meta description, and the feed summary. |
| `updated` | Optional `YYYY-MM-DD`, for a post edited after it went out. |
| `draft` | `draft: true` keeps it out of the index, the feed, the sitemap and the build entirely. |

The Markdown is a deliberate subset: headings from `##` down, paragraphs, `-`
and `1.` lists, `>` quotes, fenced code, `---`, and inline `**bold**`,
`*italic*`, `` `code` `` and `[links](/here)`. There are also two block
directives:

```
::: figure bomb-pot-hand
A caption, which is optional.
:::

::: stat 1 in 34,700
The line under the number, which is also optional.
:::
```

A figure inlines `content/blog/figures/<name>.svg` into the page, so an
illustration costs no request either. Hand diagrams are drawn by
`scripts/draw-hand.mjs` from a short spec (`2d!` is the two of diamonds with
the gold edge that marks a card as part of the hand, `?s` is a spade whose rank
nobody remembers, `??` is face down), so every hand on the blog is drawn the
same way. The SVG is the artefact and is committed with the post; run
`node scripts/draw-hand.mjs` after changing a spec, which a test then checks. Everything outside the subset throws at
build time rather than reaching a live page, and raw HTML in a post is escaped
rather than passed through, so a stray `<` in prose can never eat a paragraph.

To read a draft before it ships, without waiting for the app export:

```bash
npm run build:blog -- .preview
npx serve .preview          # then open /blog
```

What a build produces:

| | |
|---|---|
| `/blog` | The index, newest first. |
| `/blog/<slug>` | A post. Written as `blog/<slug>/index.html`, so the URL carries no `.html` and needs no redirect rule. |
| `/blog/feed.xml` | RSS 2.0, with the full post in `content:encoded`. |
| `/sitemap.xml` | `public/sitemap.xml`, which stays the hand-written truth for the front door and the app, plus one entry per post. |

Three things are worth knowing before changing any of it:

- **The blog is generated after the export has been moved under `/app`.**
  Generated before, the move loop would sweep every page of it under `/app`
  with the bundle and `/blog` would 404 with nothing erroring.
- **The pages fetch nothing.** No bundle, no stylesheet, no font: the same
  promise `public/home.html` makes, and asserted the same way.
- **Share cards are drawn ahead of time, not by the site build.** Nothing an
  unfurl shows can be an SVG, so `scripts/build-og.mjs` draws a 1200x630 PNG
  per post into `public/og` and commits it. `build-blog.mjs` only points
  `og:image` at what it finds there, so a deploy never depends on a
  rasterizer being installable, and a post with no card yet falls back to the
  app icon rather than to a hole.

### Share cards

```bash
npm run build:og            # public/og/<slug>.png, and og/blog.png for the index
```

The card opens on the hand the post is about: the cards its figure marks as
played, the two that were mine and then what the board gave, drawn by the same
code as the diagram in the post. A post with no figure gets its title alone.

Run it after adding a post and commit the PNG. It needs `@resvg/resvg-js`,
which is a dev dependency and deliberately nothing the deploy touches.

Fonts are the one part not fully in the repository's hands: the card asks for
the site's own stack, Georgia first, and a Linux machine renders it in
Liberation Serif, which is metric compatible with Times New Roman and already
second in that stack. Two machines can draw very slightly different cards,
which is another reason the PNG is committed rather than generated on the way
to production.

`src/site/__tests__/blog.test.ts` runs the real script twice, over
`content/blog` and again over fixtures, so what the grammar refuses is asserted
rather than assumed.

---

## Deploying to Netlify

`netlify.toml` is committed and complete; connecting the repo is the whole setup.

1. **New site from Git** → pick this repository.
2. Netlify reads `netlify.toml`, so the build command
   (`npm run build:web`), publish directory (`dist`) and Node version are
   already configured. Leave them as detected.
3. Deploy, then point `log.poker` at the site under **Domain management**.
   Netlify provisions the TLS certificate; the PWA needs HTTPS to install and to
   run a service worker.

To check a production build locally before deploying:

```bash
npm run build:web
npx serve dist      # or any static server with a single-page fallback
```

### What `netlify.toml` does

- **SPA fallback** -- `/app/*` → `/app/index.html` with status `200`, so a deep
  link like `/app/session/<id>` is served the app shell and resolved by the
  client router rather than 404ing. There is deliberately no catch-all at the
  root: an unknown address gets `404.html` rather than quietly resolving to the
  app.
- **Cache headers** -- `index.html`, `sw.js` and the manifest are
  `must-revalidate` so a deploy reaches returning visitors immediately;
  everything under `_expo/` and `assets/` is content-hashed by the bundler and
  cached for a year.
- **Security headers** -- `nosniff`, `SAMEORIGIN`, and a strict referrer policy.

---

## The PWA

The web build is installable and works fully offline -- a hard requirement, since
card rooms are windowless basements with no reception. A player mid-session has
to be able to add a rebuy and log a hand with the network entirely gone.

That is achievable because Log has no backend: every read and write goes to
IndexedDB in the browser, so the only thing the network is ever needed for is
the app shell itself.

- **`public/manifest.webmanifest`** -- standalone display, portrait, the charcoal
  theme color, 192/512 icons plus a maskable one, and a "Start a session"
  shortcut. `start_url` and `scope` are `/app`, not `/`: at the root, installing
  Log would install the marketing page.
- **`public/sw.js`** -- network-first for navigations (so a deploy is picked up
  promptly) falling back to the cached shell; cache-first for the
  content-hashed bundle and icons; stale-while-revalidate for everything else.
  On install it parses the shell HTML for its script and stylesheet URLs and
  precaches them, so even the *first* offline visit works rather than the
  second. Bump `CACHE_VERSION` to force every client to discard its caches.
- **`app/+html.tsx`** -- the document shell: manifest link, theme color, Apple
  touch icon, `viewport-fit=cover` for safe areas, and the service-worker
  registration (production builds only -- a worker in front of the Metro dev
  server would serve yesterday's bundle).

`app.json` sets `web.output: "static"`, which is what makes `+html.tsx` take
effect. Log's content lives entirely in a local database, so the pre-rendered
HTML is just the shell -- the value is the customized `<head>`, not
pre-rendered content.

Verified in a headless Chromium against the real production build: the worker
installs and precaches the bundle, the manifest satisfies Chrome's installability
criteria, and with the network switched off the app boots from a cold reload,
resolves deep links, and reads and writes sessions, rebuys and hands.

---

## The guides

Four pages that answer a question somebody actually types into a search engine,
each one linked from the front door and from the other three:

| | |
|---|---|
| `/running-bad` | What an ordinary downswing looks like, and the chance a winning player is behind after a given number of hours. |
| `/bankroll` | Risk of ruin, and what the 20 buy-in rule is really a claim about. |
| `/pot-odds` | Outs, exact equities, and the two ways the rule of 2 and 4 misleads. |
| `/tilt` | What tilt costs, what it is, and what works at the table. |

They are generated rather than hand-written:

```bash
npm run build:content            # write public/<slug>.html
npm run build:content -- --check # fail if any committed page is out of date
```

`scripts/build-content.mjs` holds the copy, and the reason it exists is the
same reason the icon script does. The four pages share a head, a mark, a nav,
a footer and about a hundred lines of CSS, and every page here paints with no
external request of any kind, not even a font, so that CSS has to be inline on
each of them. Four copies of it is four chances to change three.

**Every number in every table is computed, never typed.** A poker page that
gets its own arithmetic wrong is worse than no page.
`src/site/__tests__/content.test.ts` reads the published HTML back and checks
each figure against `src/domain/variance.ts` and against plain combinatorics,
so a table is verified as published rather than as intended. It checks the
sentences that quote the tables too: "one time in six" and "roughly 55 times
riskier" are claims a reader will divide two cells to check, and both were
wrong once from rounding alone.

Each page answers its question in full before it mentions an app. A page that
withholds the answer to make you install something is the genre this is trying
not to be in.

## The chip

The card protector itself: a 47mm ceramic disc with the family mark over
`log.poker` on one face and a scannable code on the other. `design/chip/`
holds the two faces, the proof sheet and its own README; `npm run chip`
regenerates the code from `chipUrl('qr')` and rasterizes everything.

The code is checked three ways, and the third exists because the first two
cannot do its job: the matrix is asserted to come from the campaign URL, the
rendered PNG is decoded by a real scanner, and the physical module size is
computed in millimeters. A 2000px artboard decodes at any tile size; a 47mm
disc does not.

## The chip campaign

`log.poker/chip` is the landing a ceramic card protector points at, and it is
the one route in this repo that is a promise rather than a convenience. Chips
are permanent objects: once one is on a felt, that URL has to resolve for as
long as it exists, through every later rewrite of the app.

So it is deliberately the least clever thing here -- `public/chip.html`, a single
static document under 9KB with **no bundle, no framework, and not one external
request, not even a font**. It renders with scripting turned off, and it renders
immediately on one bar of signal, which is the condition it will actually meet:
card rooms are windowless basements.

- **`src/campaign/chip.ts`** is the single source of truth for the printed URL.
  `chipUrl('qr')` is the exact string to encode, and the medium is a parameter
  so an NFC batch later needs no change anywhere else.
- **`netlify.toml`** rewrites `/chip` to the file *above* the single-page
  catch-all, because Netlify takes the first matching rule and `/*` matches
  everything.
- **`netlify/functions/chip-scan.mjs`** counts scans: two integers, one per
  medium, no row per scan and nothing about the visitor. It fails open in every
  direction, and the page renders identically when it is not deployed at all.
- **`src/campaign/__tests__/chip.test.ts`** asserts the guarantee rather than
  the implementation -- that it resolves, resolves without the network, reads
  L then O then G, and never quotes a price.

That last one is not a joke. `app.json` sets `web.output: "static"`, so the
export prerenders each route to its own file at the site root: an Expo route at
`/chip` would emit `dist/chip.html` and silently replace the landing page. The
test fails if one appears.

**The page carries the brand palette, not `src/theme`.** Somebody arriving here
just looked at the object, and the object is charcoal and gold. See `BRAND.md`.

---

## The palette

`src/theme` implements the family's tokens rather than its own, and
`src/theme/__tests__/palette.test.ts` parses the table in `BRAND.md` and fails
if the two drift. That is worth a test because the failure mode is silent and
embarrassing: a player scans a card protector, lands on `/chip`, and reaches the
app one tap later, so the two surfaces being visibly different products is the
exact thing the shared palette exists to prevent.

**The accent is gold, and it used to be felt green.** The reason is not brand
tidiness -- the old accent sat *two degrees of hue* from `profit`, so a control
and a winning session were the same color to anybody glancing at the screen in
a dim room. Gold is 119 degrees away, which leaves green meaning money and
nothing else, and it reads better besides: 7.2:1 on the background against the
6.3:1 it replaced. The test asserts both the hue separation and the contrast
floors, so neither can quietly come back.

Semantic colors -- profit, loss, the tilt meter -- are deliberately *not* pinned
to `BRAND.md`. They mean something rather than brand something.

---

## Architecture

```
content/blog/             the blog, one Markdown file per post
  figures/                hand diagrams, drawn by scripts/draw-hand.mjs
public/og/                share cards, drawn by scripts/build-og.mjs
app/                      Expo Router routes
  _layout.tsx             opens the database, then renders the navigator
  +html.tsx               web document shell (PWA wiring)
  (tabs)/                 dashboard · sessions · variance · settings
  session/                new · active · [id] · hand
src/
  domain/                 pure math and types -- no React, no storage
    types.ts              the data model
    money.ts              integer cents in, formatted strings out
    handNotation.ts       "AsKd" -- the stable hand-off format
    stats.ts              P/L, hourly rate, bankroll curve, groupings
    variance.ts           win rate, standard deviation, confidence bands
    tournaments.ts        ROI, its bootstrapped interval, cash rate, dry runs
    random.ts             one seeded generator, shared by the demo and the bootstrap
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
synchronous key-value string stores with no indexes, and querying five years of
sessions through one means deserializing all of them on every read.

`SqlRepository` talks to a five-method `SqlDriver` rather than to `expo-sqlite`
directly. `expo-sqlite` implements it on device and `node:sqlite` implements it
in the test suite -- so the class that ships to iOS and Android is the class the
tests exercise, against a real SQLite engine, rather than a fake that would
agree with whatever the repository happens to do.

### Deletes are tombstones

Nothing in the data layer removes a row any more. `deleteSession` and its four
siblings set `deleted_at` and leave the record where it is; every read filters
on it, so from a screen's point of view nothing changed at all. On IndexedDB it
needed no version bump, because the property is not indexed and a record written
before it reads as live.

The reason is not local. Across two devices, a row that is absent because
somebody deleted it and a row that is absent because this device has not been
told about it yet are **the same absence**, so a merge that unions rows brings
back every session anybody ever removed. Delete a mis-entered session on the
phone, watch it come back from the laptop, watch the bankroll curve disagree
with itself.

Four things fall out of that and are asserted in the conformance suite:

- **Children take the parent's stamp.** A hand tombstoned a millisecond after
  its session is a hand a later merge can revive on its own.
- **Tombstoning a session clears its `importKey`.** Deleting an imported session
  has always made it importable again, and a tombstone holding the key in a
  unique index would end that quietly. The key is derived from the source row,
  so a re-import mints it again.
- **A tombstoned session stops holding its venue back**, but the venue is
  tombstoned rather than removed, because the deleted session's `venueId` still
  points at it and a foreign key that stops resolving is a broken read.
- **`clearAll` is still a truncate.** It is the one delete that is not a
  tombstone, and the distinction is the whole reason to be careful here: reset
  means *this device*, not *every device*. Writing tombstones would let somebody
  clearing a phone they are about to sell take five years of history off the
  laptop with it.

`listChangedSince(cursor)` is the only read that can see a tombstone, and the
seam the sync engine plugs into. Nothing calls it yet. It exists because an
invariant nothing can read is an invariant nothing can test.

The merge rules themselves are pure functions in `src/domain/merge.ts`: per
record last-write-wins, a clock clamp, and the three cases where the thing in
conflict is a constraint rather than a field, so both devices are right and the
pair is wrong. **Not built yet: collecting tombstones.** They accumulate until
something sweeps them, which is phase 2 work, and until then a heavy deleter's
database grows where it used to shrink.

### Signing in, and what it is for

`src/auth` is the client half of the family's identity. It exists for exactly
one feature, cross-device history, and **nothing else in the app has anything to
do with it**: Log is free in its entirety and stays completely usable by
somebody who never types an email address. There is no signed-out state to
handle, because signed out is the state every screen already runs in.

The token is minted by Untilt's sign-in and is the same string in all three
apps. It has to be a bearer string rather than a cookie: `log.poker`,
`untilt.poker` and `tiltproof.poker` are three registrable domains, so no cookie
crosses them, and on iOS and Android there is no cookie jar at all.

```
<expiry>.<tier>.<subject>.<signature>
```

Three things about this are worth knowing before touching it.

- **Nothing on this side verifies a signature.** Checking one needs the gate
  secret, and a secret shipped inside an app anybody can download is not a
  secret. A parsed claim decides what to show and what is worth sending; the
  server re-derives on every request and is the only answer that counts.
- **The expiry is in seconds** where every other timestamp in this app is
  milliseconds. Converted at the boundary, and tested there, because the
  difference is a factor of a thousand and therefore about fifty years.
- **The tier decides nothing; the holder needs a subject of their own.** That is
  the whole of the rule, on both sides. Sync is free, so `claim.tier` is parsed
  and never read, and what is left is the refusal that was never about money:
  everybody who typed a passcode shares one subject, so syncing them together
  would pour every preview visitor's history into a single bucket.

`SessionManager` holds the token over a three-method `TokenStore`, the same
trick `SqlRepository` plays on `SqlDriver`: the keychain on device and
`localStorage` on web are a dozen lines each, and everything worth testing runs
against an in-memory one. Both adapters answer as if nothing were stored when
storage is unavailable, which is ordinary rather than exceptional -- a locked
device, a private window, a prerender with no `window` at all.

**The server side is Log's own**, in `netlify/functions/signin.mts`, and that
is the second thing making sync free took. The family's sign-in is Untilt's and
will not mail a code to an address Stripe has no customer for -- *only somebody
who has bought can be reached*, in its own words -- which was right while sync
was sold and wrong the moment it was not. Removing the tier check let a free
token sync; it did not let a free player get a token. So Log answers the same
two paths on its own host, mints the free tier for anybody who can read their
mail, and Untilt is untouched.

The contract is still Untilt's, deliberately: the same paths, bodies and
statuses, so `src/auth/signin.ts` did not change shape and neither did the
screen. One constant moved. `Accept: application/json` is still sent and is no
longer what makes the difference, because Log has no page and no cookie to
answer with.

**Minting lives beside verifying**, in `src/sync/verify.ts`, which is now the
one file that holds the key. Two files each knowing half of a signature format
are two files that disagree in a year, and the failure is a token this family
mints and then refuses.

There is still no user table. A subject is an HMAC of the normalized address, a
pending code is stored under another HMAC of it as an HMAC of the code, and a
store that leaked would say how many people have signed in and nothing about
who. Normalizing matters: Untilt keeps the spelling somebody typed because
Stripe's filter is case-sensitive, nothing here looks anybody up, and
`Player@Example.com` reaching a different history would be a second empty log
with nothing on screen to explain it.

A door that mails anybody can be pointed at somebody who did not ask, so it is
bounded: one mail a minute and five a day per address, twenty requests an hour
per caller, counted before anything is generated. A code is six digits, single
use, good for fifteen minutes, and dies after five wrong guesses. A send that
fails takes its record back, or the retry a person makes straight away is
silently ignored.

The screen is in `src/features/account`: an address, then the code mailed to
it, and never the link, because mail opens links in the browser and an installed
app keeps its own storage.

**It is on.** `ALLOW_SIGN_IN` was `__DEV__` for two phases, the same treatment
the demo seeder gets and for the same reason: signing in unlocked nothing until
there was something to sync to, and a form that cannot succeed is worse than an
absence. `GATE_SECRET` and `RESEND_API_KEY` are set, the chain has been run
end to end against the live site, and the constant is `true`.

The flag stays rather than being deleted, because it is now a kill switch:
`/api/signin` mails a code to anybody who types an address, and setting the
constant to `false` strips the card from the next build while the endpoint's
own limits hold in the meantime. A test pins its current value either way, so
it cannot move by accident.

The copy has tests, which most copy should not. `/api/signin` answers 202
whether or not a mail went, so that nobody can use it to ask how much mail an
address has had. A screen that said *check your inbox* would throw that away on
the client, where no review of the server would catch it. So the confirmation is
conditional and the refusal never guesses why. It also said *if that address has
a purchase behind it*, which was true of Untilt's door and is not true of this
one; there is a test now for the sentence that would put the price back.

### Cross-device history

Off unless somebody signs in, and live for anybody who does. `GATE_SECRET` is
set on this site, without which every endpoint answers 503. The value has to be
byte for byte what Untilt signs with, and it cannot be changed later without
orphaning every bucket, because a bucket name is an HMAC of the subject under
that same key. `npm run check:gate` asks the deployed endpoint whether the key
it holds is the one you have, and `npm run check:gate -- --signin <address>`
asks the harder half, whether it is the key Untilt signs with. Both say in
plain words what came back. See SYNC.md.

**One round trip does both halves.** A device sends what it changed and what it
last saw; it gets back everything it has not seen. `netlify/functions/sync.mts`
is the thin part around `src/sync/bundle.ts`, and it is TypeScript rather than
`.mjs` precisely so it can import that file: two implementations of a merge is
two merges that disagree in a year.

- **The server merges.** A device that has been in a drawer for a month has a
  month-old view of the world and possibly a wrong clock, so resolving there
  would make the answer depend on which device asked. One place holds the
  outcome and every device converges on it.
- **Delta on the wire, bundle at rest.** One object per person in Netlify
  Blobs, keyed by an HMAC of the subject so the store never holds a customer id.
- **Two cursors, not one.** `pulled` is what the server has told this device
  about; `pushed` is what this device has sent. They look like one number and
  are not: the server's cursor moves past stamps this device wrote and never
  sent, and collapsing them loses exactly those records.
- **Both comparisons read one millisecond back.** A record written in the very
  millisecond of the last sync is otherwise invisible forever, and a venue and
  the session started on it are routinely the same millisecond. Re-sending a
  millisecond is free, because applying a record twice is a no-op.
- **Writes never wait on it.** Everything commits locally and returns; the push
  happens after. A card room has no wifi and that is the normal case.

`src/data/index.ts` is where the wrapper is composed in, which is what keeps all
of this out of every feature folder: a screen asks for a repository and gets
one, and whether it talks to a server is not a question it can ask.

#### Tombstones are collected, carefully

A tombstone is kept for **ninety days**, and then only goes if nobody is still
waiting to hear about it. **Collecting one too early resurrects the record**: a
device still holding the live row meets a server with nothing left to refuse it,
pushes, and a session somebody deleted in March is back on every device in June.

Time alone is a guess at that, so the bundle counts. It holds a map of device to
last-seen, and the line is the earlier of *ninety days ago* and *the least
recently seen device*. A device unseen for **a hundred and eighty** days is
presumed gone -- sold, or replaced -- because one lost phone should not freeze
collection for the rest of somebody's life. Twice the window rather than once,
or the rule would be decorative: every remembered device would be newer than the
window and the minimum would never bind.

That leaves one hole and one backstop. A device gone longer than the forget
threshold comes back holding rows whose tombstones are gone, so **a record the
server has never seen, older than everything it has collected, is refused.**
That can lose a record such a device really did create and never sent, which is
the worse thing to lose and much the rarer: it takes six months offline and a
write that never left. The alternative is a deleted session reappearing on every
device, which takes only the six months.

A device that never signs in collects on the window alone, having nothing to
disagree with. One that does sync never collects further back than the server
says it has: the server draws that line from every device, and this one only
knows about itself.

### Testing

One conformance suite, `src/data/__tests__/repositoryContract.ts`, runs against
**both** implementations -- real SQLite via `node:sqlite`, real IndexedDB via
`fake-indexeddb`. Ordering, cascade behavior, patch semantics and constraint
errors are asserted once, so a bug cannot reproduce on only one platform.

```
Test Suites: 39 passed
Tests:       1128 passed

  dexieRepository   115   the IndexedDB path, against real IndexedDB
  sqlRepository     115   the SQLite path, against real SQLite
  bundle             63   what ships to each platform, against the real output
  content            55   every figure in the guides, re-derived and read back
  sessionImport      52   reading a session-summary export
  tournaments        51   ROI, its interval, cash rate, dry runs, finishes
  stats              45   P/L, rebuys, duration, win rate, groupings
  site               39   the marketing/app split, the PWA, the sitemap
  values             36   money, dates, durations, stakes, formats, counts
  signinEndpoint     35   the free door, and every bound on it
  variance           35   win rate, σ, confidence bands, verdicts
  verify             35   checking a token, and every way past it that must not work
  mood               32   what tilt costs, and when to say nothing
  merge              30   two devices disagreeing, and who wins
  syncingRepository  29   two devices and one server, no fakes in between
  blog               28   the post grammar, the share cards, and what it refuses
  palette            27   the theme matches BRAND.md
  endpoint           25   the sync endpoint, end to end
  chip               23   /chip resolves, offline, and never quotes a price
  migrations         22   a filled v2 database walked forward, both engines
  copy               20   what the sign-in and the sync are allowed to say
  batch              19   a backlog split into requests, without orphaning a child
  csv                19   quoting, delimiters, line endings
  money              18   cents arithmetic, parsing, formatting
  token              17   the family token grammar, against signed fixtures
  handNotation       16   parse, round-trip, hand classes
  client             14   the sync client, against a fake fetch
  seed               14   the demo dataset stays coherent
  session            13   holding a token, and stores that fail as real ones do
  signin             12   the sign-in client, against a fake fetch
  gateCheck          11   the key-on-the-site script, run rather than read
  handOffs           11   where a hand-off goes, and what the mid-session card says
  importIntegration   9   parse → store → read back, against real SQLite
  selectors           9   store reads and filters
  plan                8   what an import will write, before it writes it
  tokenStore.web      8   the browser token store
  columns             7   header matching
  readme              6   the test table adds up and says what each suite is for
  compose             5   which repository a device gets, and the unsafe sweep
```

`npm run check:prose` is the house-style pass (American spellings, no en or em
dashes) and it runs ahead of Jest as part of `npm test`. It reads tracked files
*and* new ones that are not yet committed, so a rule nobody checks does not
quietly become a preference again.

**The table above is generated.** It was kept by hand and it showed: it
conflicted on every merge into a feature branch without exception, because both
sides always carried a count that went stale the moment the branches parted.
`npm run test:table` runs the suite and rewrites it; `-- --check` fails if the
committed table does not match one.

The counts are generated and the descriptions are not. "two devices disagreeing,
and who wins" is the reason to have the table at all, and nothing can derive it
from a suite name, so the generator reads the descriptions back out of the README
and writes them again beside fresh numbers. This file stays the place you edit
the prose; the script owns only the digits. A new suite arrives with a
placeholder, which `src/site/__tests__/readme.test.ts` fails on until somebody
writes it a sentence.

It cannot run inside `npm test`, because finding out what the suite does means
running the suite. What runs there instead is that test, which checks everything
that does not need the results: that the rows add up to the stated total, that
the order is a function of the numbers, and that no placeholder was left behind.
Only `--check` can see a suite missing from the table altogether, because seeing
that means knowing what suites exist.

### Money

Every amount is an integer number of **cents**, everywhere, converted to a
string only at the edge. Dollars as floats accumulate rounding error across
thousands of sessions, and a bankroll that is wrong by a cent is a bankroll
nobody trusts.

### The variance model

Results are treated as a random walk in time: over `h` hours a player with win
rate `w` (big blinds per hour) and per-hour standard deviation `σ` has a result
with mean `w·h` and standard deviation `σ·√h`.

Both parameters are estimated from the player's own completed sessions -- never
from a hard-coded "typical" number, which would be a guess dressed up as a
measurement. Win rate is total big blinds over total hours; the standard
deviation uses the method-of-moments estimator for a variance that scales with
time, `σ² = Σ(rᵢ − ŵ·hᵢ)² / Σhᵢ`, with a Bessel-style correction for the one
parameter estimated from the same data. Results are normalized to big blinds so
sessions across different stakes pool into one estimate.

**This model is for cash games only.** `toObservations` drops tournaments, and
[Tournaments](#tournaments) explains why at length. It also drops any session
with no measurable duration or no recorded blinds, since neither can be turned
into a result per hour.

Below eight sessions or twenty hours the view says it doesn't have enough data
rather than inventing a verdict. Above it, the copy is written to be true *and*
calming: a rough stretch inside the band is named as ordinary, an outlier is
named as an outlier, and a heater is called a heater so nobody banks on it. A
test asserts that no verdict branch ever implies the player is broken or that
they are "due".

### What tilt costs

`MoodPicker` has taken a 1-to-5 score at the start, middle and end of every
session since the app shipped, and its own header calls the correlation between
mood and results the reason it exists. Nothing computed it until
[`src/domain/mood.ts`](src/domain/mood.ts).

**Sessions are grouped by the score logged before the cards.** That is the whole
design and it is not the obvious choice. The instinct is to group by the worst
score, or the one at the end, because that is where tilt shows -- but both are
downstream of the result. A player who loses four buy-ins reports feeling
terrible afterwards, so a split on end mood mostly measures *losing feels bad*:
true, circular, and no use to somebody deciding whether to sit down tonight. The
start score cannot have been caused by the result, which makes the comparison
real and the advice actionable.

Everything is in big blinds, for the same reason the variance model is: sessions
across stakes have to pool.

**It refuses far more often than it speaks.** Poker variance is large enough that
a difference of means over a handful of sessions looks like a finding almost
every time, and an app whose flagship screen exists to talk players out of
reading noise as signal cannot ship a feature that manufactures one. So the gap
is measured against its own standard error, using the player's own sigma, and
reported only when it clears the bar. When it does not, the card says so and says
how many more hours would settle it -- and says nothing at all when no amount
would, because the other group is the binding constraint.

Two tests carry that claim rather than a comment: three hundred simulated players
whose mood affects nothing produce a settled finding 9.7% of the time against a
nominal 10%, and the same players with a real 40bb/hour penalty produce one well
over half the time. Calibration without power is a function that returns `false`.

**The Untilt hand-off is behind one gate, and the gate is in the domain.**
`worthActingOn` is exported and tested rather than living as a boolean inside the
card, because it is the one place a conflict of interest could hide: there is a
standing pull toward finding tilt expensive when a cross-promo sits underneath.
Three of the card's four states show no hand-off, including the one where the
comparison settles the *other* way and a player's rattled sessions are their
better ones. That state is still reported. An analysis that only speaks when it
supports the upsell is an advertisement wearing a lab coat.

### The mid-session reset

A player two hours into a session who taps **4** or **5** on the tilt check has
just said, at a table, that they are rattled. That is the state Untilt exists
for, so the card does not simply vanish on those two scores: it offers a
sixty-second reset that is free, needs no account, and opens straight into the
exercise via Untilt's own `play=<id>` form rather than dropping somebody on a
home screen to go and find it.

**The tap is recorded first and unconditionally, and that ordering is the whole
safety of the feature.** `MoodPicker`'s header says mood data is only useful if
logging it costs nothing, and the moment it feels like homework players stop --
so a check-in that summons something *before* recording is one people answer
with a 3 to be left alone, and the correlation in
[What tilt costs](#what-tilt-costs) dies quietly. A test reads the handler and
asserts `logMood` comes first with nothing conditional in front of it, because
that property cannot be seen from the rendered output.

**Nothing here is sold.** The resets reached for mid-session are free across the
family by the front door's own promise, so the card names no price, asks for no
address, and says *free* rather than leaving anyone to wonder. Tests assert the
absence as well as the presence: no currency, no buy, no sign-up. The paid
material is mentioned on the variance screen next to a number, away from the
table, which is where that promise puts it.

Which scores count as rattled is `wantsReset`, and it reuses `RATTLED_SCORES`
from the comparison rather than restating `[4, 5]`. A player who would land in
that group at the end of the month is the one worth offering something to
tonight, and two definitions of rattled in one app is one too many.

The URL builders moved to [`src/features/family/links.ts`](src/features/family/links.ts)
to make any of this testable. `hooks.ts` imports `Linking` from React Native,
which this repository's Node test runner cannot load, so the builders had no
tests purely by accident of sharing a file with a two-line wrapper. Building a
URL and following one are different jobs, and only the first has anything to get
wrong.

### Hand notation

Hole cards are stored as `"AsKd"` -- rank then suit, two characters per card, the
format every other poker tool already speaks. That is what makes the TiltProof
hand-off possible without a translation layer, and what a CSV export will emit.

---

## Tournaments

A tournament is not a cash session with different words, so it is a discriminator
on the record rather than a tag on the side. `Session.format` is `cash` or
`tournament`, and the format decides which fields the session is allowed to
carry: a tournament has an entry fee, a field size and a finishing position and
no blinds; a cash game has blinds and none of the other three. That is enforced
in `buildSession` rather than trusted from the caller, so a `$1/$2` tournament
cannot reach the database for some later screen to render.

The entry fee is kept apart from the buy-in because that is how every tournament
is advertised (`$100+$10`), because players think in those terms, and because a
year of rake is worth being able to total. Both count as invested, so an ROI is
measured against what actually left the bankroll. A re-entry is a rebuy in the
same table, labeled differently on screen.

Since a tournament has no blinds, `Session.stakes` is nullable, and the currency
that used to live inside it now sits on the session where both formats can reach
it. A cash session whose blinds were never recorded (which an import can produce)
is null in exactly the same way, and each storage engine encodes that as it can:
IndexedDB stores null, and SQLite stores `0/0`, which is not a game anybody has
ever played.

### Win rate means two different things

The dashboard's **win rate** counts cash sessions only, and tournaments get a
**cashed** tile beside it. Pooling them produces a figure that moves with how
many tournaments somebody entered rather than with how they played: a tournament
entry ends with nothing most nights for everybody, so a cash player who wins
half their sessions and also fires ten tournaments used to read as a 17% winner,
under a label that sounds like a verdict. A tournament player cashing 22% is
doing well and a cash player winning 22% of sessions is not, and one number
cannot mean both.

Everything else on that row is money, and money is money whichever game it came
from, so hourly, best and worst still span both.

### Why there is no confidence band here

The variance page draws a Gaussian random walk in big blinds per hour. A
tournament has neither term: the blinds move every level, and the results are
not the roughly symmetric distribution that model assumes. A tournament player
loses their entry most nights and is carried by a handful of deep runs. Running
that through the cash model would produce a band that looks exactly as
authoritative as the real one and means nothing, which is worse than showing
nothing at all.

So the tournament card shows what can be said honestly:

- **ROI and cash rate** as descriptions of what happened. Below a hundred entries
  the copy says outright that this is a record rather than a measurement, because
  one final table moves the number a long way.
- **The dry run**, which is the one genuinely inferential number here, and it is
  honest because it needs no distribution at all. Whether an entry cashes is
  independent of the last one, so the chance of missing `n` in a row is
  `(1 - rate)^n`. Sixteen without a cash at a 20% rate is a 2.8% run: unusual,
  and not a sign anything has changed. That is the question a tournament player
  actually asks at two in the morning, and it usually has a calming answer.

### The interval that is honest, and what it costs to earn one

The bare ROI is still only a description, so there is a real interval around it
now, and it comes from the one method that assumes nothing about the shape of
the payouts: the **nonparametric bootstrap**. Draw `n` entries with replacement
from the `n` the player actually has, recompute ROI, do that two thousand times,
and take the middle 95% of the answers. `variance.ts` cannot touch tournaments
because its model needs results to be roughly symmetric; this one needs only the
results themselves, whatever shape they came in.

It is seeded from a fixed constant, so the same results always give the same
interval. That is not a detail: a confidence interval that shifted every time
the screen re-rendered would be correct on each render and untrustworthy across
all of them.

What it will not do is manufacture information, and the number it puts on that
is the most useful thing in this section. Take a genuine 5% ROI winner, paying
the way tournaments pay -- one entry in ten returning ten and a half times the
buy-in. The 95% interval on that player's ROI:

```
  1,000 entries   -15% to +25%   straddles break even
  5,000 entries    -4% to +14%   straddles break even
 15,000 entries     0% to +10%   straddles break even
 25,000 entries    +1% to  +9%   clears break even
```

Around **fifteen thousand entries** before a real 5% edge separates from zero.
That is not a flaw in the method; it is what tournament variance actually costs,
and it is why the copy on this card spends its time explaining that a straddling
range is a fact about tournaments rather than a verdict on the player. A test
asserts it at 50, 5,000 and 25,000 entries.

`roiConcentration` says the rest out loud: how much of everything that came back
arrived in one score, and what the same entries read without it. The demo set,
twelve entries carried by one deep run, reports a range of -100% to +495% and
then explains that one score is 75% of the returns and the other eleven entries
read -44%. Both numbers are true, and neither is any use without the other.

---

## Importing an online history

Log is built for the felt, but plenty of people play both. An online player's
history already exists in a file -- a PokerTracker or Holdem Manager session
report, a PokerCraft export, a spreadsheet kept by hand for years -- and
**Settings → Import sessions** reads it. On the web there is a file picker; on
device you paste the rows in. Nothing is uploaded: the file is parsed in the app
and written to the same local database as everything else.

### What it reads

One row per session, with a header row. It needs a date column and either a
result column or a buy-in and a cash-out; stakes, site, game, duration and notes
are used when they are there. Column names are matched against the spellings
these files actually use -- `Date`, `Total Buyin`, `Net Won`, `P/L`, `Limit`,
`Site` -- and the screen shows exactly which column it took for which field before
anything is written.

The awkward parts of other people's files are handled rather than assumed:
quoted fields with commas in them, tabs and semicolons, CRLF and byte-order
marks, `1.234,56` as well as `1,234.56`, and `(52.50)` for a negative. Day-first
and month-first dates are told apart by scanning the whole column for a day past
the twelfth -- and when a file never proves it either way, the screen says so and
offers a toggle instead of picking silently.

Tournaments come in through the same door. A row is read as one when the file
says so (`Tournament`, `MTT`, `SNG`, `Sit & Go`) or when it carries something
only a tournament has: an entry fee, a field size, a finishing position. `Prize`
reads as the cash-out, and `Format` is matched to cash-or-tournament while the
variant stays on `Game`.

**It does not read hand histories.** A hand history is an action-level record of
one hand; Log's `Hand` is a journal entry *about* a hand -- hole cards, position,
a note, a tag. There is nothing to import one into. Session summaries are the
level the two products genuinely share.

### What it will not invent

A row with no stakes gets zero blinds, not a plausible-looking `$1/$2`; a row
with no duration ends when it started. Both degrade honestly rather than
silently: `toObservations` already drops sessions with no measurable duration or
no big blind, so they count toward profit and the bankroll curve and stay out of
a win-rate estimate they would poison -- and the import warns, in those words,
before you press the button.

Every imported session is complete by construction: `cashOut` and `endedAt` are
never null. A null `endedAt` is what Log calls the *active* session and it allows
exactly one, so 200 rows that each claimed to be live would break the app rather
than fill it. A contract test asserts it on both storage engines.

### Running it twice

Each imported session stores an `importKey` derived from the row it came from,
under a unique index. Re-import next month's export and the three new sessions
land while the rest are skipped -- the screen says how many. Delete a session and
its row becomes importable again. That matters more than it sounds: a doubled
bankroll is a failure nobody notices until it has compounded for months.

---

## Post-MVP roadmap

Ordered roughly by how much each is worth against how much it costs.

1. **CSV export** -- the data model is already designed for it: every record is
   timestamped, money is integer cents, and hands are in a portable notation.
   Wants a share sheet on native and a download on web.
2. **Cloud sync and auth** -- the reason every record carries a client-generated
   id and an `updatedAt`. It was going to be the one feature the family pass
   added to this app, and it is free instead.
   **Scoped in full in [SYNC.md](SYNC.md)**, which is worth reading before
   starting: three quarters of the server already exists in Untilt.
   **Phases 0, 1 and 2 have landed**; see
   [Cross-device history](#cross-device-history). Deletes are tombstones, the merge rules are written
   and tested, and `listChangedSince` is the seam the engine plugs into. See
   [Deletes are tombstones](#deletes-are-tombstones). **Phase 1's client half
   has landed too**, in `src/auth`; see
   [Signing in](#signing-in-and-what-it-is-for). **Phase 1 is done**, screen and
   all. What is left is the engine itself.
   A syncing repository wraps the existing one behind the same interface, and
   `src/data/index.ts` is the single place it gets composed in; no feature
   folder changes. Last-write-wins per record to start, with the timestamps
   already in place to do better later. The sign-in is the genuinely new part:
   anonymous ids do not merge across apps, so all three have to derive the same
   id for the same person, and Untilt's existing magic-link endpoint is what
   that is promoted from. **The free tier never goes behind it** -- Log stays
   usable forever by somebody who never types an email address.
3. **Online session support** -- [importing a session summary](#importing-an-online-history)
   and [tournaments](#tournaments) are the halves of this that already ship, and
   `sessions` has its `format` discriminator. What is left is multi-table
   sessions and hands per hour, which need the hourly-rate math to become
   per-table: wall-clock hours stop meaning one thing the moment four tables are
   open.
4. **Deep Untilt and TiltProof integration** -- the seams already exist in
   `src/features/family/hooks.ts`. Today they build a URL; next they hand off a
   real payload -- the flagged hand into a TiltProof drill, the rough stretch
   into the matching Untilt exercise -- and eventually share an account across
   the three apps. What the hand becomes on the far side of that link is
   written up in TiltProof's README; the seam from this side, and where the URL
   we emit today actually lands, is in
   [`design/tree-review.md`](design/tree-review.md).
5. **Bankroll goals** -- target roll, stop-loss and stop-win per session, and a
   move-up/move-down prompt driven by the variance model that is already here.

Also wanted, smaller: session photos of the chip stack,
Apple Health style weekly summaries, an Apple Watch companion for the timer, and
per-venue rake tracking.

---

## License

MIT
