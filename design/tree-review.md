# The T-R-E-E review, from this side

The drill itself is written up in
[TiltProof's README](https://github.com/kwj777/TiltProof/blob/main/README.md#the-t-r-e-e-review),
where it will be built and where three of its four steps are already drills
that ship. [BRAND.md](../BRAND.md) records the mnemonic and rules on where it
may go: not a line, not a state, and not inside Log's fifteen second journal.

This file is the half that is Log's. What crosses the seam, what does not, and
what the journal would have to store for a review to replay a hand instead of
rhyming with one.

## What crosses, and what does not

Log's `Hand` in `src/domain/types.ts` holds the hole cards in notation, the
position, one line of note, the tags, and an optional amount. It holds **no
board, no opponent, no pot and no bet**. Every TiltProof drill needs at least
one of those: outs and equity need a board and a known hand opposite, and pot
odds needs the two numbers.

**So the review cannot replay the hand, and `drillHandOff` should stop implying
it will.** The comment in `src/features/family/hooks.ts` promises that post-MVP
the drill "opens preloaded with the spot". What it can preload is a hand class
and a position. The rest is the player's to supply on the other side.

**Which is the drill rather than the compromise.** The three things Log never
stored are the board, the range and the price, and asking for them in that
order is the review. A player who cannot reconstruct the board two days later
has learned something before the arithmetic starts, and that lesson is Log's
rather than TiltProof's.

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
answers anything outside the four modes with "No such drill".

Three ways to agree are laid out on TiltProof's side, and the recommendation
there is a `/app/review` route of its own. **The change on this side is the
same whichever wins**: `FAMILY_LINKS.tiltproof` in `src/config.ts` points at
the host while the app is served one segment in, so either the constant carries
`/app` or `drillHandOff` adds it. `src/site/__tests__/site.test.ts` pins that
constant as the host TiltProof actually serves, so it has an opinion about
which.

## What the journal would have to store

The board, the opponent's range as the player writes it, and the two numbers.
With those the review replays the hand instead of rhyming with it, and
TiltProof's roadmap already wants exactly that under **hand-history import**,
which is the same feature arriving through the family rather than through a
site's export.

**None of it should be collected at the table.** Fifteen seconds is the
product, and a hand that asks four more questions is a hand nobody logs. They
belong on the review screen after the session, which is also the only time a
player can be honest about the range.

## Open, and not decided here

- **Pricing.** [FAMILY-PRICING.md](https://github.com/kwj777/Untilt/blob/main/FAMILY-PRICING.md)
  argues the first two levels of every drill stay free. A review is not a level,
  and this file does not rule on it.
