# Arrivals

A spec for automatic session capture on iOS, written September 2026 and not
yet built. It is the answer to a question worth stating in the form it was
asked: can Log fill its own log, without the player typing anything?

Most of the way, no. The honest version of this feature is smaller than "the
app logs for you" and more valuable than it sounds, so the first job here is to
say exactly what it does and what it cannot.

## What it does, precisely

**It automates the place and the time. It does not automate the money.**

Log's session record holds seven things that matter: the venue, the game, the
stakes, the buy-in, the rebuys, the cash-out, and the clock. A phone in a
pocket can know the venue and the clock to the minute. It can know nothing
whatever about the other five, because no sensor on a phone sees a chip tray.

That sounds like a small share of the record until you look at what reads it.
`src/domain/variance.ts` fits a win rate and a sigma to hours. The dashboard's
hourly rate is money over hours. Big blinds per hour, the unit the variance
model actually runs on, is hours in the denominator. The recent-stretch verdict
is a statement about a span of time. **Hours are the single most load-bearing
number in this app, and they are the one number every player enters from
memory, hours after the fact, rounded to something ending in a zero.**

The money, by contrast, is the number a player already knows exactly. Nobody
walks away from a table unsure whether they cashed out 1,340 or 900. They walk
away genuinely unsure whether they sat down at 6:30 or 7:15, and by the time
they open the app the next morning the honest answer is gone.

So the trade this feature makes is: capture the number people get wrong, keep
asking for the numbers they get right.

## Why it is worth a release

Three reasons, in the order they should be weighed.

**The estimates get better, not just the typing.** Everything above about
hours is an accuracy argument, not a convenience one. A win rate computed over
hours that are systematically rounded up is biased low, and a sigma fitted to
noisy hours is wider than the player's real variance. This is the only item on
the 1.1 list that makes the statistics more correct rather than the app more
pleasant.

**It closes a loop that is already half built.** The Live Activity is item 1
of "What 1.1 is" in the README, and it exists so a running session survives the
phone locking. An arrival that opens the session and a lock screen that carries
it are the same idea reached from two ends: the session should track itself.
Built together they are one story and one new review surface conversation
rather than two.

**Nobody free has it.** `StackStats Geo` (App Store id 6764804403) ships
geofenced venue detection today and charges a subscription for it, past a
ten-session trial, with too few ratings to show an average. Nothing in the free
field does it at all. Log's whole position is that the things other apps gate,
it gives away, and this is the next one available to give away.

## What the player sees

Three moments, and only the first involves a decision.

**The first session at a new room.** The player taps Start as they do today
and picks or creates the venue. When the session is saved, Log has a position
fix and the venue it belongs to, so it quietly remembers the two together and
says so once, plainly, on the session screen: *Log will recognize The Lodge
next time.* One line, no dialog, and a way to turn it off in Settings for
people who want none of this.

**Every session after that.** The phone crosses into the fence. Nothing
happens on screen, because the phone is in a pocket and the player is buying
chips. Log records an arrival: the venue, the moment, nothing else. When the
player next opens the app, whether that is two minutes later at the table or
six hours later in the car, the dashboard leads with:

> **At The Lodge since 6:42pm.** Start the session?

Tapping it opens the ordinary new-session screen with the venue filled in and
`startedAt` set to 6:42pm rather than to now. The player types the buy-in,
which they were always going to type, and everything else is already right.

**Leaving.** The phone crosses out of the fence with a session still open.
Log records the departure the same way. The next time the app opens, the
running session carries a proposed end: *Left at 1:20am. Cash out?* Accepting
sets `endedAt` to the real departure and drops the player into the cash-out
field, which is the one number they still owe.

That is the whole feature. The player still types two amounts per session. They
never again reconstruct a time.

## The design decisions

Each of these was a fork, and the reason matters more than the choice.

### Fences are learned, never shipped

There is no bundled directory of poker rooms and there must not be. A directory
is a licensing relationship, a data set that goes stale, a download, and a
privacy claim about places Log has decided are gambling venues. Learning the
fence from the player's own first session costs nothing, covers home games and
a friend's kitchen exactly as well as it covers Bellagio, and means Log ships
no opinion about where anybody gambles.

The cost is that the first session at a room is never automatic. That is the
right cost: it is one session per venue, and the player is standing there with
the app open anyway.

### The geofence is local and does not sync

`Venue` syncs. `SYNC_TABLES` in `src/sync/protocol.ts` lists it first, because
sessions hang off venues and a merge has to apply it first. So the obvious
place for coordinates is two more columns on `venues`, and that is the wrong
place, for three separate reasons that happen to agree.

**An older build would erase them.** The server carries unknown fields through
untouched, which is what `SyncRow` is for, so the wire is fine. The clients are
not symmetric: Dexie stores whole objects and keeps a property it has never
heard of, while `SqlRepository` has fixed columns and drops one. A 1.0 phone
that pulls a venue written by a 1.1 phone, then renames it, pushes back a
venue row with no coordinates, and last-write-wins does the rest. The fence
disappears and nothing anywhere reports it.

**Precise home coordinates are a different class of data.** A venue named
"Mike's basement" with a lat and a lng on it is Mike's home address, on a
server, in a bundle that also says what nights the player was there. That is a
privacy nutrition label change and a thing to be sued over, for a feature whose
entire benefit is local to one phone.

**The other devices cannot use it anyway.** Region monitoring is an iOS
capability. The laptop that the web app runs on will never cross a fence.

So fences live in the local `preferences` table, as one JSON value keyed per
venue id, exactly as `startingBalance` does and for the same reason its comment
in `src/data/repository.ts` gives: a sixth entry in `SYNC_TABLES` is a bundle
format, a retention rule and a merge rule, and this is not worth that. A player
with two phones teaches each one its fences, which takes one session each.

### An arrival is not a session

`startSession` in `src/store/useLogStore.ts` requires `buyIn`. It is not
optional and it should not become optional: a session row with a zero buy-in is
not an incomplete record, it is a wrong one, and it flows straight into the
bankroll curve, the win rate and the variance band. An app that silently
invents money is worse than an app that asks.

So the geofence writes an **arrival**, not a session. An arrival is a venue id,
a timestamp, and a direction. It lives beside the fences, local and unsynced,
and it is discarded once it has been accepted or dismissed, or after a day
without either.

This is also what makes the feature safe to get wrong. A false arrival costs a
line on the dashboard that the player dismisses. A false session costs a
corrupted bankroll that nobody notices for a month.

### A departure proposes an end and never a cash-out

Same rule at the other end, and there is precedent in the codebase for exactly
this shape. When `resolveActiveSessions` closes a session left open by another
device, `src/sync/bundle.ts` writes `endedAt` and sets `cashOut: null`. The app
already has a well-defined state for "we know when this ended and not what it
was worth." A departure produces that state and nothing more.

### Living inside the twenty-region limit

iOS monitors at most 20 regions per app, app-wide, and that is a hard ceiling
rather than a guideline. A player with three years of logs can easily have more
than 20 venues.

The rule: monitor the 20 venues with the most recent sessions, re-evaluated on
significant location change. A player in Las Vegas gets their Vegas rooms; the
room they played once in 2024 in another state is not monitored and costs them
nothing, because they are not there. The ordering is already computable from
data the app has, and `Venue.sessionCount` is derived at read time for a
related reason.

Radius is 150 meters, which is large enough for a GPS fix indoors and small
enough that two rooms across a street stay distinct. Where two learned fences
overlap, the nearer center wins and the ambiguity is worth surfacing on the
venue rather than resolving silently.

### Always, not When In Use

Region monitoring that wakes a closed app requires `Always` authorization.
There is no version of this feature that works with `When In Use`, because the
entire point is the phone in the pocket.

That is the most expensive line in this spec. `Always` is the permission iOS
shows the scariest prompt for, re-prompts about weeks later, and App Review
reads most carefully. The mitigation is to ask for it late and in context:
`When In Use` at first launch if anything needs it at all, and the `Always`
prompt only after the player has accepted a learned fence, at the moment it
would first be used, with the reason on screen in Log's own words before the
system asks.

### Web and Android do nothing

The web build has no background location and will not get one. Android has
geofencing and different enough plumbing that it is a separate piece of work,
not a free one. Everything here is `Platform.OS === 'ios'` and the rest of the
app must not notice: the dashboard line simply never appears.

## How it fails

Worth writing down before it is built, because every one of these will happen.

- **A resort is one building.** The Bellagio fence covers the restaurants, the
  shops and the parking garage. A player who goes for dinner gets an arrival.
  This is why an arrival is an offer and not a session.
- **Dinner break.** A player who leaves the table for an hour crosses out and
  back in. The rule: a departure inside a running session proposes an end, and
  an arrival within an hour of a proposed end withdraws it rather than starting
  something new.
- **Two rooms, one plaza.** Handled by the nearer-center rule above, badly. The
  player can correct the venue on the session screen, which they were opening
  anyway.
- **The player never opens the app.** The arrival expires after a day. Nothing
  is lost that was not already lost, because today there is no capture at all.
- **Location denied or off.** Everything degrades to what the app does today.
  No screen may depend on a fence existing.

## What has to change

- `expo-location` as a dependency, and `expo-task-manager` for the background
  task that receives region crossings.
- `NSLocationWhenInUseUsageDescription` and
  `NSLocationAlwaysAndWhenInUseUsageDescription` in `ios.infoPlist`, plus the
  `location` background mode.
- `src/__tests__/release.test.ts` learns both keys. The usage strings and the
  feature live in different files, which is the same argument the
  `supportsTablet` assertion is there for.
- A `fences` and an `arrivals` value in the local `preferences` table. No
  SQLite migration beyond what `preferences` already is, and nothing in
  `SYNC_TABLES`.
- One dashboard affordance, one Settings toggle, one line on the session
  screen the first time a fence is learned.
- The new-session screen accepts a `startedAt` it did not choose, which
  `StartSessionInput` already supports for back-filled sessions.

## What App Review will see

An app that answers the gambling question yes, asking for `Always` location. It
is worth being deliberate rather than optimistic about that pairing.

The defensible reading is that Log is a personal record keeper, the location is
used to timestamp the player's own sessions, nothing leaves the device, and the
same information would otherwise be typed by hand. That is true and it should
be said plainly in the review notes rather than left to be inferred.

The unknown is whether a reviewer reads a gambling-flagged app with background
location as a responsible-gambling concern. There is no evidence either way and
this spec does not pretend there is. What makes it survivable is sequencing: by
1.1 Log has been through review once, so this is one new thing on a known app
rather than another unknown on an unknown one. That is the same argument that
held the Live Activity out of 1.0, and it cuts the other way here.

## Staging

1. Learn fences and record arrivals. No notifications, no new permission beyond
   `When In Use` until a fence exists. The dashboard offer is the whole surface.
2. The departure end proposal.
3. Only if the first two prove out: a local notification on arrival, which adds
   `expo-notifications` and a second permission prompt, and is the first thing
   to cut if review goes badly.

Stage 1 alone is most of the value, because the player who opens the app at
cash-out gets an honest start time either way.

## Open questions

- **Does the arrival offer belong on the dashboard or in the tab bar?** The
  dashboard is where the Resume button already is, which argues for it. A
  player who opens straight to Sessions never sees it.
- **Should a learned fence be forgettable per venue, or only globally?** Per
  venue is obviously right for a home game the player stops attending, and it
  is another row of UI for something that may never be used.
- **Is one hour the right dinner-break window?** It is a guess. It should be a
  named constant with this sentence next to it.
