# Getting Log onto Google Play

The Android build is configured in this repository. What is left needs a Google
Play developer account, a real Android phone, and a series of forms in Play
Console. This file is that list, in the order it has to happen. `SUBMISSION.md`
is the App Store version of the same thing, and where an answer is the same on
both stores this file points there rather than repeating it.

---

## What is already in the repository

| Requirement | Where it lives |
| --- | --- |
| Package name | `poker.log.app`, the same as the iOS bundle id. It can never change once a build is uploaded. |
| Version code | `android.versionCode` in `app.json` |
| Adaptive icon | `assets/android-icon-foreground.png` on the cream tile `#e8e4da`, with a monochrome layer for themed icons |
| Play listing icon, 512 square | `design/play-icon-512.png` (drawn by `scripts/generate-icons.mjs`) |
| Feature graphic, 1024 by 500 | `design/play-feature-graphic.png` (drawn by `npm run build:play`) |
| Permissions | Internet and vibrate only. Storage and "draw over other apps" are blocked in `app.json`. |
| Store build | `production` profile in `eas.json` builds an Android App Bundle |
| Build to install by hand | `preview` profile builds an APK |
| Submit target | `submit.production.android`: the internal testing track, as a draft |
| Privacy policy, account deletion | `https://log.poker/privacy`, and Settings in the app |

All of it is asserted in `src/__tests__/release.test.ts`.

Android backup is left on deliberately. Google's own backup restores the SQLite
log onto a new phone, which is the only way a player's history moves without an
account. The sign-in token and sync cursors are in the keystore, which does not
restore; both stores already treat an unreadable value as empty, so a restored
phone simply asks to sign in again.

---

## 1. The developer account

Sign up at play.google.com/console with the Google account that should own the
app. There is a one-time $25 fee and an identity check.

**Personal or organization matters more than it looks.** A personal account
created after November 2023 cannot publish to production until it has run a
closed test with at least 12 testers opted in for 14 days in a row (step 7). An
organization account skips that, but needs a D-U-N-S number for the business.

**Log is going the organization route** (Kevin, 2026-10-01: the business has a
D-U-N-S number). Enter the legal name and address exactly as Dun & Bradstreet
holds them, because Google checks them against the D-U-N-S record and a
mismatch is the usual cause of a stalled verification. The organization name
is also the developer name the Play listing shows.

## 2. The app record

Play Console, Create app:

| Field | Value |
| --- | --- |
| App name | `Log: Poker Session Tracker`, the same name as the App Store (26 of Play's 30 characters). Log tracks sessions, not a bankroll, so the name says so. |
| Default language | English (United States) |
| Package name | `poker.log.app`, if the form asks for it. It must match `android.package` in `app.json`, and it can never change. |
| App or game | App |
| Free or paid | Free. This cannot be changed to paid later. |

## 3. Install it on a phone first

```
npx eas build --platform android --profile preview
```

EAS offers to generate an upload keystore on the first Android build. Say yes
and let EAS keep it. Install the APK from the build page on expo.dev onto a real
Android phone and go through the app before anything goes to Play. The things
iOS never exercised:

- The system back button and back gesture on every screen and sheet.
- The keyboard on the session and hand forms (Android resizes the window rather
  than padding it).
- Import: the file picker hands back a `content://` file, not a copy.
- Export: the share sheet, and saving the CSV somewhere.
- The status and navigation bars, since Android 16 draws the app edge to edge.
- Sign in with a mailed code, sync with another device, then delete the account.
- The icon on the home screen, including with themed icons switched on.

## 4. The first store build

```
npx eas build --platform android --profile production
```

This writes a new `android.versionCode` into `app.json`, the same way iOS
writes its build number. Commit it after every production build, or the next
one reuses a code Play already has and is refused.

**The first upload has to be by hand.** Google's API cannot create the first
release of an app, so `eas submit` fails until one build is in. Download the
`.aab` from expo.dev, then in Play Console: Testing, Internal testing, Create
new release, upload it. Accept Play App Signing when asked: Google keeps the
signing key and the EAS keystore becomes the upload key.

Add yourself as an internal tester and install from the Play Store link. That is
the first time the app arrives the way a player's will.

## 5. App content

Play Console, Policy and programs, App content. Every answer below is what the
code does; the reasoning is the same as the App Privacy section of
`SUBMISSION.md`.

**Privacy policy:** `https://log.poker/privacy`

**App access:** All functionality is available without special access. Sign-in
is optional and only turns on sync; there is no account to hand a reviewer.

**Ads:** No ads.

**Content rating** (the IARC questionnaire). Category: Utility, Productivity,
Communication, or Other. Answer it the way the App Store was answered, for the
same reason (see Age rating in `SUBMISSION.md`):

| Question | Answer |
| --- | --- |
| Anything asking whether the app references, depicts or is about gambling | **Yes** |
| Simulated gambling | No |
| Real-money gambling or wagering in the app | No |
| Users interact or share content with each other | No |
| Shares the user's location | No |
| Digital purchases | No |

**Target audience:** 18 and over only.

**Data safety:**

- Data collected: **Email address** (account management and app functionality)
  and **Other user-generated content** (app functionality: the synced log).
  Both only when the player signs in. Neither is shared with third parties.
  Netlify and Resend are processors, which the form does not count as sharing.
- Encrypted in transit: Yes.
- Users can request deletion: Yes. In the app it is Settings, "Delete your
  account and its data". The web link Play asks for is
  `https://log.poker/privacy`, whose "Deleting it" section says how.
- Not collected: location, identifiers, usage, diagnostics, financial info,
  everything else.

**Financial features:** Log tracks a player's own results and moves no money.
If the declaration offers a budgeting or tracking option, that is the match;
otherwise "my app doesn't provide any financial features".

**Government, health, news:** No to each.

## 6. The store listing

| Field | Value |
| --- | --- |
| Category | Finance, the same as the App Store primary |
| Short description | 80 characters. The promotional text in `SUBMISSION.md` trimmed to fit. |
| Full description | The App Store description works as written. |
| App icon | `design/play-icon-512.png` |
| Feature graphic | `design/play-feature-graphic.png` |
| Phone screenshots | At least 2, taken from the Android build in step 3 |
| Contact email | `support@log.poker` |
| Website | `https://log.poker` |

## 7. Closed testing, then production

**Not needed for Log**, which has an organization account (see step 1). For a
personal account: Testing, Closed testing, create a track,
add at least 12 testers by email or Google Group, and give them the opt-in
link. All 12 have to stay opted in for 14 days in a row. Internal testing does
not count toward this. When the 14 days are up, the Dashboard offers "Apply for
production", which asks a few questions about how the test went.

After that, a production release goes through review like any other.

## 8. Later: submitting from the command line

Once one build is in Play, `eas submit --platform android` can send the rest.
It needs a Google Cloud service account with access to the app in Play Console
(Users and permissions, invite the service account's email). Upload its JSON
key with `npx eas credentials`, Android, production. **Never put that key in
this repository**; `release.test.ts` fails if `eas.json` names one.

`eas.json` submits to the internal track as a draft, because a never-reviewed
app refuses anything else. Change the track once the app is live.

## What must stay true

Log sells nothing on Android either. Play's payments policy reads the same way
as Apple's 3.1.1: the day the app unlocks something bought at untilt.poker, it
needs Play Billing. The cross-promo links open the sister sites in the browser,
name no price and show no buy button, and that holds on Android unchanged.
