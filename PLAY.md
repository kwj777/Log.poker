# Getting Log onto Google Play

The Android build is configured in this repository. What is left needs a Google
Play developer account, a real Android phone, and a series of forms in Play
Console. This file is that list, in the order it has to happen. `SUBMISSION.md`
is the App Store version of the same thing, and where an answer is the same on
both stores this file points there rather than repeating it.

Every step was checked against Google's own help pages on 2026-10-08. Play
Console's menus move, so where a label below no longer matches, the Dashboard's
setup tasks link to the same forms.

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
| Build for screenshots | `screenshots` profile: an APK with Settings, Load demo data |
| Submit target | `submit.production.android`: the internal testing track, as a draft |
| Privacy policy, account deletion | `https://log.poker/privacy`, whose `#delete` section works without the app, and Settings in the app |

All of it is asserted in `src/__tests__/release.test.ts` and
`src/site/__tests__/privacy.test.ts`.

Android backup is left on deliberately. Google's own backup restores the SQLite
log onto a new phone, which is the only way a player's history moves without an
account. The sign-in token and sync cursors are in the keystore, which does not
restore; both stores already treat an unreadable value as empty, so a restored
phone simply asks to sign in again.

---

## 1. The developer account

**Done** (Kevin, 2026-10-08), as an organization.

Sign up at play.google.com/console/signup with the Google account that should
own the app. There is a one-time $25 fee and an identity check.

**Personal or organization matters more than it looks.** A personal account
created after 13 November 2023 cannot publish to production until it has run a
closed test with at least 12 testers opted in for 14 days in a row (step 8). An
organization account skips that, but needs more to sign up:

- A D-U-N-S number, with the legal name and address entered exactly as Dun &
  Bradstreet holds them. A mismatch is the usual cause of a stalled
  verification, and a later one can get apps removed.
- The organization's website, verified in Google Search Console by the same
  Google account that owns the Play account.
- A private contact email on the website's domain, and a public developer email
  and phone, each confirmed with a code.
- A photo ID for the person signing up, and one document showing the legal
  name, such as an IRS letter or a certificate of incorporation.

**Log went the organization route** (Kevin, 2026-10-01: the business has a
D-U-N-S number, 14-582-9145). The organization name is the developer name the
Play listing shows. Apps can be created and a release prepared while Google
verifies the account; nothing can be sent for review until it is verified.

## 2. The app record

**Done** (Kevin, 2026-10-08).

Play Console, Home, Create app:

| Field | Value |
| --- | --- |
| App name | `Log: Poker Session Tracker`, the same name as the App Store (26 of Play's 30 characters). Log tracks sessions, not a bankroll, so the name says so. |
| Default language | English (United States) |
| Package name | `poker.log.app`, if the form asks for it. It must match `android.package` in `app.json`, and it can never change. |
| App or game | App |
| Free or paid | Free. This cannot be changed to paid later. |
| Contact email | `support@log.poker` |
| Declarations | Developer Program Policies, US export laws, and the Play App Signing terms. All three have to be ticked before Create app works. |

## 3. Install it on a phone first

**Done** (Kevin, 2026-10-08, on a Moto G Play and the emulator).

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
- The status and navigation bars, since Android 15 and later draw the app edge
  to edge, and phones with three buttons draw a bar behind them.
- Sign in with a mailed code, sync with another device, then delete the account.
- The icon on the home screen, including with themed icons switched on.

## 4. The first store build, on internal testing

**Done** (Kevin, 2026-10-08): version code 2 on internal testing, installed
from Play on his Moto G Play.

```
npx eas build --platform android --profile production
```

This writes a new `android.versionCode` into `app.json`, the same way iOS
writes its build number. Commit it after every production build, or the next
one reuses a code Play already has and is refused. The `.aab` it makes is for
Play only; it does not install on a phone the way the APK does.

**Upload the first one by hand.** Google's API documentation says an app's
first build has to go in through Play Console, though Expo's now says
`eas submit` can do it. The manual upload works either way and needs no
service account yet. Download the `.aab` from expo.dev, then:

1. Test and release, Testing, Internal testing.
2. Testers tab: Create email list, add the Google account signed in to the
   Play Store on the test phone, save, tick the list, enter
   `support@log.poker` as the feedback address, Save changes.
3. Create new release. New apps are enrolled in Play App Signing with a key
   Google generates, and the EAS keystore becomes the upload key. If asked,
   keep Google's key; never use "Change app signing key".
4. Drop the `.aab` into App bundles and check it says `poker.log.app`. Put a
   line of release notes between the `<en-US>` tags.
5. Next, then Start rollout to Internal testing (Expo's guide shows the button
   as Save and publish). Warnings do not block; errors do.
6. Publishing overview: if anything is listed as not yet sent for review,
   Send for review.

**Do this before finishing steps 5 and 6.** Once an app is fully set up, its
first internal release is reviewed, which can take days. While it is not, the
first internal release reaches testers without that review.

**Then install it from Play.** The APK from step 3 is signed with the upload
key and the Play build with Google's, so Play cannot install over it. Uninstall
the APK first, which deletes the log on that phone: export a CSV or sign in and
sync beforehand if it matters. The opt-in link is on the Testers tab, once the app
is out of Draft, and it can take a few
hours to appear. Open it on the phone, accept, and install. The listing can
show a temporary name for up to 48 hours. That is the first time the app
arrives the way a player's will.

## 5. App content

**Done** (Kevin, 2026-10-08), with the answers below.

Monitor and improve, Policy and programs, App content (older help pages say
Policy, App content; it is the same page). Every answer below is what the code
does; the reasoning is the same as the App Privacy section of `SUBMISSION.md`.

**Privacy policy:** `https://log.poker/privacy`

**Ads:** No, my app does not contain ads.

**App access** (Google now calls it Sign-in details): choose that all or some
functionality is restricted, because sync sits behind a sign-in, and add one
set of instructions. There is no username or password to give, so the
instructions carry the same explanation as the App Review notes in
`SUBMISSION.md`:

```
Every feature works signed out. Sign-in is optional and only carries the log
to the player's other devices. To try it: Settings, "Your other devices",
enter any email address you can read. A six character code is mailed to it and
works for fifteen minutes. There are no accounts and no stored addresses, so
there is no test account to supply.
```

Google's help asks apps whose sign-in uses a one-time code for credentials
that skip the code. Log has none, because there are no accounts to make one
for. If review comes back asking for them, the fix is a reviewer bypass in
code, which is a decision to make then rather than now.

**Content rating** (the IARC questionnaire). The first screen asks for an email
address IARC will write to; use `support@log.poker`. The category is **All
Other App Types** (the other two are Game, and Social or Communication); then
answer each question as written. The App Store's answers carry over for the
same reason (see Age rating in `SUBMISSION.md`):

| Question | Answer |
| --- | --- |
| Anything asking whether the app references, depicts or is about gambling | **Yes** |
| Simulated gambling | No |
| Real-money gambling or wagering in the app | **No, never.** A Yes here rates the app Adults Only and puts it under Play's gambling app rules, with a license to show. |
| Users interact or share content with each other | No |
| Shares the user's location | No |
| Digital purchases | No |

To change an answer later, Content rating, Start new questionnaire.

**Advertising ID:** No. Log has no ads or analytics, and no library in it
requests `com.google.android.gms.permission.AD_ID`; adding one that does means
changing this answer. Play blocks any rollout targeting Android 13 or later
until it is answered, so it can also turn up from Publishing overview.

**Target audience:** 18 and over only, and tick Restrict Minor Access, which
keeps the app from users Google identifies as under 18. It is optional for Log,
and it matches the privacy policy's "not intended for anybody under 18". The
privacy policy, ads and app access answers have to be saved first.

**Data safety:**

- Does the app collect or share user data: Yes. Encrypted in transit: Yes.
  Can users create an account: Yes, by a code mailed to their address.
- **Email address**: collected, not shared, not processed ephemerally,
  optional (only when the player signs in). Purposes: App functionality and
  Account management.
- **Other user-generated content**: collected, not shared, not processed
  ephemerally, optional. Purpose: App functionality. This is the synced log.
- Netlify and Resend are service providers, which the form does not count as
  sharing.
- Not collected: location, identifiers, usage, diagnostics, financial info,
  everything else. The log holds buy-ins and results, which the App Store
  answer files under user content rather than financial info; keep the two
  stores the same.
- Delete account URL: `https://log.poker/privacy#delete`. Google wants a page a
  player can use without reinstalling the app, naming the app as the listing
  does. That section names `Log: Poker Session Tracker` and gives the browser
  route: log.poker/app/settings, sign in, "Delete your account and its data".
- Check the preview at the end shows the data as optional and not shared, then
  Submit.

**Financial features:** My app doesn't provide any financial features, then
Next, then Save. None of the options fit a tracker that moves no money.

**Health apps:** My app doesn't provide any health features, then Next, then
Save. The mood check-ins are part of a poker record, not a stress management
feature.

**Government apps:** No. **COVID-19 contact tracing and status apps:** neither,
then Save changes. **News and magazine apps:** only asked of apps in that
category, so Log is not.

## 6. The store listing

**Done** (Kevin, 2026-10-08).

Two pages, both under Grow users, Store presence, and both need saving.

**Main store listing:**

| Field | Value |
| --- | --- |
| App name | `Log: Poker Session Tracker` |
| Short description | 80 characters, with no price words. Play's guidance keeps "free", "best", "#1" and the like out of this field, so the App Store's promotional text cannot be trimmed into it. |
| Full description | The App Store description, with each paragraph joined onto one line, because Play keeps the line breaks. Leave out the sentences about price: Play shows Free on the listing itself, and its guidance keeps price wording out of the listing text. |
| App icon | `design/play-icon-512.png`. Google's spec says 32-bit PNG and this one is 24-bit; if the upload is refused, it needs an alpha channel added, fully opaque. |
| Feature graphic | `design/play-feature-graphic.png` |
| Phone screenshots | At least 2, and 4 or more at 1080 pixels or wider to be eligible for Play's recommendations. See below. |
| Tablet screenshots | None. Log is a portrait phone app, and these are optional. |

**Screenshots** want a log with sessions in it, which only the `screenshots`
profile can show (the reasoning is in `SUBMISSION.md`):

```
npx eas build --platform android --profile screenshots
```

It builds an APK with Settings, Load demo data. Loading it resets the log, so
run it on the emulator rather than a phone with a real log, and sign out
first. Take the same five screens as on iOS. Play refuses any screenshot whose
long side is more than twice its short side, and every current phone is
taller than that (1080 by 2400 is 2.22 to 1), so each one has to be cropped or
padded to fit before upload, as RGB with no alpha channel. Padding by
repeating the edge pixels leaves no visible border, because every screen's
edges are flat bands of the background and tab bar (ImageMagick 7):

```
magick shot.png -alpha off -set option:distort:viewport 1200x2400-60+0 \
  -virtual-pixel edge -filter point -distort SRT 0 +repage \
  -define png:color-type=2 shot-play.png
```

The 1080 pixels in the middle come out unchanged. Give each one alt text that
does not start with "image of".

**AI asset declaration**, on the listing's Review step: **Don't label assets**.
Google asks for a label on images and video "you deem to be in scope for the
regulations" (Play Console Help, Declaring AI-generated content). The icon and
feature graphic are drawn by scripts in this repository and no generative
model made their pixels, the screenshots are real captures, and listing copy
is outside the EU AI Act's rule on AI text. A label would put an AI mark on
them for players in the EU and India. Any asset that ever passes through an
image generator, AI upscaling or Play Console's own Gemini tools needs
reassessing.

**Store settings:**

| Field | Value |
| --- | --- |
| Category | Finance, the same as the App Store primary. Play takes one category. |
| Tags | Up to five, under Manage tags. They do the job the App Store's second category (Sports) does. |
| Contact email | `support@log.poker` |
| Website | `https://log.poker` |
| Phone | Optional here. The organization's public developer phone already shows on its developer page. |

Saving publishes nothing. Listing and settings changes wait on Publishing
overview until Send for review.

## 7. Production

**Sent for review** (Kevin, 2026-10-08): version code 2, all countries and
regions.

**Live in production** (confirmed by Kevin, 2026-10-24). That same day
Google's "Get it on Google Play" badge went up beside Apple's under "Get the
log" on the front door and the blog index, linking to
`https://play.google.com/store/apps/details?id=poker.log.app`. The package
lives once in `scripts/pages.mjs`, and `site.test.ts` holds it to `app.json`.
There is no Android counterpart to Safari's smart banner: Chrome's
`related_applications` lives in the web manifest, which belongs to the app
under `/app`.

An organization account goes from internal testing straight to production.
If the Dashboard ever asks for a closed test or offers Apply for production,
the account has been set up as personal; stop and check it rather than work
around it.

1. Finish every task on the Dashboard. Until then, Create new release on
   Production stays grayed out.
2. Production, Countries or regions, Add countries or regions, choose them,
   confirm. Testing tracks follow the production list unless set otherwise.
3. Production, Create new release, Add from library, and pick the bundle
   already on internal testing. Release notes between the `<en-US>` tags, 500
   characters at most.
4. Next, then Start rollout to Production.
5. Publishing overview, Send for review. Pre-review checks can stop it with
   critical issues, usually a missing App content answer; View issues says
   which.

Review takes anything from hours to seven days or more, and sending another
change while it runs can put the app back in the queue. **The app goes live
the moment it is approved**, because managed publishing cannot hold an app's
first publish, so the listing, log.poker and the support address all have to be
final before step 5.

## 8. Closed testing, for a personal account only

**Not needed for Log**, which has an organization account (see step 1). For a
personal account: Testing, Closed testing, create a track, add at least 12
testers by email or Google Group, and give them the opt-in link. All 12 have to
stay opted in for 14 days in a row. Internal testing does not count toward
this. When the 14 days are up, the Dashboard offers Apply for production, which
asks about the test, the app and its readiness, and is usually answered within
seven days.

## 9. Later: submitting from the command line

Once the app is published, `eas submit --platform android` can send the rest.
It needs a Google Cloud service account:

1. In Google Cloud, enable the Google Play Android Developer API, create a
   service account, then Keys, Add key, JSON. The key downloads once. If the
   Google account belongs to a Workspace organization made after May 2024, an
   organization policy may block key creation until an admin exempts the
   project.
2. In Play Console, Users and permissions, invite the service account's email,
   and on App permissions add Log with: view app information, edit and delete
   draft apps, release to production, release to testing tracks, manage
   testing tracks and tester lists, and manage store presence. Nothing admin
   or financial.
3. `npx eas credentials --platform android`, production, Google Service
   Account, upload the key. **Never put that key in this repository**;
   `release.test.ts` fails if `eas.json` names one.

`eas.json` submits to the internal track as a draft, because an app that has
never been published only accepts drafts. A draft is not served to anyone, so
every `eas submit` still ends in Play Console, rolling the release out by hand.
Once the app is live, either keep drafts (and add each release's notes in Play
Console, since `eas submit` has no field for them) or switch to
`releaseStatus: "completed"`, which sends straight to review with no notes.
Either way, update the assertion in `release.test.ts`. Never run a submit while
a review is in progress: it cancels the review and starts it again.

## 10. Android vitals

What Play Console's Android vitals said about release 2 (1.0.0) in November
2026, and what was done about each.

- **DEX code optimization below threshold (1% obfuscation, fix by February
  2027).** R8 was off, which is Expo's default. `expo-build-properties` now
  turns on `enableMinifyInReleaseBuilds` and
  `enableShrinkResourcesInReleaseBuilds`. It touches only the Java and Kotlin
  side; the JavaScript bundle, and with it sign-in and the pass, is unchanged.
  The mapping file travels inside the App Bundle, so crash reports stay
  readable. What R8 can break is a native class looked up by name, which only
  shows on a device: open every tab, log a session, import and export a CSV,
  and sign in, on the release build, before it goes to production.
- **Orientation and resizability restrictions.** The manifest's portrait lock
  is gone on Android (`plugins/withAndroidAnyOrientation.js`). Phones are
  still upright from the first frame: the same plugin has MainActivity ask
  for portrait in code when the smallest width is under 600dp, and
  `src/orientation.android.ts` keeps that true as a foldable opens and
  closes. Tablets, open foldables and Chromebooks turn. iOS is unchanged.
- **Deprecated edge-to-edge APIs.** Nothing in Log calls them. The calls Play
  finds are in libraries Log links: React Native's own edge-to-edge setup
  (`WindowUtil`, `StatusBarModule`), `expo-navigation-bar` (below Android 10
  only), and AndroidX and Material Components, which React Native Screens
  and Expo Router bring in. On Android 15 and later those calls do nothing.
  It is a recommendation, not a requirement, and it will not clear while
  those libraries are linked; nothing on Log's side is worth changing for it.

## What must stay true

Log sells nothing on Android either. Play's payments policy reads the same way
as Apple's 3.1.1: the day the app unlocks something bought at untilt.poker, it
needs Play Billing. The cross-promo links open the sister sites in the browser,
name no price and show no buy button, and that holds on Android unchanged.

Log records poker; it never takes, holds or moves a wager. No gambling
declaration is needed while that holds. It must never carry a call to bet,
an ad for real-money play, or a link to a gambling operator, and the sister
sites it links to must never become one.
