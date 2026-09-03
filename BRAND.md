# The L-O-G brand

The shared identity across the three apps, kept here because Log is the hub and
because `log.poker/chip` is the route the physical object points at. Untilt and
TiltProof consume this rather than restating it.

Written without en or em dashes, and in American spellings, because two of the
three repos enforce that in CI and copy gets lifted verbatim out of this file.

---

## The mark

Three nested triangles sharing a common baseline, standing on a trunk. Stroked,
never filled. Smallest to largest reads **Learn, Observe, Ground**, which is the
order the family is named in and the order a player moves through.

**The triangles have never changed.** Same ratio, same nesting, same shared
baseline. What changed around them, in September 2026, is the color and the
trunk.

**The canopy is one green ramp and the gold moved to the trunk.** Gold is the
family accent, so putting it on the trunk makes the mark's one warm element the
part the family is named for: the canopy is what grows, and the trunk is what
becomes the log. Brown was tried and refused at 2.66:1 on the ground, where it
read as the dimmest thing in the mark; gold is 7.22:1 and anchors it, which
matters because green is a much weaker carrier.

**And that freed gold to mean one thing, which is *this app*.** An app icon
lights exactly one ring gold and the family mark lights none, so the two can
never be mistaken for each other.

| | Lights |
|---|---|
| The family mark | Nothing. Canopy in the ramp, gold trunk only. |
| **TiltProof** | The innermost ring. Learn. |
| **Log** | The middle ring. Observe. |
| **Untilt** | The outermost ring, and the baseline with it, since a baseline is what Ground is. |

The mark is canonical on the card protector, and app icons, favicons and empty
states derive from the same geometry rather than redrawing it.

### How it is drawn

Two decisions, both made by rasterizing it rather than by looking at it, and
both now settled.

**The baseline is drawn once.** Sharing a common baseline means one line, not
three coincident ones. Stacking three bases on the same pixels stripes the line
into three colors and reads as a mistake at every size. So the outer triangle is
closed and carries the line, and the two inside it are open chevrons standing on
it. The line they stand on is gold, which is Ground, which is the point.

**The canopy ramp had to climb past sage, not below it.** The palette's own
three greens measure 1.76:1, 2.68:1 and 3.55:1 on the ground, which is one step
and a rumor: the darkest is already invisible, which is why gold used to be on
the outside at all.

| Ring | Color | On the ground | Step |
|---|---|---|---|
| Outer | `#9aae80` | **6.79:1** | |
| Middle | `#75886a` | 4.26:1 | 1.59x |
| Inner | `#55665e` | 2.68:1 | 1.59x |

Even steps, and **lightest on the outside so the silhouette is the strongest
line**, which is the same reasoning that once put gold there. Plain forest
`#3d4a44` stays what it is, a border color where 1.76:1 is correct because a
border should be quiet. It is not a stroke color on this ground.

**One measurement that looked alarming and was the wrong instrument.** Gold on
the outer ring is 1.06:1, so on paper Untilt's lit ring should vanish into its
neighbor. It does not: those two are 56 degrees apart in hue, and a contrast
ratio answers whether text is legible rather than whether one ring looks
different from the next. Warm against cool carries it at equal brightness. The
number is only the right tool for type.

## The palette

| Token | Hex | Where |
|---|---|---|
| Ground | `#1c211f` | Background, all three apps |
| Rim | `#2e3a35` | Borders |
| Ring | `#333f39` | Subtle dividers |
| Gold | `#c9a86a` | The accent. The trunk, and whichever ring an app lights |
| Sage | `#6b7a5e` | General purpose green. No longer in the mark |
| Forest | `#3d4a44` | Borders. Never a stroke on this ground, see below |
| Canopy outer | `#9aae80` | The mark's outermost ring |
| Canopy middle | `#75886a` | The mark's middle ring |
| Canopy inner | `#55665e` | The mark's innermost ring |
| Cream | `#e8e4da` | Body text |
| Muted | `#b7c0ba` / `#828e89` | Secondary and tertiary text |

Serif in the Georgia class for wordmarks and headers, a clean sans for UI.

The category is full of cluttered apps. Restraint is the differentiator, which
means the gold is worth more the less of it there is.

**The tertiary was `#7a8681` and is now `#828e89`.** It measured 4.32:1 on the
ground, under the 4.5:1 that small text needs, and it is the token Log leans on
hardest at forty-odd usages. The new value is 4.80:1 and is the smallest nudge
that clears it.

**Log implements this palette**, and `src/theme/__tests__/palette.test.ts`
parses the table above and fails if the app drifts from it. Somebody who scans
a card protector lands on `/chip` and reaches the app one tap later, and the two
being visibly different products is the thing this table exists to prevent.
Untilt and TiltProof have not been brought across yet.

---

## The line

**Be the log.**

Nothing shows on a log, and a propped one does not move. Those are two ideas
rather than one, they are both true, and between them they are the whole
family.

The pun is load-bearing rather than decorative. A log is the thing you write in
and the thing that gives nothing away, and poker supplied the rest for free,
because *the river* is already the game's word for the card that decides the
pot.

### What holds it, which turns out to be the other two apps

The obvious river line is wrong. **Logs float.** A river carries a log off,
which is what driftwood is, so anything built on a log simply outlasting a
current is bad physics that a player will spot in two seconds.

What fixes it is not a better adjective, it is the rest of the family. **A log
does not hold itself.** Propped by the math and held by the ground, it does not
go anywhere, and the river runs past it:

> **The math props it. The ground holds it. The river goes past.**

Which resolves the one thing that looked like a flaw in the whole idea. The
coinage seemed to point at the wrong app, since Log is the *Observe* app and
log-as-composure is a *Ground* idea. It does not point anywhere wrong. **Log is
the log**: the record, and the player keeping it. The other two are what stop it
being carried off.

| | | |
|---|---|---|
| **Learn** | TiltProof | the math that props it |
| **Observe** | Log | the log itself |
| **Ground** | Untilt | what holds it down |

The mark already says this, and nobody had noticed it was saying anything. A
triangle is the shape that does not deform under load, three of them share one
baseline, and the thing is braced rather than merely nested. It is a diagram of
the sentence above.

### Three true things about logs, and the third one is the argument

They are not competing images. They are the same object under three conditions,
and each one earns its keep:

| | |
|---|---|
| **A loose log is carried off** | What happens with neither of the other two apps. This is the honest starting position, not a strawman. |
| **A propped log stays put** | The math and the ground. The river runs past it. |
| **A jammed log stops the river** | Enough log, wedged right, and the water does not go anywhere at all. |

The third one is doing more work than it looks. The whole risk in this coinage
is the reading where stillness means weakness, and a log jam is the flat refusal
of that: **holding back an entire river is not inertness, it is load bearing.**
Reach for it whenever somebody objects that the log sounds passive. It is the
answer, and it is a better answer than any amount of insisting.

**But it never becomes copy.** *Jam the river* is already a poker sentence and
it means shoving all in on fifth street, which is maximum aggression and the
precise opposite action. The collision is total and it cannot be written around.
Keep the jam as reasoning, in this document and in conversation, and off every
surface.

### The rule that keeps it from meaning the opposite

English already has *sitting there like a log* and *a bump on a log*, and poker
has *calling station*, *rock* and *loose-passive*. So the bad reading of "be the
log" is *be the player who checks and calls and never does anything*, which is
the exact opposite of the intent.

Five rules hold the line on the right side of that, and the fifth is the one
that actually does the work:

| | |
|---|---|
| **Pair it with what was supposed to move it** | The current, or the provocation: the two-outer, the needle, the shown bluff. A log alone is inert. A log that did not move when something tried to move it is composed. |
| **The definite article, for the state** | "Be the log", never "be a log". A definite article implies a known archetype, which is what a coinage needs; the indefinite one is an insult. This binds only when *log* means the state or the person. In its record sense the indefinite article is correct and load bearing, which is exactly what "Keep a log. Be the log." is built on: the shift from *a* to *the* is the transformation. |
| **An instruction, not a label** | You aspire to be the log. You never call somebody a log. The moment it is applied to a person it has become a slur for a bad player. |
| **Never announced** | No copy anywhere says "we call this being the log". A coinage that explains itself is dead on arrival. Use it as though it is already a thing. |
| **A state, never a style of play** | This is the safety rail. The log describes your face and your pulse. It never describes your betting. Nothing in any app should imply that playing passively is the goal. |

### One word, three nouns

The reason the two clause lines work is that *log* is three different nouns in
this family, and a line can ride any two of them at once:

| Sense | Example |
|---|---|
| **The record** | Keep a log |
| **The app** | Get the log |
| **The state** | Be the log |
| **The logarithm** | Think in logs, and see [below](#logarithm-which-is-mostly-a-feature) |

That yields the two lines worth having, and they are not competing because they
do different jobs:

> **Keep a log. Be the log.**
> **Get the log. Be the log.**

**"Keep a log" explains. "Get the log" converts.** The first says what the
product does and turns *a* into *the*, which is the transformation the whole
idea rests on, so it is the positioning line: home page, App Store subtitle,
anywhere somebody is deciding what this is. The second puts the same article on
both halves, which makes the app and the state read as one noun, and it is a
button: the `/chip` landing, the install prompt, anywhere somebody has already
decided and needs somewhere to press.

Neither is a replacement for **Be the log** on its own, which is what goes on
the object.

### The lockup

**Be the LOG. Learn, Observe, Ground.**

This is the one to build everything else around, because it carries its own key.
Three letters do three jobs at once, the state and the app and the acronym, and
the second sentence decodes the third without ever announcing that a decoding is
happening.

Two things about the order matter. **The imperative comes first**, because it is
the half anybody will repeat and the explanation is only there for the first
reading. And **the expansion uses the canonical naming**, so the lockup binds the
new line to vocabulary the family already had rather than adding more.

**Capitalization is a lockup rule, not a prose rule.** LOG is set in capitals
only inside the lockup, and anywhere else the acronym is the point. In running
prose it is lowercase, always: *be the log*. All capitals in a sentence is
shouting, and the pun does not need volume.

This is what goes on the `/chip` landing at full size and on the about page. It
supersedes the four line adjective stack on those two surfaces, for the reason
that stack already conceded: three imperatives is dilute where one is sharp, and
this is one.

**And it changes the chip.** LEARN, OBSERVE and GROUND are already set in
capitals around the QR on the back, so a line reading *Be the LOG* in mixed case
turns those three words into its own expansion. The object teaches the acronym
without printing it twice, and mixed case is the more legible setting at 1.9mm
besides.

### The eye in the sky

Worth recording because it will come up again, and because half of it is good.

Casinos call their surveillance **the eye in the sky**, so an eye above a table
is poker's own furniture rather than only occult iconography, and Log inverts it
in a way that describes the product exactly: the eye is normally the house
watching you, and this one is you watching yourself.

**Two reasons it stays a note rather than a line.** It is spatially an argument
for putting OBSERVE at the top of the chip, which costs the acronym, and that
trade is settled above. And the nearest visual, an eye at the apex of a
triangle, is heavily loaded: it is the dollar bill, the Masonic emblem and every
conspiracy graphic since. This family's whole asset is being the poker app that
prints the helpline and takes no rake, and hanging Illuminati furniture next to
that is a strange thing to spend credibility on for a joke.

If it is used at all, it is a Log line about self-observation and never a
graphic, and it needs the inversion said out loud or it reads as surveillance
rather than as honesty.

### Logarithm, which is mostly a feature

The fourth sense is real and it is not decorative. **A bankroll is a
multiplicative process, and a logarithm is how a multiplicative process is
read.** The Kelly criterion maximizes the expected logarithm of bankroll, which
is the foundational result in the subject this app is about, and a bankroll
curve drawn on a log axis is the honest one: a $500 swing at 1/2 and the same
swing at 25/50 are one event rendered at wildly different heights on the linear
chart Log draws today.

**It still does not belong in the copy**, and it is the first sense that does
not. It yields no imperative, since *be the logarithm* is nothing. *Logarithm*
is close to the least emotional word available. And TiltProof's audience is
beginners and live players, so a logarithm on a front door excludes exactly the
people the door is for.

Where it belongs is the product, where it would make two features better rather
than one page cleverer:

| | |
|---|---|
| **A log scale on the bankroll curve** | A toggle, not a default. Proportional growth is the true shape of a roll over years, and a linear axis flatters the early sessions and terrifies during the late ones. |
| **Kelly under bankroll goals** | The roadmap already wants target roll, stop loss, and a move up prompt. Kelly is the arithmetic all three are approximating by hand, and it is the same logarithm. |

One line survives, for an advanced surface only:

> **Think in logs.**

Proportions rather than dollars. It is the discipline that stops both moving up
too fast and tilting at a number, it is meaningless to somebody in their first
month, and it belongs on the variance view or beside bankroll goals and nowhere
near the front.

**And a caution, because this is where the counting stops.** Four senses is the
edge. Three reads as found and five reads as a bit, and the moment an audience
can feel the wordplay being worked the whole thing turns from a coinage into a
pun. Nobody repeats a pun at a table. Nothing further gets added to the list
above.

### The other L-O-G

The acronym runs twice, in two registers, and the second one had been sitting
there unused:

| | The apps do the verbs | The player becomes the adjectives |
|---|---|---|
| **L** | Learn | **Log**ical |
| **O** | Observe | Observant |
| **G** | Ground | Grounded |

**The word is inside the first one.** *Logical* carries *log* in its opening
three letters, which is what makes the set read as found rather than
constructed, and it is the only one of the six that does it.

The three of them also run head, eyes, body, which is why they do not read as a
list of synonyms. Logical is the arithmetic, observant is what you watch,
grounded is what your pulse does. Three different faculties, one per app.

So they stack, and the stack is the point:

> Be logical. Be observant. Be grounded.
>
> **Be the log.**

The first three build the fourth. That is the shape for the `/chip` landing
page, which is the one surface whose whole job is to open with the philosophy at
full size, and for the about page.

**It is not the headline.** Three imperatives is dilute where one is sharp, and
the triad carries no wordplay of its own except the one buried in *logical*. It
explains **Be the log**; it does not replace it, and it should never appear
without it underneath.

**One wrinkle, flagged rather than fixed.** *Be observant* drifts. In the family
it means watch yourself, which is what Log is for; at a table it lands as watch
your opponents, which is a different virtue and a perfectly good one. The truer
word for Log is **objective**, since an honest answer to *am I running bad or
playing bad* is exactly what the variance view sells. It is refused anyway:
*objective* sits in the same cold register as *logical*, so the triad would
spend two of its three words on the same note and lose the head, eyes, body
progression that makes it work. Keep observant, and know what it is doing.

### The variants

Ranked, with where each earns its place. Two families, because the face and the
long run are different ideas and merging them is what produced the bad line in
the first place.

**The face.**

| Line | Where |
|---|---|
| **Be the log.** | The ethos. The chip, the about page, anywhere the context already supplies the provocation. |
| **A log doesn't flinch.** | The defended version, and the one to reach for wherever the passive reading is a live risk. It puts the line on the face rather than on the betting, which is the whole distinction. |
| **You can't read a log.** | The same idea from the opponent's side of the table. |
| **Two outs got there. Be the log.** | The Log hand journal, on a hand tagged *bad beat* or *cooler*. |
| **He shows the bluff. Be the log.** | The needle, which is the provocation nobody writes copy for and everybody meets. |
| **Thirty-five seconds to be the log again.** | Untilt, on the at-the-table resets. |

**The long run.**

| Line | Where |
|---|---|
| **Keep a log. Be the log.** | The positioning line. Five words, does the pun, and ties the product to the state so the wrong app problem disappears. Home page, App Store subtitle. |
| **Get the log. Be the log.** | The same device as a call to action. The install prompt, and anywhere the next thing is a press rather than a thought. |
| **Be the LOG. Learn, Observe, Ground.** | The lockup, and the primary. It carries its own key. The `/chip` landing at full size, the about page, and the back of the chip in its short form. |
| **Be logical. Be observant. Be grounded. Be the log.** | The faculties, for longer form copy rather than as a lockup. Demoted by the line above, which does the same job in nine words instead of thirteen and names the apps while it does it. Never the first three without the fourth. |
| **Think in logs.** | Proportions rather than dollars. The variance view and bankroll goals only, and never the front door. |
| **The math props it. The ground holds it. The river goes past.** | The full statement, and the only place all three apps are in one sentence. The `/chip` landing page and the about page, where there is room to land it. |
| **Nothing carries off a propped log.** | The compressed cut. |
| **Ground the log.** | Two words, and it names Untilt's verb. The Log to Untilt hand-off on the variance view. |
| **The river hit him. Nothing hit you.** | Session end in Log, after a losing session inside the confidence band. |
| **Logged. Now be the log.** | The save confirmation on a hand or a session. Says what happened and what to do next. |
| **Know the math. Be the log.** | TiltProof. Keeps that app's existing two-clause shape and swaps the family line into the second half. |

### What not to say

**"Log face" is out.** Three reasons, escalating. It is a derivative
construction, so it arrives sounding like a lesser version of *poker face*. It
is a noun pointed at a person, which makes it an insult by default. And *log*
is also a turd, which at a poker table gets that joke inside a week and never
stops. "Be the log" survives on the aspirational verb frame; two syllables
aimed at somebody's face does not.

**"Don't be a log"** flips the whole thing into the passive-player reading. Never.

**"Jam the river", and every cut of it.** True about logs, unusable in poker,
where jamming a river is shoving all in. See [Three true things about
logs](#three-true-things-about-logs-and-the-third-one-is-the-argument).

**Anything resting on a log outlasting a current unaided.** Logs float. If the
current is in the sentence, so is whatever is holding the log, or the sentence
is conceding the drift on purpose.

---

## The chip

**There is one, and it is this one.** Untilt has its own 47mm ceramic artwork in
`design/chip/`, worked out before the family had a shared identity. It stays as
exploration and is not being ordered: two ceramic discs in the same gold on the
same near-black is one object twice, the setup fee is per design rather than per
order, and this one does more work, since it carries a scannable code, lands on
the free app, and names all three apps on its back.

The sourcing from that exploration transfers unchanged, because it is the same
object from the same supplier, and it is the only part of this whose numbers are
somebody else's:

| | |
|---|---|
| The chip | Custom Made Casino / American Gaming Supply, Pro Poker ceramic. 47mm, 14g, no metal slug, fired rather than a stuck-on inlay. |
| 100 chips | $125, and 100 is the minimum |
| Setup | $75 one-time, per **design** rather than per order |
| **Total** | **$200**, shipping free |
| Lead time | 3 to 5 weeks after proof approval |
| Finish | Matte, and only matte at 47mm |

Free and worth taking: a different image on each face, text on the edge, and the
border being optional. The per-design setup is the line item that settled one
chip rather than two.

## Where the line goes on the chip

The back is already full: mark at the top, QR on a cream tile at the center,
two words in the side channels, one under the QR, and the `log.poker` wordmark
in gold beneath it. Something has to give.

**And the words were in the wrong places.** With LEARN on the left, GROUND on
the right and OBSERVE underneath, a left, right, down scan reads *Learn,
Ground, Observe*. That was cosmetic until the gold line went mixed case, and
then it was a defect: **Be the LOG** points at those three words, and they were
spelling L-G-O.

So **OBSERVE and GROUND swap**. GROUND takes the bottom, because **the ground is
the bottom**, which is decodable by anybody holding the chip for the first time.
The placement it replaces, OBSERVE under the QR because the QR is what opens
Log, only decodes for somebody who already knows that Observe means Log, and
that is nobody meeting the object cold.

The cost is real and worth naming: OBSERVE is the longest of the three words and
it now sits in the narrowest slot, at about 1.5mm of margin with its tracking
tightened. Reading order gets first call on position and typography gets second,
which is the right way round here, and OBSERVE's margins are the first thing to
check on a printed proof.

**A version that was considered and refused.** OBSERVE at the top reads well and
is spatially true, since observing happens from above, and it lands near the
casino's own name for the thing that watches a room. It puts O first. The face
would spell O-L-G, which breaks the mechanism this whole section exists to
protect, so it loses on the one criterion that is not aesthetic. See [The eye in
the sky](#the-eye-in-the-sky) for the part of it worth keeping.

**Then give the wordmark.** `Be the LOG` takes its slot, in gold, at the same ~1.9mm
cap height, and stays the second-loudest element after the QR. Mixed case rather
than all capitals, so that LOG picks up the three words already set around the
QR and the face expands its own acronym.

The wordmark's job on the back was to say where to go, and the QR two
millimeters above it already does that better and more accurately: nobody types
a URL off a card protector when there is a code right there. The front still
carries `log.poker` at full size, so the object is not anonymous. That trade
buys the back's most valuable line: the one that makes somebody want to scan at
all.

It fits with room. At that position the inner ring leaves about 35mm of channel,
and `Be the LOG` letterspaced at 1.9mm cap sets to roughly 17mm. Everything on
the face stays above the 1.5mm floor.

The alternate, if the wordmark has to stay: put the line on the **front**, below
the wordmark, at 1.6mm. It is quieter and it costs a second reading of the
object, since the front is the face somebody sees first and the line lands
better after the QR has been scanned.

---

## Open items

~~**1. The mark's color order is specified two ways.**~~ **Settled.** Gold
outermost, sage in the middle, lifted forest innermost, which is the original
brief's order. See [How it is drawn](#how-it-is-drawn) for the measurement that
decided it.

~~**2. Forest on Ground is close to invisible.**~~ **Settled, and it was not a
chip-only problem.** It bit the app icon first, at 1.76:1, and the fix is one
value rather than a per-surface deviation: the mark's inner stroke is `#55665e`
and plain forest stays a border color.

~~**3. There are two golds.**~~ **Settled, and it went this way.** Untilt moved
to `#c9a86a` across all 39 files that carried the old one, and its own notes had
already argued for it: the chip's design README asks for a dull antique rather
than a bright yellow, and this is that. It reads better on Untilt's felt too,
8.20:1 against 7.66:1.

Three things in that repo would have shipped broken from a search and replace,
and they are worth knowing because two of them generalize. The five legal pages
share one inline style block admitted by a single CSP hash, so a color change
unstyles them in production with no error anywhere. The social card's test
identifies the mark by pixel range and its blue ceiling fitted only the old
gold. And the iOS app icon was a hand copied duplicate that nothing kept in
sync, so it drifted the moment the color moved. **Anywhere a color is pinned by
a hash, a pixel test, or a copy, it is not one edit.**

**One remains.**

**Empty states have no mark.** This document says app icons, favicons and empty
states all derive from the same geometry. The first two do now. Log's
`EmptyState` is type only, and giving it the mark means a drawn component and
therefore a dependency the app does not have, which is a decision rather than a
transcription.

---

## What is aligned, and what is not

The gold is now one color in all three apps. Nothing else is.

| | Ground | Accent | Mark |
|---|---|---|---|
| **Log** | `#1c211f` | `#c9a86a` | The nested triangles |
| **Untilt** | `#0d1512` | `#c9a86a` | A chip on water |
| **TiltProof** | `#0B100E` | not yet | not yet |

Untilt's ground and mark are its own and were never claimed by this document.
Whether they come across is a larger question than a hex swap, on a product that
is selling, and it should be asked as a question rather than answered by a
migration.
