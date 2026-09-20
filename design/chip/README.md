# The chip

The family ships one physical object and this is it: a 47mm ceramic card
protector, handed to a player at a table, with a code on the back that opens
the free app.

Untilt has its own 47mm artwork in that repo's `design/chip/`, worked out
before the family had a shared identity. It stays there as the exploration
that figured out the object and the sourcing, and it is not being ordered. Two
ceramic discs in the same gold on the same near-black is one object twice, the
setup fee is per design rather than per order, and this one does more: it
carries a scannable code, it lands on an app that is free in full, and its back
names all three apps where that one carries a domain somebody has to type.

## The files

| | |
|---|---|
| `side-1.html` | the identity face: the family mark over `log.poker`, and who it is for |
| `side-2.html` | the ask face: the mark, the code, and the three verbs |
| `proof.html` | both faces on a drawn chip with the safe circle dashed over them, for looking at and never for sending |
| `face.css` | the ground, the palette and the artboard geometry |
| `face.js` | reads `?mm=` and scales the drawing to that art diameter |
| `qr.js` | generated: the code as a bitmap, written from the campaign URL |

```bash
npm run chip          # regenerate the code, then both faces at 47mm and 43mm
```

Every PNG here is committed, and `npm run chip` rewrites all of them. Do not
edit one by hand: the faces are the source and the pictures are output, the
same arrangement as the app icons.

## The code is generated, never retyped

`scripts/make-qr.mjs` encodes `chipUrl('qr')` from `src/campaign/chip.ts`, which
is the single source of truth for a string that gets fired into a kiln. Once a
chip is printed the URL it carries cannot be edited, so it does not get to exist
in a design file and a generator's input box separately.

The two files cannot import each other, since one is `.mjs` and the other is
TypeScript, so `src/campaign/__tests__/chip.test.ts` holds them together
instead. That test does three things, and the difference between them matters:

- It asserts the generated matrix was encoded from `chipUrl('qr')`.
- It **decodes the rendered PNG** with a real scanner and asserts the payload.
  That catches a stale matrix, the wrong URL, a quiet zone eaten by the tile's
  corner radius, and a ground too light to threshold against.
- It checks the **physical module size** by arithmetic, separately, because the
  decode cannot. These artboards are 2000px, so a tile a third of its true size
  still lands five pixels per module and decodes happily while being useless on
  a disc you can hold.

At the shipped size the code is 18.4mm across on a 47mm chip, 37 modules plus
three of quiet zone on each side, so 0.43mm a module. Below about 0.4mm a phone
starts needing a second try, and a second try at a table is somebody putting
the chip back down.

Error correction is **M** rather than Q, which is the opposite of the instinct.
The tile is a fixed slice of a fixed disc, so a higher level buys recovery and
pays for it in module size: this URL is 79 bytes, which is 37x37 at M and 45x45
at Q, and Q would take the module from 0.43mm to 0.35mm. Fired ceramic does not
scuff the way a sticker does. The bigger module wins.

## What the faces say, and why in that order

The back reads **LEARN** on the left, **OBSERVE** on the right, **GROUND**
underneath. Left, right, down spells L-O-G, and side 1 says `log.poker`, so the
two faces carry the acronym and its expansion between them without either one
explaining it.

A `Be the LOG` line sat under the three words and was taken out. It was the
only element on the disc explaining the object to itself, and a thing handed to
a stranger does better showing than telling. The room went to the code taking
the exact middle of the disc and to the verbs standing clear of each other.

An earlier arrangement put GROUND on the right and OBSERVE at the bottom and
spelled L-G-O. That was cosmetic until the gold line went mixed case and then
it was a defect. GROUND takes the bottom because **the ground is the bottom**,
which decodes for anybody meeting the object cold; OBSERVE under the code only
decoded for somebody who already knew that Observe meant Log.

The back carries no wordmark of its own. The code says where to go better than a
typed URL does, and the front carries `log.poker` at full size, so the object is
not anonymous once it is off the table.

**The mark lights no ring.** An app icon turns exactly one canopy ring gold;
this disc stands for all three apps, so it lights none. That is also what stops
the object reading as one app's merchandise when it is the family's front door.

## The line on the front

`FOR THE LIVE GAME` sits under the wordmark, and it is the one thing neither
face carried. The verbs name what the three apps do and the domain names where
to get them, but nothing on the disc said what kind of poker it is about, and
the landing the code opens does not say it either: somebody scanning it cold
could read Log as an online tracker.

It is not `Be the LOG` coming back. That line pointed at the acronym the two
faces already spell, which is the disc explaining itself to itself. This one
carries something the object does not otherwise say.

**The wording is true of all three apps**, which the audience is not. `Built
for live poker players` is Log's own claim, and on a disc whose mark lights no
ring it would be a promise on behalf of two apps that do not quite keep it, the
same reason the landing qualifies its free claim as Log's. The live game is
where all three sit: the drills are for the table, the log is of a session at
one, and the meditations are for before and after it.

**It is wider than the name, and that is the floor's doing.** The vendor asks
for 1.5mm of cap and this sets at 1.54mm, which is as quiet as the line gets
before it fires as a smudge; at that size the words run 27.3mm against the
wordmark's 22.3mm. Quieter drafts were tried and every one of them was under
the floor: at 48px the line measures 0.94mm of cap. The name still leads on
weight rather than width, with two and a half times the cap height, and weight
is the part that survives a matte fire.

## Three things to check on the physical proof

None can be settled on a screen, and all three are named here so they are not
rediscovered by unwrapping a hundred chips.

**OBSERVE's margins.** It is the longest of the three verbs and it sits turned
in the narrowest channel, with its tracking already tightened to fit. Reading
order got first call on position and typography got second, which is the right
way round, and this is what that cost.

**The innermost canopy ring.** It is the quietest stroke in the mark by design.
On this ground it measures 3.0:1 against the outer ring's 7.7:1, and a matte
fire is exactly where a value that low goes from quiet to absent.

**The front line's cap.** At 1.54mm it clears the vendor's 1.5mm floor by four
hundredths of a millimeter, which is a number that means nothing until it is
fired. It is the first thing on either face to sit that close to a limit, and
the only remedy if it comes back soft is fewer words rather than smaller ones:
`LIVE GAME` holds the same cap in 15.0mm.

## What one costs

Nothing is on order yet. This is the quote, and it came from Untilt's
exploration unchanged because it is the same object from the same supplier.

Custom Made Casino / American Gaming Supply, Pro Poker ceramic. Casino quality,
47mm across and 14g, solid composition with no metal slug. Not a label or an
inlay: the image is fired into the chip rather than stuck on top of it.

| | |
|---|---|
| 100 chips | $125, and 100 is the minimum |
| Setup | $75 one-time, item `10-SETUP`, per **design** rather than per order |
| **Total** | **$200**, shipping free |
| Lead time | 3 to 5 weeks after proof approval; 10 to 14 business days for $100 more |
| Finish | matte, and only matte at 47mm |

Three things are free and worth taking: a different image on each face, text on
the edge, and the border being optional.

**Send the no-border pair.** `log-chip-47mm-side-1.png` and
`log-chip-47mm-side-2.png` are the files that go, and the art runs the whole
47mm. The 43mm pair is the same drawing inside a 2mm ring, rendered so the
choice can be looked at rather than argued about. The proof sheets go to
nobody: a guide in uploaded art is a guide on the chip.
