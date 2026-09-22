# Submitting Log to the App Store

Everything that can be done inside this repository is done. What is left needs
an Apple Developer account, a machine that can run a build, and a few answers
only Kevin can give. This file is the list, in the order it has to happen.

The short version: the code is ready, the config is ready, the privacy policy
is written and deployed with the site. The open items are an account, a first
device build, screenshots, and three decisions.

---

## What is already in the repository

Nothing in this section needs doing again. It is here so that a step further
down that seems to be missing can be checked off rather than redone.

| Requirement | Where it lives |
| --- | --- |
| Privacy policy page | `scripts/build-content.mjs`, published at `/privacy` |
| Privacy policy link in the app | Settings, "Help and legal" |
| Support address in the app | Settings, "Help and legal" |
| Account deletion in the app | Settings, "Your other devices" |
| Version and build on screen | Settings, foot of the page |
| App icon, 1024 square, no alpha | `assets/icon.png` |
| Splash screen | `expo-splash-screen` plugin in `app.json` |
| Bundle identifier | `poker.log.app`, both platforms |
| Version and build number | `app.json`, 1.0.0 (1) |
| Export compliance answer | `ios.config.usesNonExemptEncryption`, false |
| Build profiles | `eas.json` |

All of it is asserted in `src/__tests__/release.test.ts` and
`src/site/__tests__/privacy.test.ts`, so it fails loudly rather than quietly.

---

## Three decisions, before anything is built

### 1. What the iOS build does about the pass

This is the one that changes what gets built, so it comes first.

`SYNC_NEEDS_PASS` in `src/auth/token.ts` is `false`, and everything in Log is
free. That is what keeps this app clear of App Store guideline 3.1.1 today: a
link to a sister app's website is just a link when nothing here is locked.

The day that constant becomes `true` on iOS, Log would be unlocking a feature
bought on an external website, which 3.1.1 prohibits outright. Three ways out,
and they should be chosen between deliberately:

- **Keep iOS entirely free.** Costs nothing, changes nothing, and is what is
  currently in the tree.
- **Add in-app purchase for the iOS unlock.** Apple takes its cut, and the
  family's one-payment-covers-three arrangement needs a way to reconcile an
  iOS purchase with a web purchase.
- **Apply for the External Purchase Link Entitlement.** US storefront only,
  still 27% commission, and a meaningful amount of paperwork.

The cards in `src/features/sessions/PostSessionReset.tsx` and
`src/features/sessions/PreSessionWarmUp.tsx` sit near this line without
crossing it, and the distinction is worth writing down because the next change
to that copy is where it would be lost. They say Untilt has after-session
resets, and material for the minutes before you sit down, and that both are
inside Untilt's pass.
Neither names a price, shows a purchase or links to a checkout, and nothing in
Log unlocks either way, so both are statements about a sister app rather than a
purchasing mechanism. The third card of this kind, offered after a hand tagged
as a bad beat or a cooler, mentions no pass at all: every one of Untilt's
between-hands resets is free, so there is nothing there to be careful about. What would cross the line is a price, a buy button, or
any Log feature that turns on because somebody paid at untilt.poker. The
wording is pinned by tests in
`src/features/family/__tests__/handOffs.test.ts`, which fail on a dollar sign
or a verb about buying.

Each card's paid branch reads `hasPass`, which is `claim.tier === 'full'` and
cannot be true for anybody yet: Log's own door mints the free tier and this
app has never shipped a way to receive one of Untilt's tokens. It is written
against both answers for the same reason everything around `SYNC_NEEDS_PASS`
is. Both branches follow the same link either way -- `untilt.poker?source=log&lane=after`
for the after-session card and `?source=log&lane=preflight` for the other,
which open that app's after-session and before-the-session lanes; only the
sentence differs.

Related, and worth knowing before somebody reports it as a bug: `/claim` is
web-only. `takeCode()` in `app/claim.tsx` returns null when the platform is not
web, so a pass bought at Untilt cannot be claimed on a phone at all. Nothing on
iOS is gated on it today, so it is a gap rather than a break, but it is the
piece that would have to be built for any of the paid options above.

### 2. iPad

`ios.supportsTablet` is `true`. The layout does adapt: `Screen`, `Sheet` and
`TabBar` all cap at `layout.maxContentWidth`, so on an iPad Log is a centered
480pt column rather than a stretched phone screen. That renders sanely, it is
just a lot of empty space.

Leaving it on means Apple reviews iPad behavior and wants iPad screenshots.
Turning it off is one line and ships iPhone-only for 1.0. Either is defensible.
It is left on, because the layout demonstrably handles it, but it has not been
seen on an actual iPad and should be before the screenshots are taken.

### 3. The support mailbox

`SUPPORT_EMAIL` in `src/config.ts` is `support@log.poker`. The domain already
sends mail: `netlify/functions/signin.mts` sends from `signin@log.poker` and
`scripts/check-gate.mjs` records that the apex is verified.

**Receiving is a separate thing, and it has to work before the first
submission.** App Review uses the support address. One that bounces is worse
than none. A forward to a real inbox is enough.

---

## Getting an account and a first build

**Steps 1, 2 and the first half of 5 were done on 2026-09-22.** What is left is
the builds, the screenshots and the upload. The finished steps are struck
through rather than deleted, because what they settled is what the rest of this
file reads back.

1. ~~**Apple Developer Program.**~~ **Done.** The account is approved, and the
   team already carried TiltProof's app record before this one.

2. ~~**Register the bundle identifier.**~~ **Done.** `poker.log.app` is
   registered as an explicit App ID, matching `app.json` on both platforms,
   with **no capabilities enabled**, which is what this app needs: the keychain
   is its own (`tokenStore.ts` calls SecureStore with no options and `app.json`
   carries no access group), the `logpoker://` scheme lives in Info.plist, and
   there is no push, no iCloud and no Sign in with Apple in the tree.

   Associated Domains is the one to come back for, and only on the day a pass
   bought at untilt.poker should land on a phone. `/claim` is web only today;
   see decision 1 above. Capabilities stay editable after registration, so none
   of that had to be settled here.

3. **A simulator build, which needs no signing.** This is the first time any of
   this code will have run outside a browser:

   ```
   npx eas build --platform ios --profile simulator
   ```

   Expect to spend real time here. SQLite (`src/data/sql/expoSqliteDriver.ts`),
   SecureStore (`src/auth/tokenStore.ts`), haptics and the CSV share sheet
   (`src/features/export/saveCsv.ts`) are all carefully written and none has
   ever executed on a device.

4. **A device build**, once enrollment clears:

   ```
   npx eas build --platform ios --profile preview
   ```

5. ~~**Create the app in App Store Connect.**~~ **Done.** The record is named
   `Log: Poker Session Tracker`, iOS only, English (U.S.), SKU `poker.log.app`,
   and **its App Store ID is 6814843842**. Then the production build and the
   upload:

   ```
   npx eas build --platform ios --profile production
   npx eas submit --platform ios --profile production
   ```

   `eas submit` prompts for the Apple ID, team ID and App Store Connect app ID.
   The app ID is the number above. The team ID is the App ID Prefix shown on
   the identifier's own page in Certificates, Identifiers and Profiles.

   **They stay out of `eas.json` on purpose.** They are account facts rather
   than project facts, which is why `submit.production` is an empty profile
   instead of placeholders, and `release.test.ts` fails the suite on an
   `appleTeamId` or `ascAppId` appearing in that file. Recording the app ID in
   this file is documentation and does not touch that rule.

   That number is also what the marketing site wants the day the app is
   approved: an `apple-itunes-app` smart banner and the App Store badge link
   both address the app by it. Neither goes live before approval, because App
   Review opens the marketing URL and a download link that goes nowhere is an
   easy rejection.

---

## The answers App Store Connect asks for

### App Privacy

Every answer below is what the code actually does. The reasoning is in
`/privacy` and the tests that hold that page to the code are in
`src/site/__tests__/privacy.test.ts`.

**Data collected and linked to the user:**

- **Contact Info, Email Address.** Purpose: App Functionality. Used for
  sign-in only. Not used for tracking. Worth saying in the notes that the
  address is never stored: `src/auth/signinEndpoint.ts` keys its record by an
  HMAC of the address and holds an HMAC of the code, and deletes it after
  fifteen minutes.
- **User Content, Other User Content.** Purpose: App Functionality. The
  sessions, hands, mood entries and venues, synced only while signed in.

**Data not collected:** everything else. No identifiers, no usage data, no
diagnostics, no location, no contacts, no purchases recorded here.

**Tracking:** none. No ATT prompt is needed, and no tracking domains are used.
`src/__tests__/release.test.ts` asserts no analytics or crash-reporting package
is in `dependencies`, which is the thing that would make this answer false.

**Third parties:** Netlify (hosting and the synced log) and Resend (the one
sign-in mail). Both are processors. Neither receives anything for its own use.

### Age rating

Log records real-money poker sessions that have already been played. It
contains no game of chance, no wagering, no simulated gambling and no link to
any gambling operator. It does not facilitate gambling; it is a record of it.

**All of that is true, and none of it means answering "no" to the Gambling
question.** This paragraph used to stop at "answer the gambling questions
honestly rather than answering none", which read as a principle and was taken
as one. It is not a principle. It is a scar.

**Untilt was rejected once for answering no to that question**, on this same
developer account, and Untilt is a meditation app: less gambling-adjacent than
this one by a distance. Apple reads the question as being about what the app is
about and not only about what a user can stake inside it, and a poker app
declaring no gambling content at all reads as evasive rather than as accurate.

So the answers, spelled out rather than reasoned toward:

| Question | Answer |
| --- | --- |
| Gambling | **Yes** |
| Simulated Gambling | None, there is no play-money game |
| Contests | None |
| Loot Boxes | No |

That lands the app at 18+ under the current system, which is the right rating
for it.

**Answering yes does not pull the app under guideline 5.3.4.** That rule is
about apps which actually offer real money gaming, and it is assessed from the
app rather than from this checkbox: there is nothing in Log to stake, so there
is no license for a reviewer to ask after. Untilt carried the same answer
through review without ever being asked for one.

### Export compliance

Already answered in `app.json` via `ios.config.usesNonExemptEncryption: false`,
so TestFlight will stop asking on every build. The basis: Log reaches the
network over HTTPS and uses HMAC-SHA256 to verify a sign-in token. Both are
standard and exempt.

### URLs

- **Privacy policy URL:** `https://log.poker/privacy`
- **Support URL:** `https://log.poker`
- **Marketing URL:** `https://log.poker`

---

## App Review notes

Paste something close to this into the review notes field. Each paragraph
answers a question this app reliably raises.

> **No account is needed.** Every feature of Log works signed out. Signing in
> is optional and only carries your log to your other devices.
>
> **To try the sign-in:** Settings, "Your other devices", enter an email
> address. A six character code is mailed to it and is good for fifteen
> minutes. There is no test account to supply, because there are no accounts:
> the service keeps no user table and never stores an address.
>
> **Account deletion** is in Settings, under "Your other devices", labeled
> "Delete your account and its data". It deletes everything the server holds
> and signs the device out. There is no second step and nothing left behind,
> because the deleted copy is the whole of what is stored. The full
> explanation is at https://log.poker/privacy.
>
> **Gambling.** Log is a record keeping tool. It records poker sessions the
> user has already played. There is no game, no wagering, no simulated
> gambling and no link to any gambling operator. The footer of every page on
> log.poker carries problem gambling helpline information.
>
> **Links to other apps.** Settings links to tiltproof.poker and
> untilt.poker, which are two other apps by the same developer. Nothing in
> Log is locked, gated or sold; every feature here is free.
>
> After a session is closed out, Log shows a card saying that Untilt has
> after-session resets and that they are part of Untilt's pass. It names no
> price, offers no purchase and links to no checkout: the button opens
> untilt.poker, the same outbound link Settings carries. Nothing in Log is
> unlocked by anything bought there, and nothing here changes if the player
> ignores it.
>
> On the dashboard, for the week after a session in which the user tagged a
> hand "misplayed?", Log lists those hands and says that TiltProof can review
> one and that reviewing a hand you played is free there. The same shape as
> the paragraph above: no price, no purchase, no checkout, and the row opens
> tiltproof.poker. The card appears only when the user tagged a hand
> themselves, never during a session, and it goes away on its own.
>
> Two more cards name Untilt in the same way. If the user picks a 4 or a 5 on
> the optional mood scale on the start-a-session screen, Log says Untilt has
> material for the minutes before you sit down, that it is inside Untilt's
> pass, and that a free reset is on the same screen. And after the user logs a
> hand tagged "bad beat" or "cooler", once per session, Log offers Untilt's
> between-hands resets, which are free. Both are statements about the other
> app: no price, no purchase, no checkout, and the button opens untilt.poker.
> Neither changes anything in Log, and ignoring either costs the user nothing.

---

## Screenshots

Required at 6.7" (iPhone 15 Pro Max or similar). Add 12.9" iPad shots if
`supportsTablet` stays `true`.

The screens worth showing, in the order they tell the story: the dashboard with
a few sessions logged, a live session running, logging a hand, the variance
view, and the history list. The simulator build from step 3 is what these come
from.

---

## Before each submission

```
npm run typecheck && npm run lint && npm test
npm run build:content -- --check
```

Then bump the build number. `eas.json` has `autoIncrement` on the `production`
profile and `appVersionSource: "local"`, so the build writes the new number
back into `app.json` and it should be committed with everything else.
