/**
 * Hand histories to read, one or two per site.
 *
 * The PokerStars, Winamax, 888poker and partypoker hands are real hands from
 * the sample set of HHSmithy's PokerHandHistoryParser (MIT licensed), with the
 * player names replaced. Most of those samples were saved by an observer, so
 * where a hand needed a hero a `Dealt to` line has been added in the place the
 * site puts it; the note above each says so.
 *
 * The GGPoker, ACR and PokerStars play-money hands are written here in each
 * site's layout, because no public sample of them was to hand. They are the
 * ones to check first against a real file.
 */

/** Real hand, its bracketed Eastern time corrected to agree with the CET one. Hero folds the small blind. */
export const STARS_HERO_FOLDS = `PokerStars Hand #1846552153:  Hold'em No Limit (€1/€2 EUR) - 2013/03/08 18:14:22 CET [2013/03/08 12:14:22 ET]
Table 'Brunk V' 6-max Seat #1 is the button
Seat 1: Player1 (€289.57 in chips)
Seat 2: PS_Hero (€198 in chips)
Seat 3: Player3 (€222.59 in chips)
Seat 4: Player4 (€200 in chips)
Seat 5: Player5 (€208.02 in chips)
Seat 6: Player6 (€258.54 in chips)
PS_Hero: posts small blind €1
Player3: posts big blind €2
*** HOLE CARDS ***
Dealt to PS_Hero [4s 7h]
Player4: folds
Player5: folds
Player6: raises €4 to €6
Player1: calls €6
PS_Hero: folds
Player3: folds
*** FLOP *** [6d 7c 6h]
Player3 leaves the table
Player6: bets €11
Player1: calls €11
*** TURN *** [6d 7c 6h] [2s]
Player6: checks
Player1: checks
*** RIVER *** [6d 7c 6h 2s] [Qc]
Player6: checks
Player1: checks
*** SHOW DOWN ***
Player6: shows [As 9d] (a pair of Sixes)
Player1: shows [Ah Jh] (a pair of Sixes - Ace+Queen+Jack kicker)
Player1 collected €34.60 from pot
*** SUMMARY ***
Total pot €37 | Rake €2.40
Board [6d 7c 6h 2s Qc]
Seat 1: Player1 (button) showed [Ah Jh] and won (€34.60) with a pair of Sixes
Seat 2: PS_Hero (small blind) folded before Flop
Seat 3: Player3 (big blind) folded before Flop
Seat 4: Player4 folded before Flop (didn't bet)
Seat 5: Player5 folded before Flop (didn't bet)
Seat 6: Player6 showed [As 9d] and lost with a pair of Sixes`;

/**
 * Real hand, with a `Dealt to` line added for the small blind. Antes, a
 * three-bet, and a stack all in on the flop and called.
 */
export const STARS_ALL_IN = `PokerStars Game #109688230087:  Hold'em No Limit ($0.05/$0.10 USD) - 2014/01/06 10:23:24 ET
Table 'Skat III 100-250 bb, Ante' 6-max Seat #3 is the button
Seat 2: Alder ($15 in chips)
Seat 3: Birch ($12.26 in chips)
Seat 4: Hero ($38.74 in chips)
Seat 5: Cedar ($21.06 in chips)
Seat 6: Dogwood ($10.21 in chips)
Hero: posts small blind $0.05
Cedar: posts big blind $0.10
Alder: posts the ante $0.02
Birch: posts the ante $0.02
Hero: posts the ante $0.02
Cedar: posts the ante $0.02
Dogwood: posts the ante $0.02
*** HOLE CARDS ***
Dealt to Hero [Ah Ks]
Dogwood: folds
Alder: folds
Birch: raises $0.20 to $0.30
Hero: raises $1 to $1.30
Cedar: folds
Birch: calls $1
*** FLOP *** [5c 4c 4h]
Hero: bets $2
Birch: raises $8.94 to $10.94 and is all-in
Hero: calls $8.94
*** TURN *** [5c 4c 4h] [Qs]
*** RIVER *** [5c 4c 4h Qs] [Kc]
*** SHOW DOWN ***
Hero: shows [Ah Ks] (two pair, Kings and Fours)
Birch: shows [8h 8c] (two pair, Eights and Fours)
Hero collected $23.57 from pot
*** SUMMARY ***
Total pot $24.68 | Rake $1.11
Board [5c 4c 4h Qs Kc]
Seat 2: Alder folded before Flop (didn't bet)
Seat 3: Birch (button) showed [8h 8c] and lost with two pair, Eights and Fours
Seat 4: Hero (small blind) showed [Ah Ks] and won ($23.57) with two pair, Kings and Fours
Seat 5: Cedar (big blind) folded before Flop
Seat 6: Dogwood folded before Flop (didn't bet)`;

/** Written here. Play money: a set of queens, an uncalled shove handed back. */
export const STARS_PLAY_MONEY = `PokerStars Hand #250000000001:  Hold'em No Limit (25/50) - 2026/09/23 14:02:11 CEST [2026/09/23 8:02:11 ET]
Table 'Aludra II' 6-max (Play Money) Seat #1 is the button
Seat 1: Villain1 (5000 in chips)
Seat 2: KevinW (5000 in chips)
Seat 3: Villain2 (4250 in chips)
KevinW: posts small blind 25
Villain2: posts big blind 50
*** HOLE CARDS ***
Dealt to KevinW [Qs Qd]
Villain1: folds
KevinW: raises 100 to 150
Villain2: calls 100
*** FLOP *** [Qh 7c 2d]
KevinW: bets 200
Villain2: raises 800 to 1000
KevinW: raises 3850 to 4850 and is all-in
Villain2: calls 3100 and is all-in
Uncalled bet (750) returned to KevinW
*** TURN *** [Qh 7c 2d] [5s]
*** RIVER *** [Qh 7c 2d 5s] [9h]
*** SHOW DOWN ***
KevinW: shows [Qs Qd] (three of a kind, Queens)
Villain2: shows [Ah Ad] (a pair of Aces)
KevinW collected 8500 from pot
*** SUMMARY ***
Total pot 8500 | Rake 0
Board [Qh 7c 2d 5s 9h]
Seat 1: Villain1 (button) folded before Flop (didn't bet)
Seat 2: KevinW (small blind) showed [Qs Qd] and won (8500) with three of a kind, Queens
Seat 3: Villain2 (big blind) showed [Ah Ad] and lost with a pair of Aces`;

/** Written here. The next play-money hand at the same table, a small one. */
export const STARS_PLAY_MONEY_SMALL = `PokerStars Hand #250000000002:  Hold'em No Limit (25/50) - 2026/09/23 14:03:40 CEST [2026/09/23 8:03:40 ET]
Table 'Aludra II' 6-max (Play Money) Seat #2 is the button
Seat 1: Villain1 (5000 in chips)
Seat 2: KevinW (9250 in chips)
Seat 3: Villain2 (5000 in chips)
Villain2: posts small blind 25
Villain1: posts big blind 50
*** HOLE CARDS ***
Dealt to KevinW [7s 2d]
KevinW: folds
Villain2: calls 25
Villain1: checks
*** FLOP *** [Kh 8c 3d]
Villain2: checks
Villain1: bets 50
Villain2: folds
Uncalled bet (50) returned to Villain1
Villain1 collected 100 from pot
*** SUMMARY ***
Total pot 100 | Rake 0
Board [Kh 8c 3d]
Seat 1: Villain1 (big blind) collected (100)
Seat 2: KevinW (button) folded before Flop (didn't bet)
Seat 3: Villain2 (small blind) folded on the Flop`;

/** Written here, in GGPoker's layout. No time zone on the header. */
export const GG_RUSH = `Poker Hand #RC2000000001: Hold'em No Limit ($0.02/$0.05) - 2026/09/23 18:30:00
Table 'RushAndCash12345' 6-max Seat #3 is the button
Seat 1: 1a2b3c ($5 in chips)
Seat 2: Hero ($5.12 in chips)
Seat 3: 9f8e7d ($4.80 in chips)
Seat 4: aa11bb ($6 in chips)
aa11bb: posts small blind $0.02
1a2b3c: posts big blind $0.05
*** HOLE CARDS ***
Dealt to 1a2b3c
Dealt to Hero [Ah Kh]
Dealt to 9f8e7d
Dealt to aa11bb
Hero: raises $0.10 to $0.15
9f8e7d: folds
aa11bb: folds
1a2b3c: calls $0.10
*** FLOP *** [Kd 7s 2h]
1a2b3c: checks
Hero: bets $0.20
1a2b3c: folds
Uncalled bet ($0.20) returned to Hero
*** SHOWDOWN ***
Hero collected $0.31 from pot
*** SUMMARY ***
Total pot $0.32 | Rake $0.01 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Board [Kd 7s 2h]
Seat 1: 1a2b3c (big blind) folded on the Flop
Seat 2: Hero won ($0.31)
Seat 3: 9f8e7d (button) folded before Flop
Seat 4: aa11bb (small blind) folded before Flop`;

/** Written here, in ACR's layout: blinds between dashes, no colons after names. */
export const ACR_SET = `Hand #2046271553 - Holdem (No Limit) - $0.05/$0.10 - 2026/09/23 01:15:42 UTC
Table 'Aurora' 6-max Seat #1 is the button
Seat 1: Hero ($10.00)
Seat 2: fish1 ($12.40)
Seat 3: reg2 ($9.00)
fish1 posts the small blind $0.05
reg2 posts the big blind $0.10
*** HOLE CARDS ***
Main pot $0.15 | Rake $0.00
Dealt to Hero [Td Th]
Hero raises $0.30 to $0.30
fish1 folds
reg2 raises $0.90 to $1.20
Hero calls $0.90
*** FLOP *** [Ts 4c 4d]
Main pot $2.45 | Rake $0.00
reg2 bets $1.50
Hero raises $7.30 to $8.80 and is all-in
reg2 calls $6.30 and is all-in
Uncalled bet ($1.00) returned to Hero
*** TURN *** [Ts 4c 4d] [2s]
*** RIVER *** [Ts 4c 4d 2s] [9h]
*** SHOW DOWN ***
Hero shows [Td Th] (a full house, Tens full of Fours)
reg2 shows [Ac Ad] (two pair, Aces and Fours)
Hero collected $17.60 from main pot
*** SUMMARY ***
Total pot $18.05 | Rake $0.45
Board [Ts 4c 4d 2s 9h]
Seat 1: Hero (button) showed [Td Th] and won $17.60 with a full house
Seat 2: fish1 (small blind) folded before the Flop
Seat 3: reg2 (big blind) showed [Ac Ad] and lost`;

/** Real hand, with a `Dealt to` line added for the three-bettor who wins it. */
export const WINAMAX_ALL_IN = `Winamax Poker - CashGame - HandId: #5343878-96-1383820687 - Holdem no limit (0.25€/0.50€) - 2013/11/07 10:38:07 UTC
Table: 'Athens 11' 5-max (real money) Seat #4 is the button
Seat 1: Elm (67.80€)
Seat 2: Hero (38.52€)
Seat 3: Fir (53.65€)
Seat 4: Gum (22.85€)
Seat 5: Hazel (42.59€)
*** ANTE/BLINDS ***
Hazel posts small blind 0.25€
Elm posts big blind 0.50€
Dealt to Hero [Qh Qc]
*** PRE-FLOP ***
Hero raises 2€ to 2.50€
Fir folds
Gum raises 20.35€ to 22.85€ and is all-in
Hazel folds
Elm folds
Hero calls 20.35€
*** FLOP *** [3c 7c Jd]
*** TURN *** [3c 7c Jd] [6c]
*** RIVER *** [3c 7c Jd 6c] [5s]
*** SHOW DOWN ***
Gum shows [Kh Ah] (high card : Ace)
Hero shows [Qh Qc] (One pair : Queens)
Hero collected 43.45€ from pot
*** SUMMARY ***
Total pot 43.45€ | Rake 3€
Board: [3c 7c Jd 6c 5s]
Seat 2: Hero showed [Qh Qc] and won 43.45€ with One pair : Queens
Seat 4: Gum (button) mucked`;

/** Real hand, with a `Dealt to` line added. A bet on the river that nobody calls. */
export const EIGHT88_UNCALLED = `#Game No : 280083902
***** 888poker Hand History for Game 280083902 *****
$0.50/$1 Blinds No Limit Holdem - *** 06 01 2014 13:39:55
Table Alcorcon 6 Max (Real Money)
Seat 6 is the button
Total number of players : 6
Seat 1: Ash ( $29.33 )
Seat 2: Hero ( $67.78 )
Seat 4: Beech ( $100 )
Seat 6: Cherry ( $135.15 )
Seat 7: Larch ( $70.51 )
Seat 9: Maple ( $100 )
Larch posts small blind [$0.50]
Maple posts big blind [$1]
** Dealing down cards **
Dealt to Hero [ Ah, 8s ]
Ash calls [$1]
Hero raises [$2]
Beech raises [$6.37]
Cherry folds
Larch folds
Maple folds
Ash folds
Hero calls [$4.37]
** Dealing flop ** [ 3d, 8h, Kd ]
Hero checks
Beech bets [$10.43]
Hero calls [$10.43]
** Dealing turn ** [ 8c ]
Hero checks
Beech checks
** Dealing river ** [ 8d ]
Hero bets [$36.10]
Beech folds
** Summary **
Hero did not show his hand
Hero collected [ $34.30 ]`;

/** Real hand, with a `Dealt to` line added for the button, who three-bets and wins. */
export const PARTY_THREE_BET = `***** Hand History for Game 13550695573 *****
$0.05/$0.10 USD NL Texas Hold'em - Monday, January 06, 08:54:23 EST 2014
Table Bloemfontein (Real Money)
Seat 2 is the button
Total number of players : 2/6
Seat 2: Hero ( $22.85 USD )
Seat 5: Oak ( $10.10 USD )
Hero posts small blind [$0.05 USD].
Oak posts big blind [$0.10 USD].
** Dealing down cards **
Dealt to Hero [  Ac Ad ]
Hero raises [$0.25 USD]
Oak raises [$0.70 USD]
Hero calls [$0.50 USD]
** Dealing Flop ** [ 9c, Kd, Qs ]
Oak bets [$0.80 USD]
Hero raises [$2.94 USD]
Oak folds
Hero does not show cards.
Hero wins $5.18 USD`;

/** Real hand. Only watched: nobody's cards are dealt face up. */
export const STARS_WATCHED = `PokerStars Game #109664415396:  Hold'em No Limit ($0.50/$1.00 USD) - 2014/01/05 19:22:42 ET
Table 'Triangulum Zoom 40-100 bb' 6-max Seat #1 is the button
Seat 1: Aa ($49.57 in chips)
Seat 2: Bb ($153.67 in chips)
Seat 3: Cc ($78.60 in chips)
Bb: posts small blind $0.50
Cc: posts big blind $1
*** HOLE CARDS ***
Aa: raises $2 to $3
Bb: folds
Cc: folds
Uncalled bet ($2) returned to Aa
Aa collected $2.50 from pot
*** SUMMARY ***
Total pot $2.50 | Rake $0
Seat 1: Aa (button) collected ($2.50)`;
