# Cross-device history: what it takes

Scoping for roadmap item 2, written before any of it was built.

Log is free in its entirety and stays that way, and that now includes carrying a
log from the phone to the laptop. It was going to be the one paid thing in this
app. It is not one, the front door [says so already](public/home.html), and this
document is what has to be true for that sentence to become a feature.

**That change is newer than most of what follows.** Where a paragraph below
still reads as though sync were sold, it has been corrected in place rather than
deleted, because the argument for charging was a good one and the reason it lost
is worth keeping: every tracker worth using syncs for free, so the one paid thing
in this app would also have been the one thing a player could get elsewhere for
nothing.

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
removing the row.** A numbered migration on SQLite. On Dexie it turned out to
need no version at all: IndexedDB stores whole objects, so an unindexed property
needs no bump and a record written by an earlier build simply has no
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
harder half of the phase was in Untilt's repo rather than this one, promoting
one endpoint to answer for three apps.

**That is no longer where the door is.** Untilt's sign-in still answers the
three apps and still mints for paying customers; Log mints its own free-tier
tokens on its own host, because sync stopped being sold and a door only buyers
can open stopped being the right one. See
[what the free door landed](#what-the-free-door-landed).

**One thing to get right early.** Untilt's sync refuses the subject `passcode`
by name, because every passcode holder shares it and syncing them would pour
every preview visitor's history into one bucket. Log inherits that refusal and
must inherit it explicitly rather than by luck.

#### The token lasts thirty days, and now something renews it

Checked against Untilt's `lib/access.js` as deployed. The two implementations of
the format agree field for field -- four parts, the same expiry pattern, the
same tiers, the same subject pattern, HMAC-SHA256 over the first three joined by
dots, base64url unpadded -- and Log converts the expiry from seconds to
milliseconds at the boundary, which is the one place the two would silently
disagree if anybody moved it. Log will accept exactly the tokens Untilt mints.

For thirty days. `COOKIE_MAX_AGE` is thirty days, `issueToken` stamps the expiry
from it, and **there is no renewal path a bearer holder can use.**

Untilt renews its own holders on every app open: `library.js` reads the aging
cookie, asks Stripe what that customer is owed today, and slides the expiry.
Its comment says why it exists, and the sentence is worth quoting because Log is
now in the state it describes: *"A cookie lasts thirty days and used to be
renewed never, which signed every paying customer out monthly -- and the first
thing the app showed them next was the paywall, asking for money they had
already paid."*

None of that reaches Log. `library.js` reads the token with `readCookie` and
returns it with `Set-Cookie`, and the cookie is `__Host-` prefixed, so it is
scoped to Untilt's own origin with no `Domain` and a native app has no jar for
it at all. That is not an oversight in `library.js`; it is the whole reason Log
was given a bearer token in the first place.

So on day thirty, on a device that has been syncing happily: `readClaim` returns
null, `SessionManager.current()` **clears the stored token**, `getSession()`
answers null, and `compose()` hands back the plain local repository. No wrapper
is constructed, so there is no 401, no `problem` in the sync state, and nothing
in Settings but the sign-in form quietly back where it was. Cross-device history
stops, and the app gives no account of itself. The device also resumes sweeping
its own tombstones on the local window, because that branch is the one it now
takes.

That was the state until Log started minting its own tokens, at which point the
fix stopped being in somebody else's repository. `POST /api/signin/renew` takes
`Authorization: Bearer <token>`, verifies it, and answers `{ token }` with a
fresh thirty days on the same subject. `compose()` asks for one at launch, not
awaited, whenever the token it holds is inside its last ten days, which is the
window `library.js` already uses.

**It will not renew a paid claim.** Log mints the free tier and has no way to
find out whether anybody has bought, so a `full` token is refused with a 403 and
goes on working until its own expiry. Renewing one here would be a way to hold a
paid claim alive forever without the Stripe check that grants it, and
downgrading one to free would quietly take away access the holder still has in
Untilt. Neither is Log's to do.

**It will not renew an expired one**, which is what stops the thirty days from
being decorative, and the client will not even ask: a renewal that resurrected a
dead credential would mean the expiry never meant anything.

**And it needs no store.** A signature check and a mint, both pure, so a renewal
still lands on a day Netlify Blobs does not. It also does not spend the caller
limit, which exists to bound mail: charging launches against it would let a few
devices behind one office network refuse a colleague's sign-in.

**And it must not put a token back that somebody has just put down.** Renewal
is the one operation on `SessionManager` with a network round trip in the
middle, and it runs at launch without being awaited, so the seconds it spends
out there are seconds somebody can spend signing out or erasing. Writing
afterwards signed the device silently back in, with a fresh thirty days, and
after an erase into a bucket that had just been deleted. A generation counter
fences it, bumped at the *start* of a sign-out rather than the end: a
comparison against the stored token would still see the old one sitting there
while the clear was in the keychain's hands, and write over the top of somebody
leaving.

The one property the client half is written around is that **every way of
failing leaves the token alone**. A refusal, a dead network, an answer that is
not a token, a store that will not write: in all of them what was there is still
there, still valid, and still renewable on the next launch. There are ten days
of window and every launch is another try. Clearing a working credential because
a request failed is the shape of every "signed me out for no reason" bug there
is, and `renewIfDue` is the one place that could do it.

### 4. The entitlement, which there is not one of

This section was a plan for selling cross-device history: one non-consumable,
`log_plus`, checked at the store layer, granted by the family pass and by holding
both single-app entitlements. None of it is being built, and what replaced it is
an absence worth writing down so that nobody rebuilds it by habit.

**Two functions decide who syncs, and they ask the same question.**
`hasOwnSubject` in `src/auth/token.ts` for what to show, `hasOwnBucket` in
`src/sync/verify.ts` for what to allow. Both ask only whether the token names a
person rather than a shared passcode. Neither reads `claim.tier`, the endpoint
has no paid line, and the DELETE path is no longer one check below a write
because there is no check for it to sit below.

Three things fall out, and the third is the one with work attached.

- **RevenueCat leaves the critical path entirely** rather than being deferred to
  a later phase. It was already not a prerequisite, since the token carries a
  tier that could have been gated on in the interim. Now there is no gate in
  either place for it to replace.
- **The tier is still parsed and is read by nothing.** The grammar belongs to
  Untilt's `lib/access.js` and is not ours to trim, so the field stays in the
  parse and is asserted to decide nothing: the token suite walks every value in
  `TIERS` and expects the same answer from each.
- **The sign-in is now the only paid door left in the way, and it is in another
  repository.** Removing Log's gate does not by itself let a free player sync,
  because they cannot get a token at all. That is [the open
  question](#still-open) and it is the one thing between the front door's promise
  and the shipped feature.

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
| **1** | Identity: promote Untilt's sign-in, token storage. The tier gate it shipped with is since gone | **Done and on** | 3 to 4 days, most of it in Untilt |
| **2** | `SyncingRepository`, the endpoint, cursors, backoff, Settings state | **Built.** Waiting on one env var | 5 to 8 days |
| **3** | Was RevenueCat, `log_plus`, the offering and store review. **Cut**: nothing here is sold | Nothing | none |

### What phase 0 actually landed

A numbered migration adds `deleted_at` to all five tables; the Dexie side needs
none, because IndexedDB stores whole objects and a record written by an earlier
build simply has no property and reads as live. Every read in both
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

### What phase 1 landed, and the one thing blocking the rest

`src/auth` holds the whole client half: the token grammar, what a claim is
worth, a `SessionManager` over a three-method `TokenStore`, and the two
adapters that implement it, the keychain on device and `localStorage` on the
web. 48 tests, and the token ones mint genuinely HMAC-signed fixtures rather
than typing strings out, because the format belongs to another repository and a
hand-typed fixture only proves the parser agrees with whoever typed it.

One bug worth recording, because it is the shape of bug a contract across two
repositories produces: the client did not send `Accept: application/json`, which
is the one header the server keys on. Nothing would have errored. Every call
would have come back 200 carrying a page, and the client would have read it as a
success with no token in it.

**The server half is built too**, in Untilt rather than here. Its sign-in
answers a browser with a 303 carrying a `Set-Cookie`, and that cookie is
`__Host-` prefixed and `HttpOnly`: unreadable by script by design, unreachable
from another registrable domain by definition, and meaningless to a native app
with no browser cookie jar. So it now answers a caller that asks for JSON with
the token in the body instead:

```
POST /api/signin        { email }         -> 202, no body
POST /api/signin/code   { email, code }   -> 200 { token }
                                             400 { error }
                                             429 { error }
```

Both take `Accept: application/json`, which is the whole of what separates the
two shapes; without it the same request is answered exactly as it always was.
Nothing about how a token is minted, signed, checked or spent moves: the same
nonce, the same Stripe lookup, the same tier read now rather than trusted from
the mail, the same limiter, and the same deliberate refusal to say which of
several things went wrong. The 202 is that refusal in the send path: it answers
the same whether or not Stripe has heard of the address, because an endpoint
that says *no customer* tells a stranger who bought.

Three things hold the cross-origin side in place, each with a test over there:
an allowlist of two exact origins rather than a pattern, since a pattern for
`*.poker` is a pattern for a domain somebody else can register; no
`Access-Control-Allow-Credentials` and no `Set-Cookie` on the JSON answer, so
the two ways of taking delivery cannot both be half-live at once; and the
allowlist scoped to the two endpoints the apps use. Nothing newly reachable
came with it, because those endpoints already answered a caller with no
`Origin` at all, which is what has always let a native app in.

**The screen is built**, in `src/features/account`, and phase 1 is done. Two
steps, an address then the code mailed to it, and never the link, for the
reason Untilt already found: mail opens links in the browser, so somebody
tapping one on a phone is signed in to Safari and comes back to an app as
signed out as they left it.

The copy carries the rule the endpoint is built around, at the last place it
can die. `/api/signin` answers the same whether or not Stripe has heard of the
address, on purpose, and a screen saying *check your inbox* throws that away on
the client where nobody reviewing the server would see it. So the confirmation
is conditional, the code refusal never guesses why, and both are asserted.

**It was behind `ALLOW_SIGN_IN`, which was `__DEV__`.** Signing in unlocked
nothing until there was something to sync to, and somebody who typed an
address, waited for mail and read a code off a phone would have arrived back at
a screen that looked exactly as it did before. That is worse than an absence.
The constant is `true` now; see [what turning it on took](#what-turning-it-on-took).

What it buys meanwhile is the thing nothing else could do: the chain runs end to
end in a browser. Ask, redeem, hold, reload, sign out; both requests carrying
`Accept: application/json`; the token parsed from a genuinely signed fixture and
still held after a reload, which is the `localStorage` adapter doing its job.
Two halves tested against fakes and joined by a written contract is exactly the
arrangement that hides a bug from both sides, and it had already hidden one.

Two things worth carrying forward from building it. The token counts its expiry
in **seconds** where everything in Log counts milliseconds, which is a factor of
a thousand and therefore about fifty years if it goes unnoticed; it is converted
at the boundary and tested there. And the client **cannot verify a signature**,
because that needs the gate secret and a secret shipped inside a downloadable
app is not one: a claim read on this side decides what to show and what is worth
sending, never what is allowed, and the server re-derives on every request.

### The bug that was in this for four merges

`applyChanges` wrote with `INSERT OR REPLACE`. SQLite spells REPLACE as a DELETE
followed by an INSERT, and that delete fires `ON DELETE CASCADE`. So the most
ordinary thing sync does -- receiving a session somebody edited on another
device -- **hard-deleted every hand, rebuy and mood entry under it** on the
native engine. Not tombstoned. Removed, and below the sync cursor, so nothing
ever brought them back. Edit a session's notes on a laptop and the phone
discards the hands logged at the table.

It is now `ON CONFLICT(id) DO UPDATE`, which leaves the row in place and writes
over its columns, so no delete happens and no cascade fires. The same trap
applied to venues, where the cascade is absent but the foreign key is not.

Two things are worth keeping from how it was missed. **Every test applied a
session in the same delta as its children** -- a fresh insert, never an update
over children that were already there -- so the whole suite, including the
two-device one written to ask a player's question, walked straight past it. And
removing REPLACE turned a *second* latent bug visible: an incoming session whose
import key a different local row still holds was being silently annihilated by
the REPLACE, and would then have thrown instead. The stale key is now released
before the insert, because the server has already decided who owns it.

### What phase 2 landed

**The endpoint is on Log, not on the host that mints the token.** The web app is
served from `log.poker/app` and this answers on `log.poker`, which is one
origin, so unlike the family sign-in there is nothing to allowlist and no
preflight to answer. Native sends no `Origin` at all. Deciding to make it
cross-origin later should be a decision rather than a discovery.

`netlify/functions/sync.mts` is the thin part: a token, a blob, the merge, the
blob back. It is TypeScript rather than the `.mjs` the scan counter is written
in, precisely so it can import `src/sync/bundle.ts`. **Two implementations of a
merge is two merges that disagree in a year.**

The bundle is one object per person in Netlify Blobs, keyed by an HMAC of the
subject so the store never holds a customer id, and the wire carries deltas
against it. The cursor is `updatedAt` and the comparison is `>=`, which costs
one millisecond of re-sent records per sync and closes a hole that would
otherwise lose a record roughly once a year, unreproducibly.

**Two bugs came out of the two-device test and neither would have come out of
anything else.** A write that landed while a push was in flight was never sent,
because joining an in-flight run is not the same as being sent by it. And one
cursor cannot do both jobs: the server's cursor moves past stamps this device
wrote and never sent, so `pulled` and `pushed` are now two numbers and the
second is taken from the records actually sent rather than from a clock. Both
were silent, both lost data, and both were found by asking the question a player
would ask rather than the question a unit test asks.

**What was left was an environment variable**, and it is set. `GATE_SECRET` on
Log's Netlify site, the same value Untilt signs with. Until it was, the endpoint
answered 503 to everything.

There is no code to write for the variable itself: `netlify/functions/sync.mts`
reads it and hands it down, and nothing else in the repository looks for it.
The one code change is `ALLOW_SIGN_IN` in `src/config.ts`, which is a
build-time constant so that the sign-in card is stripped from a production
bundle rather than merely hidden, and a test asserts its current value so it
cannot flip by accident.

Two things about the value. It has to be **byte for byte** what Untilt signs
with, because the signature is re-derived rather than looked up; a key that is
merely close answers 401 to everybody, forever, and that looks exactly like
nobody having signed in. The endpoint writes the reason to the deploy log for
that case, `signature` where the key is wrong and `expired` where it is not,
never into the answer, which stays the 401 a stranger should get.

And it is effectively **write once**. Bucket names are an HMAC of the subject
under the same key, so changing it later does not rotate anything: it orphans
every bucket that exists, and the history in them is no longer reachable from
any token.

**`npm run check:gate` asks the endpoint whether it worked**, which is worth
doing before `ALLOW_SIGN_IN` flips rather than after, because after the flip a
wrong key is a dead form in front of real people. It prompts for the key with
the echo off, mints a token for the subject `gatecheck`, sends an empty push,
and says in plain words what came back. On a 200 it erases the bucket it just
made. On anything else it says which of the reasons it was.

That answers half the question. Minting proves the key stored on the site is
byte for byte the key you typed, which rules out paste damage and nothing else.
The half that matters is whether the key is *Untilt's*, because the two apps
agreeing is the whole feature, and only a token Untilt signed can answer it.

`npm run check:gate -- --signin <address>` gets one, the same way the app will:
it asks Untilt to mail a code, takes the code, trades it for a token, and
pushes that at Log. Two endpoints and no browser, which beats reading
`localStorage` out of a dev build. `--token` takes one you already have.
Nothing is ever erased in either of those modes: the token names a person, and
their history is not a check's to tidy away.

### What the free door landed

Making sync free in this repository did not make it free. Removing the tier
check let a free token sync; it did not let a free player get a token, because
the family's only sign-in belongs to Untilt and that one asks Stripe first. So
Log has its own now, and this is what came out of writing it.

`netlify/functions/signin.mts` answers `/api/signin` and `/api/signin/code` on
`log.poker`, the same two paths with the same bodies and the same statuses, so
`src/auth/signin.ts` did not change shape and neither did the screen above it.
One constant moved. **Untilt's endpoint is untouched**, which was the point of
choosing this over the other two ways out: the abuse surface lands on the app
that wanted it.

**Minting lives in `src/sync/verify.ts`, next to the check it has to agree
with.** That file was named for verifying and is now the one place that holds
the key, which is the property worth keeping. Two files each knowing half of a
signature format are two files that disagree in a year, and the failure is a
token this family mints and then refuses.

**There is still no user table.** The subject on a token is an HMAC of the
normalized address, so the same person always gets the same log back without
anything having remembered them, and the record for a pending code is keyed by
another HMAC of the same address and holds an HMAC of the code. A store that
leaked would say how many people have signed in and nothing about who or how to
become them. Normalizing is not cosmetic: Untilt keeps the spelling somebody
typed because Stripe's customer filter is case-sensitive, and nothing here
looks anybody up, so `Player@Example.com` reaching a different history than
`player@example.com` would be a second empty log with nothing on screen to
explain it.

**The disclosure argument survives, wearing a different hat.** Untilt answers
202 whether or not it has heard of an address, because an endpoint that says
*no customer* is a way to ask who has bought. Here anybody may sign in, so
there is nothing to disclose, and the 202 stays anyway: the cooldown and the
daily cap would otherwise answer differently for an address somebody had been
mailing. The copy on the screen named a purchase and no longer does, which is
the one place that property could have died quietly.

**What the free door costs is mail somebody did not ask for**, and it is
bounded rather than argued away. One mail a minute and five a day to any one
address, twenty requests an hour from any one caller, both counted before
anything is generated or sent. A code is six digits, single use, good for
fifteen minutes, and dies rather than merely failing after five wrong guesses.
A send that fails takes its record back, because leaving it would spend one of
the day's five and start a cooldown for a mail nobody got, so the retry a
person makes straight away would be silently ignored.

**One thing the gate check no longer proves.** Log signs and verifies under the
same key, so a wrong `GATE_SECRET` that is wrong consistently passes an
end-to-end run against Log: everything agrees with itself. Pointing
`--signin-origin` at `https://untilt.poker` is what still asks whether the key
is *Untilt's*, and that is worth knowing even though nothing in Log depends on
it any more, because subjects and bucket names are HMACs under this key and
finding out later means orphaning every bucket.

**What was left was two environment variables**, and neither was code.
`GATE_SECRET` and `RESEND_API_KEY` on Log's Netlify site; without the first,
both endpoints answer 503 to everything. Both are set, and
[the chain has been run](#what-turning-it-on-took).

### What turning it on took

The flag is `true`. What retired the argument for keeping it dark was running
the chain against the live site rather than reasoning about it, and the run is
worth recording because three of its four answers were the wrong ones first and
each was informative.

**A 400 on the first ask**, because the address was a placeholder with no dot
after the `@`. Not a setback: the answer proved `netlify/functions/signin.mts`
was deployed and answering, since the headers were the ones `json()` sets and
the body was its literal `{"error":"rejected"}`, and it proved `GATE_SECRET`
was set, because the secret check runs first and would have answered 503 with
`off`.

**A 202 on the second**, which is the answer that proves the most. It comes
after the store write and after `mail()` returns true, so it says the blob
store accepted the pending record and Resend accepted the message, which in
turn says the API key is valid and `signin@log.poker` is on a verified domain,
because Resend refuses an unverified From.

**A 401 at the sync**, from a token that was still the placeholder text. Also
useful: it proved `/api/sync` was deployed and refusing what it cannot verify.

**Then a 200**, with a valid empty pull and a token reading
`<expiry>.free.log_<32 hex>.<signature>`. The tier is `free` because
`mintToken` hardcodes it, the subject carries `SUBJECT_PREFIX` because
`subjectForEmail` derived it from an address that has bought nothing, and the
signature verified under the same `GATE_SECRET` at the other endpoint. **A free
player, holding no purchase anywhere in the family, synced.** That is the thing
that was not possible while sync was sold.

**The flag stays, and is now a kill switch rather than a curtain.**
`/api/signin` mails a code to anybody who types an address, which is the point
of the free door and also the whole risk in it. Setting the constant to `false`
strips the card from the next build; the endpoint's own limits, one mail a
minute and five a day per address, hold in the meantime. A test pins the
current value either way, so it cannot move by accident.

### And the store behind the free door collects too

`/api/signin` writes one small record per address it has ever mailed and one per
caller it has ever counted, and for its first weeks it wrote them forever.
Neither record grows, because a second mail to the same address overwrites the
first, so the size of that store is the number of addresses ever typed into the
form rather than the number of times they were. That is the benign reading, and
it is the wrong one to plan around: the form mails anybody, which is the point
of it, so a script pointed at the door for a week leaves a record for every
address it invented and none of them is ever coming back.

`netlify/functions/signin-sweep.mts` runs `@daily` around
`src/auth/signinSweep.ts`. **The rule is that a record is collectable exactly
when neither request path would read anything from it**, which is worth stating
that way rather than as arithmetic, because it is the version that survives
somebody changing the arithmetic. Every predicate the sweep decides on is
imported from `signinEndpoint.ts` rather than restated, so the two cannot drift
into disagreeing about what a live record is, and the suite proves the
equivalence by running the real endpoint against a swept store and one that
never held the record and asserting they cannot be told apart.

**This is the tombstone lesson below in miniature, and it took two conditions
rather than the obvious one.** Collecting an address record inside its window
hands back mail budget: `sent` and `windowStartedAt` are the whole of what holds
one address to five mails a day, so a sweep that took the record early would
mean anybody who wanted a stranger mailed more than five times only had to wait
for the nightly run. That much was clear from the start. What was not is that
the window rolling is not enough on its own: a code asked for at twenty-three
hours and fifty-nine minutes into a window is live for fifteen minutes *past*
the roll, so collecting on the window alone would kill a code somebody was at
that moment reading off their phone. Rare, silent, and indistinguishable from
typing it wrong. The rule is the later of the two horizons.

It needs less margin than the tombstone collection does, and for a reason worth
being explicit about rather than assuming: there is no second party holding
state that has to hear about the collection, so the horizon is exactly the last
moment either path would look, with nothing added for a device in a drawer.

Two smaller things. The sweep budgets twenty seconds against the platform's
thirty and **says in its log when it ran out of them**, because a run that
stopped halfway and a run with nothing left to do leave the same store behind. A
truncated run always stops at the same end of the key order, so a store larger
than one run could examine would sweep its head repeatedly and never reach its
tail; that is a real defect and not yet a real problem, and the fix when it
arrives is a stored cursor, which is why `finished` is reported rather than
inferred. And the function holds no key at all: it cannot mint, cannot verify,
and cannot tell whose record is whose, which is the least it can be trusted with
and therefore the right amount.

### Four ways the sweep was still wrong

The rule above was right and the implementation was not, which is exactly what
happened to the tombstone collection below and is why that section is worth
reading before writing anything that deletes. An adversarial audit ran nine
lenses over the merged file and mutated it a line at a time against its own
suite. All four of these were confirmed and are fixed.

**It decided on a record it was not looking at.** Netlify Blobs reads eventually
by default, from a cache that can lag by up to a minute. So a run firing at
midnight could be handed a record as it stood at 23:59, find it collectable, and
delete whatever had replaced it in the meantime: a live code, and a mail budget
reset to zero, from one stale read. The sync endpoint had already learned this
and says so in its own header; this had not. The read is now
`getWithMetadata` with `consistency: 'strong'`.

**And it deleted without checking that was still the record.** The listing hands
back an etag with every key, which the first version dropped on the floor. A
record is now collected only if the read's tag still matches the listing's, so
anything rewritten in between is left for tomorrow. The platform has **no
conditional delete**, so the last hop cannot be guarded at all; what is left is
a race measured in one round trip, whose cost is one person retrying a sign-in
they were already making. That residue is named in the file rather than implied.

**One slow key could eat the whole run.** The clock was checked only between
batches, and the blobs client retries a 429 or a 5xx five times with five
seconds between attempts, so a single unlucky key could sleep for twenty-five
seconds inside a batch nothing was watching. The run was then killed at thirty
with the truncation line it exists to print still unwritten, which is precisely
what the budget was there to prevent. Every operation is now raced against the
time actually left.

**And truncation fell entirely on the caller records.** Listing the addresses
and then the callers put every caller record behind every address record, so the
first store big enough to truncate would have stopped collecting caller records
altogether rather than proportionally. The two prefixes are interleaved now,
which costs nothing.

Two more things came out of the same audit. `getStore` **throws** when the Blobs
context is not injected rather than returning null, so the "no store configured"
branch that all three functions are written to answer with was unreachable in
production and a missing store would have been an unhandled exception; the thunk
is wrapped in all three now, `sync.mts` included. And **four of the sweep's own
tests were passing for the wrong reason** -- among them the pair the file called
its proof of the whole rule, which held whether the sweep collected everything
or nothing. Each mutation that went green now has a test written to fail on it,
and twelve mutations were re-run against the repaired suite.

### The free door's own counters were per round trip

The same audit that went over the sweep found the bound the sweep exists to
protect did not hold, which is worth more than the sweep was. All three
counters on `/api/signin` were a read, a decision and a write with no condition
on any of them, and a lost update in a rate limit does not cost one request past
the limit. **It costs the limit**, because everybody who read the same number
also passes the same check.

  Twelve requests for one address     twelve mails, against a cap of five, and
  arriving together.                  a record left behind saying `sent: 1`.
  Twenty guesses fired at once.       all compared, `attempts` left at one, and
                                      a six-digit code alive for the rest of
                                      its fifteen minutes with no working
                                      counter in front of it.
  Twenty requests from one caller.    all counted as the first.

So *at most one mail a minute and five a day to any one address* was a
description of what the code meant rather than of what it did. That sentence is
in this document, in the README and in the endpoint's own header, and it was
load-bearing in all three.

The fix is the loop `src/sync/endpoint.ts` already had and `SYNC.md` already
recorded as a defect once: **every read strongly consistent, every write
conditional on the record not having moved, and nothing believed on `modified`
alone** because the client reports that for every status except a 412. Two
orderings came out of it. Nothing is mailed until the write that counted the
mail has landed, so a request that lost the record looks again rather than
sending on a stale count. And **a guess is counted before it is compared**,
which is the whole of what makes five wrong guesses mean five: a guess that
cannot be paid for is not taken, and the answer is 429 rather than a free
comparison.

The mail-failure rollback was a third defect in the same family. It deleted the
key when there had been nothing there before, which deletes whatever is there
*now*: a second request that had written its own record in between lost the live
code it had just mailed, and that person was told their code was wrong. Nothing
is deleted there any more. What goes back is the previous record, or, where
there was none, one that is expired and has spent none of the day's five, and it
goes back conditionally so a request that has taken the key over keeps it.

**The fake in the tests was the reason none of this was visible.** It was a
plain `Map`: linearizable, always answering with the latest value, with no
notion of a conditional write, and every test drove requests strictly one after
another. Both suites now share `src/auth/__tests__/fakeStore.ts`, which models
etags, `onlyIfNew` and `onlyIfMatch`, a write that reports `modified` without a
tag, and a gate that holds every reader at the same line so an interleaving is
arranged rather than hoped for. Seven mutations, one per defect above, were run
against the repaired suite and all seven fail it.

### Collecting tombstones

Built, and it turned out to be the one piece where the obvious implementation is
wrong in a way that only shows up months later. **Collecting a tombstone too
early resurrects the record**: a device still holding the live row meets a server
with nothing left to refuse it, and a session deleted in March is back on every
device in June.

So the window is a floor rather than the rule. Ninety days says how long a
device can be switched off and still come back coherent; the bundle also holds a
map of device to last-seen, and the line is the earlier of *ninety days ago* and
*the least recently seen device*. A device unseen for a hundred and eighty days
is presumed gone, because one lost phone should not freeze collection forever.

**Twice the window rather than once, and this was a real bug before it was a
decision.** The first version forgot a device at exactly the retention window,
which meant every remembered device was newer than the window and the minimum
could never be the binding one: the whole device map was decoration, and the
test that was supposed to prove it worked was passing for another reason.

**Two more things came out of writing it.** The collection line only moves when
a sweep actually removed something, because it arms a refusal and arming it on
an empty sweep would turn away records from any device that had merely been
away. And the sweep runs last in the merge, after the three constraint rules, so
it cannot collect a tombstone one of them has just written.

The backstop for a device gone past the forget threshold is that **a record the
server has never seen, older than everything collected, is refused**. That can
lose a record such a device created and never sent. It is the worse thing to
lose and much the rarer: it needs six months offline and a write that never
left, where the alternative needs only the six months.

### Three ways collection was still wrong

An adversarial audit of the merge found the rule above correct and its
implementation not. All three failures share a shape: each one collected a
tombstone that somebody was still owed, and each one showed up as a deleted
session coming back rather than as anything going wrong at the time.

**The device stamped itself before the sweep.** `mergeIntoBundle` recorded the
asking device as last-seen *now* on the first line, and swept on the last. So a
device that had been away three months stopped being the oldest thing on the map
the instant it asked, the horizon jumped to the present, and the tombstones it
had come to collect were swept out of the answer it was about to be handed. The
one device the map existed to protect was the only one it could not protect. The
stamp now happens after the sweep, which makes the rule what it always claimed
to be: a tombstone goes only once every remembered device has been *answered*
with it, not merely once every device has asked. It costs one extra sync before
a row is collected, on a row that has been dead for three months.

**Retention was measured on the deleting phone's clock.** `deletedAt` is the
moment a person deleted a session, which on a phone with no signal can be months
before the server hears about it. A delete made in a card room in March and
pushed in July arrived already older than the window and was swept in the same
request that delivered it, while every other device was still holding the live
row. Ninety days of retention has to mean ninety days *the server has held the
thing*, so a stored change now also carries `heardAt`, the server's own stamp,
and that is what the sweep measures. It moves only when the entry really
changes, so a device retrying a push it already sent cannot restart the clock on
its own delete.

**A device with no token swept its own tombstones.** The local sweep in
`src/data/index.ts` exists so an app that never signs in does not keep every
tombstone it ever wrote. But "no token" covered two different devices: one that
never syncs, and one that syncs and whose sign-in has lapsed. The second may be
holding tombstones it never managed to push, with the server still holding the
live rows, so sweeping there lost the deletes and the next sync put every one of
those sessions back on every device the person owns. The sweep is now gated on
the session rather than on the token: no session, or a session that does not
sync, collects on the window; a syncing session with no token gets the local app
and no sweep at all.

### The cursor stops being a record's own stamp

Both of the defects the collection work left open came from the same thing: one
number, `record.updatedAt`, was doing three jobs. It was when a person changed a
row, it was how two versions of a row were ranked against each other, and it was
the cursor. The first two belong together. The third does not belong with them
at all.

**A record could arrive too old to be delivered.** A device is served everything
at or after the `since` it sent. A delete made in a card room carries the moment
it was made, so if the other device syncs before that phone finds signal, its
cursor is already past that moment and the tombstone is never handed over: not
collected, not refused, simply never sent. The two devices then disagree for as
long as they both exist. Reproduced end to end in the two-device suite.

**A constraint rule could discard a push still in flight.** The three settle
rules wrote `updatedAt: now`, which made every conclusion the server drew newer
than everything a device was still holding. A phone that deleted a session
offline came back with a tombstone stamped an hour earlier, lost the comparison,
and had the delete thrown away: the session was closed instead and came back
down to the device that deleted it. Also reproduced.

So the answer and the cursor are now cut on `heardAt`, the stamp the server
writes when it stores an entry, and the device echoes back a number it never
reads. That is the whole of the first fix, and it is what makes the second one
possible: with delivery no longer riding on `updatedAt`, the settle rules can
stop lying about it. They stamp one millisecond past the row they replace, which
is exactly enough to beat that row and any stale copy of it, and not enough to
beat anything a person did afterwards.

Three things came out of building it.

**The stamp is `max(clock, last issued + 1)`, not the clock.** Functions run on
many machines and their clocks agree to within milliseconds rather than exactly.
A stamp that went backwards would put a record behind a cursor already handed
out, which is the same lost record the whole scheme exists to prevent. Monotone
per bundle is enough; a sequence number in a new field is not needed, and would
have been a second thing to keep in step.

**A cursor the bundle cannot place is read as zero.** The bucket can be erased,
and the next request starts a fresh bundle whose stamps begin again from
nothing. Without the clamp a device still holding a cursor from the old bundle
asks for everything after a number no record will ever reach, and is answered
with silence for the rest of its life.

**The device map holds an acknowledgement.** It used to hold the moment a device
was answered, which trusts an answer that may never have arrived. A device
writes its cursor only once it has applied what that cursor covers, so the
number it sends back is the one thing in the protocol that is proof rather than
assumption, and now that a cursor and a `heardAt` are the same kind of number,
using it costs nothing. A mark now holds two numbers on two clocks: what the
device took, and when it was last here. They have to stay apart, or a device
perfectly caught up on a server nobody has written to for months looks exactly
like a phone that was sold.

### Everything else in the same pass

An adversarial audit of the cursor and endpoint surface ran alongside the work.
Four independent designs were produced for the change above and judged against
each other; the smallest won on all three judging lenses, and the monotone stamp
was grafted in from another. The same audit turned up a list, of which these
were confirmed and fixed here.

On the endpoint:

- **The read-modify-write had no compare-and-swap, and read at the store's
  default eventual consistency.** Two devices syncing seconds apart could each
  merge into a bundle that predated the other and write it back, and one push
  was gone with its device told it had succeeded. Now a strongly consistent read
  and a conditional write, retried against a fresh read on a lost race.
- **DELETE was gated by exactly the check its own comment said it skipped**, so
  a lapsed subscriber could not erase their history. Fixed by moving the tier
  check below it, and then settled properly by deleting the tier check: sync is
  free, so an erasure and a write are behind the same one rule, which is the rule
  about a subject of one's own.
- **The merge and the erase were the two unguarded calls.** A throw in either
  was a 500 or a 204 that promised something that had not happened.
- **The file was not typechecked at all.** `tsconfig.json` matched `**/*.ts`,
  which does not match `.mts`.

On the device:

- **A reset landing mid-request was undone by it**, leaving a truncated device
  holding a cursor that said it had seen everything, so the next sync brought
  back nothing and it stayed empty. Guarded by an epoch, checked twice, because
  applying and recording fail differently.
- **A device nobody wrote on never pulled again.** Every sync in the app is the
  tail of a write, so a laptop somebody signs in on, reads their history on, and
  never types into took one answer and stayed on it. It pulls once on the way
  up now, which is the one question the feature exists to answer.
- **The push mark could pass this device's own clock.** A phone with next year's
  date pushes a record stamped next year, and the moment the date is corrected
  every later write is below the mark and nothing is ever sent again, while
  Settings reports success.
- **The push mark did not cover what came down.** Records arrive stamped by the
  device that wrote them, so every record just pulled sat above the mark and
  went straight back up on the next round: on a laptop that had taken years of
  history, the first note typed uploaded all of it again.
- **A throw inside the loop killed it silently**, with the dirty flag already
  cleared, no failure recorded, no backoff armed and the state still saying a
  sync was in progress.
- **The backoff window was an instant on a clock the phone can move**, so a
  backward correction sat the device out for the length of the jump. The
  unauthorized latch is now a flag rather than a wait far in the future, which
  is what it always meant.
- **Applying an answer overwrote a newer local row.** Every answer carries back
  the records the device just pushed, because the server heard them in the
  request being answered, so a note typed during the round trip met its own
  pre-edit self coming down. Overwritten, the note also fell below the push mark
  and was never sent anywhere. Both engines now refuse to write over something
  newer, which is not the device resolving anything: it is the device declining
  to destroy the evidence before the server has seen it.
- **A cursor store that fails reads is not one that is empty.** It minted a new
  device id on every sync, which had the server counting one phone as hundreds
  and each of them holding a tombstone back for six months.

In the merge:

- **A session started on a wrong clock closed every real session.** The rule
  ranks on `startedAt`, and `sanitize` deliberately validates an id and a stamp
  and nothing else, so a session stamped next year won that ranking against
  every real session on every device for a year. The rule clamps what it ranks
  on now, and skips a session it cannot place in time at all -- because
  `Math.max` over a missing stamp is NaN, JSON writes NaN as null, and a null
  `endedAt` is a running session, so the rule would have closed it again on
  every request forever, re-sending it to every device each time.
- **A missing import key was treated as a real one.** `resolveImportCollisions`
  excluded `null` and nothing else, and `undefined` is not `null`. Grouped on
  that, every hand-logged session in somebody's history collides with every
  other and all but one is tombstoned with its hands moved onto the survivor.
- **A record could name itself `__proto__`.** A bundle is a map built by
  assignment, and the guard the stored-records loop had did not cover the
  incoming ids or the device map, whose id pattern admits all three reserved
  names.
- **The device map was the one unbounded part of a bundle**, and the minimum
  over it was taken with a spread, which throws rather than answering past a few
  hundred thousand arguments.
- **An import key was released for a session that was then skipped**, taking the
  provenance off a real local session in favour of one that never arrived, so
  the same CSV row could be imported twice.

### Four of the five that were left

**A first push over 2MB was refused forever.** Over the endpoint's cap the body
is answered 400, which the client reads as `refused`, so it retried the
identical body every five minutes for the life of the install: the player the
feature exists for was the one it locked out. It pages now, and the interesting
half is why paging is not just a size limit. **The receiving device skips a
record whose parent is missing, and moves its cursor past it anyway**, so a hand
that reaches the server before its session is never offered to that device
again. Ordering by `updatedAt` almost avoids that, because a session is created
before its hands; almost, because a session *edited* afterwards carries a stamp
later than the hands under it. So a batch is a time prefix **plus whatever
parents that prefix needs**, and the mark it earns stays under the time cut
rather than over the parents it reached forward for. The extra records are sent
again next round, which costs bytes and nothing else.

**The import fold happened once.** The rule tombstones a duplicate and moves
what was logged against it onto the survivor, and it could only move what was in
the bundle at the moment it fired. A hand logged on the losing session before
that device heard about the fold sat on a tombstone, invisible, until the sweep
took it. The decision is remembered in the bundle now rather than re-derived,
because by the second merge there is no collision left to notice, and it is
forgotten again when the tombstone it names is collected.

**A session closed by the rule was never revised.** It is closed at whatever
activity had reached the server by then, so a hand pushed afterwards left the
session holding a hand that happened outside it. The end moves forward now,
and only where there is no cash-out: a completed session's end is the player's
answer to what came off the table, and nothing here revises that.

**The sweep disagreed with itself across the two engines.** A live child can sit
under a tombstoned session, because another device logs a hand on a session this
one has already deleted and nothing reconciles the pair. SQLite's foreign key
took it with the session; Dexie left it an orphan. So the same sweep lost a hand
on the phone and kept it in the browser. Both take it now, written out rather
than left to a cascade only one engine has.

### And the fifth, which is a question rather than a bug

**Two accounts on one device share one local log and one cursor store.** Signing
out and in as somebody else leaves the first account's history in the database
the second one pushes from. The unplaceable-cursor clamp stops the second
account being answered with silence, so it is no longer silent data loss, but it
is somebody's poker history in another person's bucket.

Fixing it means answering what signing out should do to the log, and that is a
product question rather than a merge one. Log is free and local-first: the log
belongs to the device as much as to the account, and wiping it on sign-out would
make signing in feel like a thing you could lose your history to. Keying the
database by subject is the other answer, and it means a device holds several
logs and the free app has to pick one before anybody has signed in.

### Four more, three of them about one row costing the whole sync

**The merge was not commutative, and the loser was the session somebody was
sitting in.** The rules ran in the order they were written, so the
one-active-session contest read a duplicate that the collision rule was about to
tombstone. A row that existed only until the end of that same merge could win
the contest and close, permanently, the session the player was actually at the
table for; which of the two got closed depended on which push happened to carry
the duplicate. The collision rule runs first now, because it is the one that
*removes* sessions, then the fold, then the activity read, and the venue rule
last because closing a session changes what it looks at.

**A record whose parent the server did not hold was stored anyway.** The pager
takes care never to send a child ahead of its parent, and the intake took
anything. So a session naming a venue that never arrived, or one lost to a
device that never came back, sat in the bundle and was handed to every other
device, each of which skipped it and moved its cursor past it: gone everywhere,
for good. Intake refuses it now, which is the same rule the pager already keeps
on the way out.

**The import-key release still fired for a row that was then refused.** The
release was gated on the venue having arrived, and a missing venue is only one
of the two ways an answer gets refused. A session edited on this device after
the server heard it loses to the local row and is never written, and the key
went with it anyway: a real local session stripped of its provenance on behalf
of a row that never landed, and the same CSV row importable a second time. Both
refusals are decided up front now, before anything is released.

**And one inconsistent row rolled back the whole answer.** Two arriving sessions
can claim one import key, the index is unique in both engines, and the write
that discovers that throws inside the transaction. So the answer was applied in
full or not at all, against what `applyChanges` promises everywhere else, and
the next sync was handed the same answer and failed the same way, for as long as
both rows existed. One of them keeps the key now, picked by the rule the
server's own fold uses (earliest `createdAt`, then lowest id, and a live row
ahead of a tombstoned one) so that the provenance lands where the next answer
will confirm it. The loser is stored without a key and loses nothing else: its
id, its fields and its children all stay, and its stamp is untouched, because
this is reconciling with a decision the server is already in the middle of
making rather than an edit worth pushing back.

### And the one nobody could see

**A pull landed rows and nothing told the screens.** The wrapper writes what
comes back straight into the local database; `useLogStore` holds the arrays
every screen renders and reloads them only when the app asks. The two never
spoke. So the history somebody had just signed in for arrived, sat there, and
did not appear until they quit and reopened the app, which on the one device
most likely to be pulling a whole log down looks exactly like sync not working.

`SyncState` carries a count of answers that changed the log, `compose` wires
that to a signal that survives a recompose, and the store subscribes once and
refreshes. Stable across a recompose because signing in builds a *new* wrapper:
a subscription made once and for all would be listening to an object nothing
writes to any more, on precisely the sync that matters most.

It counts an answer that carried records rather than one that carried anything
new, and the difference is worth naming: both comparisons read one millisecond
back, so a device that has pulled everything is served its own boundary records
again and counts that. The cost is one redundant reload per sync on a device
that is syncing anyway, and every write in the app already reloads the log.
Telling the two apart would mean asking `applyChanges` what it actually wrote,
on both engines, for less than that costs.

### And which token it carries

**The wrapper captured the token once, when it was built.** That is fine for as
long as a token does not change, and it changes: `renewIfDue` writes a fresh one
to the store beside it at launch, and nothing re-read it. On a process that
outlives thirty days -- a browser tab left open, which is the ordinary way to
use the web build -- the captured token expires, the endpoint answers 401,
`halted` latches, and sync stops for good while a perfectly valid token sits in
the store. Nothing on screen would say why, because from the app's side there
is no problem: `getSession` is happy, the card says signed in.

`compose` hands it `getToken` instead of a string, so every request reads the
token as it is now. A renewal is picked up by the next sync, and so is a
sign-out: `getToken` answers null once the token is gone, and the run stops
rather than sending an empty bearer and taking a 401 and a backoff on behalf of
somebody who is no longer there.

---

## What must not break

These are the promises already in the product, and each one has a way of dying
quietly during work like this.

- **The free app never goes behind the sign-in.** Log stays completely usable by
  somebody who never types an email address. An account makes itself feel like
  the natural first screen, and it is not one here.
- **Sync does not quietly acquire a price later.** It had one on paper for two
  phases and the conversion moment is still written down in enough places that
  somebody drafting release copy will reach for it honestly. Three tests hold the
  line rather than one, because a promise on a marketing page and a gate in a
  verifier fail independently: `site.test.ts` refuses a price in any paragraph on
  the front door that mentions sync, `token.test.ts` walks every tier and expects
  the same answer, and `endpoint.test.ts` pushes a free-tier write and reads it
  back out of the store.
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
  remove. Log inherits that argument. **Built**, in `SignInCard`, and the shape
  of it is the interesting part: **erasing signs the device out**, because
  `eraseRemote` deletes the bucket and nothing else, and erasing it while still
  signed in is a control that undoes itself the next time somebody logs a
  session. It erases first and signs out second, so the worst failure available
  is a session still there and a button that can be pressed again rather than
  somebody signed out of a deletion that never happened.

  **And an audit found it did not erase.** `eraseRemote` deletes the bucket, and
  nothing forgot this device's cursors, though `cursorStore`'s own header has
  always said they are *"forgotten at the same moment the token is"*. So
  `pushed` still claimed the whole log had been sent: signing in again pushed
  only the last millisecond of it, the emptied bucket stayed empty, and the app
  reported that it was up to date. The copy was wrong in the same breath, and
  wrong in the direction that matters: it warned that another signed-in device
  would put the copy back, which cursor-bounded pushes mean it will not, while
  the real fact -- that nothing anywhere undoes this -- went unsaid.

  `SyncingRepository.forget` is what makes the header true. It rewinds the
  cursors, keeps the device id, and bumps the epoch so a push already in flight
  cannot write the old numbers back afterwards. The card calls it wherever it
  puts a token down, which is signing out as well as erasing: the next person
  to sign in on a device used to inherit the last one's place in a conversation
  with a different bucket, and be served the tail of their own history.

---

## Still open

1. ~~**Who is allowed to sign in?**~~ **Settled: anybody, at Log's own door.**
   Untilt's sign-in will not mail a code to an address Stripe has no customer
   for, in its own words: *only somebody who has bought can be reached*. That
   was right while sync was sold and made *free like the rest of this* false
   the moment it was not. Of the three ways out, the third was taken:
   `netlify/functions/signin.mts` answers the same two paths on `log.poker`,
   mints the free tier for anybody who can read their mail, and **Untilt is
   untouched**. See [what the free door landed](#what-the-free-door-landed).

2. **Does the first release sync Log only, or is the shared account across all
   three apps a launch requirement?** Log-only is smaller and can use the same
   token without the App User ID work landing anywhere else.
3. ~~**Netlify Blobs, or a real database?**~~ **Settled: Blobs.** The
   bundle-at-rest shape fits them and keeps the family on one piece of
   infrastructure. A player with ten years of history and a device that has been
   offline for a month is still the case that would argue otherwise, and still
   not a case anybody has.
4. ~~**How much of the merge is server-side?**~~ **Settled: all of it.** A
   device that has been in a drawer for a month has a month-old view of the
   world and possibly a wrong clock, so resolving there would make the answer
   depend on which device asked. One place holds the outcome, every device
   converges on it, and the rules are exercised by one test suite rather than by
   however many app versions are still installed.

---

## Where the numbers came from

The record sizes are `JSON.stringify` of the record shapes in
`src/data/dexie/db.ts`, filled with representative values: a 1/3 no-limit session
with a note, a hand with hole cards, a position, two tags and a sentence of note,
a mood check-in, and a rebuy. The session count is three sessions a week, which
is a serious recreational player rather than a professional; a professional is
worse for the bundle argument, not better.
