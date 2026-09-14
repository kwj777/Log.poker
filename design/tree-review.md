# The T-R-E-E review, from this side

The drill itself is written up in
[TiltProof's README](https://github.com/kwj777/TiltProof/blob/main/README.md#the-t-r-e-e-review),
where it is built. [BRAND.md](../BRAND.md) records the mnemonic and rules on
where it may go: not a line, not a state, and not inside Log's fifteen second
journal.

This file is the half that is Log's. What crosses the seam, what does not, and
what the journal would have to store for a review to replay a hand instead of
rhyming with one.

## What crosses, and what does not

Log's `Hand` in `src/domain/types.ts` holds the hole cards in notation, the
board when the player recorded one, the position, one line of note, the tags,
and an optional amount. It holds **no opponent, no pot and no bet**. Most
TiltProof drills need at least one of those: equity needs a hand opposite, and
pot odds needs the two numbers.

**So the review cannot replay the hand, and nothing here should imply it will.**
What crosses is what Log actually has. The range and the price are the player's
to supply on the other side.

**Which is the review rather than the compromise.** The two things Log never
stored are the range and the price, and asking for them in that order is the
review. A player who cannot reconstruct the board two days later has learned
something before the arithmetic starts, and that lesson is Log's rather than
TiltProof's.

## Where the link goes

`app/session/[id].tsx` renders the hand-off on a finished session, and
`active.tsx` deliberately does not, because sending a player to a training app
mid-session is the last thing Log should do. So the link is live on session
history, and this is the address:

```
https://tiltproof.poker/app/review?hand=AhKs&position=BTN&source=log
```

Built by `drillHandOff` in `src/features/family/links.ts`, off the
`TILTPROOF_REVIEW` constant there.

### What it used to be, and why it never worked

| | |
|---|---|
| What Log emitted | `https://tiltproof.poker/drill?hand=AKo&position=BTN&source=log` |
| What TiltProof serves | the landing page at `/`, the app under `/app` and `/app/*`, and the app shell under a 404 for everything else |
| Where the player landed | "That page does not exist." |

**The path was wrong twice over, and fixing either half alone still left it
broken.** The app is not at the root, so `/drill` never reached it; and `/drill`
was not a route in either place, because TiltProof's only drill route is
`app/drill/[mode].tsx` and wants a mode segment that `review` is not among.

It had been broken for the whole time it shipped. Nothing caught it because
nothing could: a wrong URL raises nothing on this side and renders a 404 on the
far one. **Neither repository had the `/app` prefix written down**, which is most
of why. It is now recorded beside `FAMILY_LINKS` in `src/config.ts`, which keeps
`tiltproof` (the front door, for a cross-promo card) apart from `tiltproofApp`
(the prefix, for anything opening a screen), and pinned literally by
`src/features/family/__tests__/handOffs.test.ts`.

### The parameters

| parameter | required | what Log sends |
|---|---|---|
| `hand` | **yes** | The exact cards, `AsKd`. Omitted when the hand was logged without them, and the review then says so and stops. |
| `position` | no | The short form, with `UTG1` spelled `UTG+1` as that side reads it. |
| `board` | no | Only a whole board, three cards, four or five. Not read over there yet, and ignored rather than refused. |
| `source` | no | `log`. |
| `note` | no | **Never.** See below. |
| `tags` | no | Not sent today. |

**The exact cards rather than the class**, because Log has them and `AKo` is
twelve holdings. The suits decide card removal and decide whether a board the
player types is even legal: nobody holds `AhKs` on a board with the king of
spades in it. Sent as a class, the review has to stop and ask which twelve it
was. The class still appears in the button's label, because `AKo` is what a
person calls the hand.

**The note does not cross, and that is Log's call rather than TiltProof's.** It
is free text a player wrote about their own play, a query string lands in a
browser history and in every log that sees the URL, and the review works without
it. The same reasoning keeps the mood score out of `resetHandOff`. The test pins
the whole parameter set rather than each key, so adding one later is a decision
somebody makes rather than a default.

**Unknown parameters are ignored over there rather than refused**, which is what
makes `board` safe to send ahead of the far side reading it.

### The review is postflop only

It grades against a range the player writes on the screen, so it computes equity
live, and preflop that is 1,712,304 runouts per combination against 990 or fewer
with a board. So it asks the player to rebuild the board and will not take fewer
than three cards.

A hand Log tagged *misplayed?* that ended preflop still opens the link. The
player just cannot finish the review.

**Open:** whether `HandRow` should stop offering the hand-off on such a hand, or
word it differently. It is a question about Log's UI rather than about the URL,
and it is not decided here.

## What the journal would have to store

The opponent's range as the player writes it, and the two numbers. The board
already ships. With the rest the review replays the hand instead of rhyming with
it, and TiltProof's roadmap already wants exactly that under **hand-history
import**, which is the same feature arriving through the family rather than
through a site's export.

**None of it should be collected at the table.** Fifteen seconds is the product,
and a hand that asks four more questions is a hand nobody logs. They belong on
the review screen after the session, which is also the only time a player can be
honest about the range.

## Open, and not decided here

- **Pricing.** [FAMILY-PRICING.md](https://github.com/kwj777/Untilt/blob/main/FAMILY-PRICING.md)
  argues the first two levels of every drill stay free. A review is not a level,
  and this file does not rule on it.
