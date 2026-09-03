# Cross-device history: what it takes

Scoping for roadmap items 2 and 3, written before any of it is built.

Log is free in its entirety and stays that way. Carrying a log from the phone to
the laptop is the one thing in this app that is ever paid for, it comes with
owning the other two apps, and the front door
[says so already](public/home.html). This document is what has to be true for
that sentence to become a feature.

It is a scope rather than a specification. Where a decision is made here it is
argued and can be overturned; where one is still open it is
[listed as open](#still-open).

---

## The short version

**Three quarters of the server already exists in Untilt**, which has a shipped
magic-link sign-in, a signed bearer token, a per-user bucket keyed by an HMAC of
the subject, a commutative merge library and tests around all of it. Log does not
need a backend designed. It needs that one promoted to serve three apps.

**The genuinely new work is in this repo, and most of it is deletes.** Nothing
here records that a row was deleted, so a merge cannot tell a session the other
device removed from a session it has not seen yet, and deleted sessions come
back. That is a schema migration and a change to what `delete*` means, and it is
the one piece that cannot be shortcut or deferred.

**Sync the deltas, not the bundle.** Untilt sends its whole state on every write
and caps the request at 1MB. Measured against this data model, five years of a
three-sessions-a-week player is **1.34MB** ([the arithmetic](#why-not-a-bundle)),
so the cap is reached by exactly the players the feature exists for, and every
mid-session rebuy would ship the entire history over card-room wifi.

**Identity is the prerequisite and it is not a cookie.** `log.poker`,
`untilt.poker` and `tiltproof.poker` are three registrable domains, and Log is
also native, where there is no cookie jar at all. The token Untilt already
issues works unchanged as a bearer credential; the sign-in flow Log needs is the
**code**, not the link, and Untilt built that one for its own installed-app
problem two shipping cycles ago.

**None of it goes in front of the free app.** `getRepository()` returns the
local repository exactly as it does today, and the syncing wrapper is composed
in only when a token exists. Somebody who never types an email address keeps the
whole app, forever.

---

## What already exists

Worth stating plainly, because it is most of the system and none of it is in the
estimate below.

| | Where | State |
|---|---|---|
| Client-generated ids on every record | `src/data/support.ts` | `crypto.randomUUID`, so two devices cannot collide |
| `createdAt` and `updatedAt` on every row | `src/data/sql/schema.ts`, `src/data/dexie/db.ts` | Present on all five tables, both engines |
| One storage contract, two implementations | `src/data/repository.ts` | Nothing above it knows which engine it is on |
| One composition point | `src/data/index.ts` | `getRepository()`, and `setRepository()` for swapping |
| A conformance suite over both engines | `src/data/__tests__/repositoryContract.ts` | 154 tests, real SQLite and real IndexedDB |
| Magic-link sign-in, no user table | Untilt `netlify/edge-functions/signin.js` | Shipped |
| A signed bearer token | Untilt `lib/access.js` | `<expiry>.<tier>.<subject>.<signature>`, HMAC |
| A per-user bucket, keyed by HMAC of the subject | Untilt `netlify/edge-functions/sync.js` | Shipped. The store never holds a customer id |
| A commutative merge | Untilt `lib/merge.js` | Union for logs, last-write-wins for anything removable |
| Rate limiting, body caps, security headers | Untilt `lib/limiter.js`, `lib/page.js` | Shipped |

The last six are the reason this is a feature rather than a project. The one
architectural idea in Untilt's merge is also the one this needs: **a thing that
can be removed is not an id in a list, it is an id with a state and the moment
it was last set.** Un-favoriting a meditation and deleting a session are the same
problem, and it is already solved once.

---

## The four things that are new

### 1. Deletes, which is the real work

`deleteSession` removes the row and cascades to its rebuys, hands and mood
entries. Locally that is correct and it is what anybody would write. Across two
devices it is unrecoverable: a row that is absent because it was deleted and a
row that is absent because this device has not heard of it yet are the same
absence, and any merge that unions rows will resurrect the first kind. A player
who deletes a mis-entered session on the phone watches it reappear on the
laptop, and then watches their bankroll curve disagree with itself.

**Every table gets `deleted_at`, and `delete*` writes a tombstone instead of
removing the row.** Migration v3 on SQLite. On Dexie it turned out to need no
migration at all: IndexedDB stores whole objects, so an unindexed property needs
no version bump and a record written by an earlier build simply has no
`deletedAt` and reads as live. Consequences worth naming before they are
discovered:

- **Every read has to exclude tombstones.** That is a `WHERE deleted_at IS NULL`
  in `SqlRepository` and a filter in `DexieRepository`, on every list and get.
  The conformance suite is where that gets proved rather than remembered.
- **The cascade becomes a cascade of tombstones**, not of removals, and it has
  to stamp the same moment on every child so a later merge cannot revive a hand
  whose session is gone.
- **Tombstones are not kept forever.** A row tombstoned longer than any device
  could plausibly have been offline can be collected for real. Ninety days is
  the usual answer and it is the one to take, with the collection running
  locally rather than server-side so an app that never syncs still stays small.
- **`clearAll` is not a delete.** The settings reset and the dev seeder wipe the
  local database, and if that wrote tombstones it would push a wipe to every
  other device. It stays a local truncate, and a device that has been cleared
  re-pulls from the server as if it were new. **That is a decision worth being
  deliberate about**: it means "reset this app" cannot be used to mean "delete my
  history everywhere", so erasure needs its own control, which is the DELETE
  Untilt's sync endpoint already implements.

This phase touches no network code and ships dark. It is also where the risk is,
which is the argument for doing it first and alone.

### 2. Three constraints that break under a merge

Each of these is a rule the local database enforces correctly today and that a
second device can violate without either device being wrong.

**One active session.** `getActiveSession()` reads
`WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`. Two devices each
start a session, they merge, and there are now two live sessions with nothing
erroring: the app simply picks the newer and the older one becomes a row that is
invisible and permanently open. The merge needs a rule and the player needs to
be told. **Keep the session with the later `startedAt`; end the other at the
last activity recorded against it** (its final rebuy, hand or mood entry, else
its start) **and flag it for review rather than silently cashing it out at zero.**
A session that was ended by a merge is a thing the player has to be able to see
and fix, because only they know what was in front of them.

**`importKey` is UNIQUE on both engines.** Import the same session-summary CSV
on the laptop and on the phone before either has synced, and both rows are
legitimate locally and collide on merge. The unique index makes that an error
rather than a duplicate, which is the right failure but the wrong outcome. The
key is derived from the source row, so **two rows with the same import key are
the same session: keep the one with the earlier `createdAt`, tombstone the
other, and move any hands or mood entries** attached to the loser across. Doing
nothing here means the first import after a merge fails with a constraint error
the player cannot act on.

**Venues are referenced, not cascaded.** `sessions.venue_id` has a foreign key
and `deleteVenue` refuses while any session references it. A session arriving
from another device can name a venue this device has never seen, so **venues
merge first and sessions second**, and a venue tombstone never wins over a live
session that references it. With `PRAGMA foreign_keys = ON`, getting this order
wrong is an insert that throws mid-merge.

### 3. Identity across three registrable domains

Cookies cannot cross `log.poker`, `untilt.poker` and `tiltproof.poker`, and on
iOS and Android there is no cookie at all. Everything needed to get around that
is already built:

- **The token is a bearer string, not a cookie.**
  `<expiry>.<tier>.<subject>.<signature>`, HMAC-signed with `GATE_SECRET`.
  Anything holding that secret can verify it, which is what lets a second app
  accept a credential a first app issued.
- **Log uses the code flow and never the link flow.** Untilt learned this the
  hard way: mail opens links in the browser, an installed app keeps its own
  cookie jar, so a customer who tapped the link got signed in to Safari and came
  back to an app as signed out as they left it. `/api/signin/code` is the same
  credential in a shape that can be typed into whatever is holding it. A native
  app has exactly that problem and no way around it.
- **The subject is stable and opaque**, and the bucket is an HMAC of it, so the
  store never holds a customer id.

What Log adds is storage for the token: `expo-secure-store` on native,
`localStorage` on web, and a sign-out that clears it. Roughly a day, and the
harder half of the phase is in Untilt's repo rather than this one, promoting one
endpoint to answer for three apps.

**One thing to get right early.** Untilt's sync refuses the subject `passcode`
by name, because every passcode holder shares it and syncing them would pour
every preview visitor's history into one bucket. Log inherits that refusal and
must inherit it explicitly rather than by luck.

### 4. The entitlement

One non-consumable, `log_plus`, checked at the store layer. Log's offering sells
the family pass alone, because Log has nothing to sell by itself, and Log checks
only its own entitlement: which SKU paid for it is a fact about billing that no
screen needs to know.

Two details that are easy to miss:

- **Holding both single-app entitlements has to grant `log_plus`**, or *own the
  other two and your history follows you* is false in a corner. Nobody buys two
  singles when the pass costs less, but the page makes the promise unqualified.
- **RevenueCat is not a prerequisite.** The token Untilt issues already carries a
  tier, so Log can gate sync on that from day one and have RevenueCat replace the
  check later. That takes an entire third-party integration off the critical
  path of shipping the feature, and it is the single biggest de-risking move
  available here.

---

## The shape of the sync

### Why not a bundle

Untilt sends its whole state on every write, merges server-side and caps the
request at 1MB. For favorites and a check-in log that is right and simple.
Against this data model it is neither. Measured from the record shapes in
`src/data/dexie/db.ts`, serialized as they would go over the wire:

```
session  362 bytes    hand  315 bytes    mood  193 bytes    rebuy  182 bytes

Three sessions a week for five years, with three hands, two mood
check-ins and a rebuy or so logged against each:

  780 sessions                                        1.34 MB
  the same player at ten years                        2.68 MB
```

So the request cap is met by exactly the player the feature is for: the one with
years of history and two devices. Raising the cap is one line and does not fix
the real cost, which is that a rebuy tapped at a table on one bar of signal would
ship five years of history to record 200 dollars.

### What to build instead

**Delta on the wire, bundle at rest.** The server keeps the same per-user object
Untilt's sync keeps, in the same store, keyed the same way. What changes is the
conversation:

```
GET  /api/log/sync?since=<cursor>    rows with updatedAt > cursor, plus tombstones
PUT  /api/log/sync                   only rows this device changed since it last pushed
```

- **The cursor is `updatedAt`**, which every row already carries. No new column,
  no vector clocks, no sequence numbers to keep in step across devices.
- **Per-record last-write-wins, ties broken by id.** Commutative and idempotent
  for the same reason Untilt's merge is: merging A into B gives what merging B
  into A gives, and merging twice changes nothing. The three special cases in
  [section 2](#2-three-constraints-that-break-under-a-merge) are the exceptions,
  and they are exceptions because they are constraints rather than fields.
- **First sync on a new device pulls everything once**, which is the cold start
  and is fine.
- **Clock skew is the one thing `updatedAt` cannot police.** A device with a
  wrong clock stamps rows in the future and wins every merge until real time
  catches up. The server already sees a trustworthy clock, so it clamps a
  pushed `updatedAt` to its own now plus a small allowance, exactly as Untilt's
  merge already clamps stamps arriving from a browser.

### Where it is composed

`src/data/index.ts`, and nowhere else:

```ts
const local = await createRepository();
const token = await readToken();
return token === null ? local : new SyncingRepository(local, token);
```

`SyncingRepository` satisfies `Repository`, delegates every read and write to the
local one, returns before the network is touched, and pushes in the background.
**No feature folder changes. No screen learns that sync exists.** The offline
guarantee is preserved by construction rather than by care: the app is talking to
the same local database it always was.

The one place it becomes visible is Settings, which needs to say when it last
synced and how many changes are waiting, because a sync that fails silently is
worse than no sync.

---

## Build order

Each phase is independently shippable and independently verifiable, and the
order is chosen so that the riskiest work is done before anything depends on it.

| | Phase | Ships | Roughly |
|---|---|---|---|
| **0** | Tombstones, the three merge rules, contract tests. No network. | **Built.** See below | 3 to 5 days |
| **1** | Identity: promote Untilt's sign-in, token storage, gate on the tier it already carries | Sign-in that unlocks nothing yet | 3 to 4 days, most of it in Untilt |
| **2** | `SyncingRepository`, the endpoint, cursors, backoff, Settings state | The feature | 5 to 8 days |
| **3** | RevenueCat `log_plus`, the offering, the both-singles rule, store review | The purchase | 3 to 5 days |

### What phase 0 actually landed

Migration v3 adds `deleted_at` to all five tables; the Dexie side needs no
migration at all, because IndexedDB stores whole objects and a record written by
an earlier build simply has no property and reads as live. Every read in both
repositories filters tombstones, `delete*` writes them, children take the
parent's stamp, and tombstoning a session clears its `importKey` so that a
deleted import stays re-importable. `clearAll` remains a truncate.

`listChangedSince(cursor)` was added to the `Repository` interface. It was not
in the plan above, and it is here for one reason: tombstones are otherwise
unobservable through the interface, so nothing could test them. It is also the
read phase 2 needs, so it is early rather than speculative.

`src/domain/merge.ts` holds the rules as pure functions, tested for the property
that matters most: **the answer cannot depend on which device the merge looked
at first.** 28 tests there, 22 more in the conformance suite across both
engines, and 7 on the migration itself, which is the half of a schema change the
conformance suite cannot see: it starts from an empty database at the latest
version and so says nothing about a player with three years of history
installing an update.

**Two things named above are deliberately not built.** Tombstone collection: the
ninety-day sweep does not exist, so tombstones accumulate and a heavy deleter's
database grows where it used to shrink. And the clock clamp is written and
tested but applied nowhere, because nothing yet receives a stamp from another
device. Both belong to phase 2 and neither is load bearing until something
syncs.

Phase 0 dominates the risk and phase 2 dominates the hours. Phases 0 and 1 have
no dependency on each other and can be built in either order or at once.

The estimate assumes the merge rules survive contact with the conformance suite,
which is where a rule that reads well tends to stop being one. If any of the
three turns out to need a schema change beyond `deleted_at`, phase 0 grows and
nothing else does.

---

## What must not break

These are the promises already in the product, and each one has a way of dying
quietly during work like this.

- **The free app never goes behind the sign-in.** Log stays completely usable by
  somebody who never types an email address. RevenueCat makes an account feel
  like the natural first screen, and it is not one here.
- **The app never blocks on the network.** Every write commits locally and
  returns; the push happens after. A card room has no wifi and that is the
  normal case, not the degraded one.
- **CSV export stays free.** It is the player's own data, and charging to get it
  out is the one move that would make the free tier read as a trap.
- **The front door's copy stops being true the day this ships.** *Log has no
  server to send anything to* is on `public/home.html` today and is correct
  today. When sync exists the claim becomes *nothing leaves your device unless
  you turn this on*, which is a different sentence and needs writing rather than
  patching. The tests in `src/site/__tests__` pin the current wording, so they
  will fail and act as the reminder.
- **Erasure has to exist and has to be its own control.** Untilt's sync endpoint
  already implements DELETE behind one check fewer than a write, on the argument
  that a refunded purchase does not make the history behind it less yours to
  remove. Log inherits that argument.

---

## Still open

1. **Does Untilt's Stripe stay the processor while RevenueCat takes native, or
   does everything move?** FAMILY-PRICING.md argues for one RevenueCat project
   holding all three with Stripe underneath for web. The answer changes phase 3
   and nothing before it.
2. **Does the first release sync Log only, or is the shared account across all
   three apps a launch requirement?** Log-only is smaller and can use the same
   token without the App User ID work landing anywhere else.
3. **Netlify Blobs, or a real database?** The bundle-at-rest shape fits Blobs and
   keeps the family on one piece of infrastructure. A player with ten years of
   history and a device that has been offline for a month is the case that would
   argue otherwise, and it is not a case anybody has yet.
4. **How much of the merge is server-side?** This document puts per-record
   last-write-wins on the server, next to the store, so a device that has been
   away does not have to be trusted to resolve. Client-side is also defensible
   and would keep the endpoint a dumb blob store.

---

## Where the numbers came from

The record sizes are `JSON.stringify` of the record shapes in
`src/data/dexie/db.ts`, filled with representative values: a 1/3 no-limit session
with a note, a hand with hole cards, a position, two tags and a sentence of note,
a mood check-in, and a rebuy. The session count is three sessions a week, which
is a serious recreational player rather than a professional; a professional is
worse for the bundle argument, not better.
