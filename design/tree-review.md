# The T-R-E-E review

TiltProof's side of the hand-off Log already ships. [BRAND.md](../BRAND.md)
records the mnemonic and rules on where it may go: not a line, not a state, and
not inside Log's fifteen second journal. This is the drill it becomes on the
other side of that link.

Drafted here because Log owns the seam and the hand that crosses it. It belongs
under `## The drills` in TiltProof's README once it is built, and nothing in
this file is implemented in either repo yet.

## The finding that makes it cheap

**TiltProof already ships three of the four steps.** Its `DRILL_MODES` are
`['outs', 'potOdds', 'equity', 'range']`, and three of the four letters are one
of them, in the order a hand is actually read:

| | | What runs it |
|---|---|---|
| **T** | Tell | Nothing yet. The one step with no drill behind it, and the only one Log can seed. |
| **R** | Range | The `range` drill's felt, with the range written by the player rather than handed to them. `lib/poker/range.ts` already parses `TT+`, `AQs+`, `99-66`. |
| **E** | Equity | The `equity` drill's stepped entry, over the combos the range left. `outs` instead when the hand is a draw, since that is the same estimate counted in cards. |
| **E** | Exploit | The `potOdds` drill's second half, which is already a call or a fold. |

So this is an arrangement of drills that exist plus one screen that does not,
which is the whole argument for building it. **`outs` not getting a letter is
the mapping being honest rather than being short**: outs is equity for a drawing
hand, and it substitutes at that step rather than sitting outside the shape.

## What crosses the seam, and what does not

Log's `Hand` in `src/domain/types.ts` holds the hole cards in notation, the
position, one line of note, the tags, and an optional amount. It holds **no
board, no opponent, no pot and no bet**. Every TiltProof drill needs at least
one of those: outs and equity need a board and a known hand opposite, and pot
odds needs the two numbers.

**So the review cannot replay the hand, and the design should stop implying it
will.** `drillHandOff` in `src/features/family/hooks.ts` promises that post-MVP
the drill "opens preloaded with the spot". What it can preload is a hand class
and a position. The rest is the player's to supply.

**Which is the drill rather than the compromise.** The three things Log never
stored are the board, the range and the price, and asking for them in that order
is the review. A player who cannot reconstruct the board two days later has
learned something before the arithmetic starts, and that lesson is Log's rather
than TiltProof's.

## The five screens

1. **The spot.** `AKo`, the position, the note as it was typed, the tags. Read
   only, taken off the URL, and the only screen that knows the hand was real.
2. **Tell.** What did you put them on, and what put you there? Free text, with
   the note carried across from Log so the common path is confirming a sentence
   rather than writing one. Nothing here is graded, and nothing here can be.
3. **Range.** Write it down. `lib/poker/range.ts` takes the notation players
   already write, and card removal against hero's own cards belongs on screen
   for the reason the range drill puts it there: it is the step players skip.
4. **Equity.** The stepped entry, graded by enumeration over the combos that
   survived removal. Bands as the range drill's, two points wider than the
   equity drill's, since averaging a range is a coarser instrument than reading
   one hand off the felt.
5. **Exploit.** The pot and the bet, then call or fold, graded against the
   number the player just estimated rather than against the truth of the hand.
   The question a review asks is whether the action followed from the read.

## What it must not do to the level

`difficulty.ts` moves a drill's level on the last five answers: four right moves
up, fewer than two moves down, and the window clears on every change so the next
decision uses evidence from the level the player is actually on.

**A review is not that evidence and must not enter that window.** Steps four and
five are graded against a range the player invented, so a loose range estimated
accurately scores exactly as well as a tight one, and the level would rise for
being vague. The review writes its own record under Progress and leaves
`LevelState` alone.

## The link is a dead end today, and it is shipping

`app/session/[id].tsx` renders the hand-off on a finished session, and
`active.tsx` deliberately does not, because sending a player to a training app
mid-session is the last thing Log should do. So the link is live on session
history, and this is where it goes:

| | |
|---|---|
| What Log emits | `https://tiltproof.poker/drill?hand=AKo&position=BTN&source=log` |
| What TiltProof serves | `netlify.toml` forces `/` to `soon.html`, serves the app under `/app` and `/app/*`, and catches everything else with `/*` to `soon.html` |
| Where the player lands | The coming-soon page |

The path is wrong twice over. **The app is not at the root**, and `/drill` is
not a route in either place: `app/drill/[mode].tsx` matches `/drill/<mode>` and
answers anything outside the four modes with "No such drill", so even
`/app/drill?hand=...` would miss.

Three ways to agree, in the order they deserve:

| | |
|---|---|
| **`/app/review?hand=AKo&position=BTN&source=log`** | The recommendation. A route of its own, composing the drill components that exist, which leaves `DrillMode` alone. |
| `/app/drill/range?hand=...` | The stopgap worth shipping first, since it is a URL change on Log's side alone and it lands the player on a real drill instead of a landing page. |
| A fifth `DrillMode` | Rejected. `DrillMode` is a discriminated union threaded through the generator, the seeded scenarios, the grader and the store, and a review is not a generated scenario. |

**Whichever side moves, the two repos have to agree on the base path**, and
neither has written it down. `src/config.ts` points at the host; TiltProof
serves the app one segment in.

## What this argues Log should store next

The board, the opponent's range as the player writes it, and the two numbers.
With those the review replays the hand instead of rhyming with it, and
TiltProof's roadmap already wants exactly that under **hand-history import**,
which is the same feature arriving through Log rather than through a site's
export.

**None of it should be collected at the table.** Fifteen seconds is the product,
and a hand that asks four more questions is a hand nobody logs. They belong on
the review screen after the session, which is also the only time a player can be
honest about the range.

## Open, and not decided here

- **Pricing.** [FAMILY-PRICING.md](https://github.com/kwj777/Untilt/blob/main/FAMILY-PRICING.md)
  argues the first two levels of every drill stay free. A review is not a level,
  and this file does not rule on it.
- **The domain in Log's own README.** The family table links TiltProof at
  `tiltproof.com`, while `src/config.ts` and `SYNC.md` use `tiltproof.poker` and
  a test pins the config value as the host TiltProof actually serves. One of the
  two is stale.
