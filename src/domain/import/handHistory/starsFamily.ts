/**
 * PokerStars, and the sites that write their hands the way PokerStars does.
 *
 * GGPoker, ACR (the Winning Poker Network) and Winamax all copied the same
 * layout: a header line with the hand number, the blinds and the time; a table
 * line naming the button; one line per seat; actions as `Name: verb amount`
 * under `*** FLOP ***` style street markers; and a `*** SUMMARY ***` with the
 * board. They differ in the header and in small words, and those differences
 * are all in `readHeader` below. Everything after the header is one parser.
 *
 * What each line means for the player's money, which is the part that has to
 * be exactly right:
 *
 * - A raise is written as the street total it comes to, `raises $4 to $6`, so
 *   it is measured against what the player already had in on that street.
 * - An ante is in the pot but not in the street, so it never counts toward a
 *   raise.
 * - An uncalled bet comes back on a line of its own, and the pot collected is
 *   written without it.
 */

import { parseCurrency } from '../values';
import {
  Ledger,
  actorOf,
  longestFirst,
  orderFromButton,
  positionsAround,
  readAmount,
  readCards,
  readGameType,
  readHero,
  type Seat,
} from './common';
import { readHeaderTime } from './time';
import type { HandSite, ParsedHand } from './types';

/** The first line of a hand, for each site this reads. */
export const STARS_FAMILY_START =
  /^(?:PokerStars (?:Zoom |Home Game )?(?:Hand|Game) #|Poker Hand #|(?:Game )?Hand #\d|Winamax Poker - )/;

interface Header {
  site: HandSite;
  handId: string;
  tournament: boolean;
  tournamentId: string | null;
  stakesText: string | null;
  smallBlind: number | null;
  bigBlind: number | null;
}

/**
 * `($0.05/$0.10 USD)`, `(0.25€/0.50€)`, `(25/50)`, GGPoker's `(200/400(50))`
 * with an ante after, and Winamax's `(25/500/1000)` with the ante first. The
 * last two numbers are always the blinds.
 */
const PAREN_STAKES =
  /\((?:[\d.,]+\s?[€$£]?\s?\/\s?(?=[$€£]?\s?[\d.,]+\s?[€$£]?\s?\/))?([$€£]?\s?[\d.,]+\s?[€$£]?)\s?\/\s?([$€£]?\s?[\d.,]+\s?[€$£]?)(?:\s?\([^()]*\))?(?:\s+[A-Z]{3})?\)/;
/** ACR writes its blinds between dashes, with no brackets: `- $0.01/$0.02 -`. */
const DASHED_STAKES = / - ([$€£]?[\d.,]+[€$£]?)\/([$€£]?[\d.,]+[€$£]?)(?: [A-Z]{3})? - /;

const readHeader = (line: string): Header | null => {
  let site: HandSite;
  let handId: string | null = null;

  const stars = /^PokerStars (?:Zoom |Home Game )?(?:Hand|Game) #(\d+)/.exec(line);
  const gg = /^Poker Hand #([A-Z]*\d+)/.exec(line);
  const winamax = /^Winamax Poker - .*?HandId: #([\d-]+)/.exec(line);
  const acr = /^(?:Game )?Hand #(\d+)/.exec(line);
  if (stars) {
    site = 'PokerStars';
    handId = stars[1];
  } else if (gg) {
    site = 'GGPoker';
    handId = gg[1];
  } else if (winamax) {
    site = 'Winamax';
    handId = winamax[1];
  } else if (acr) {
    site = 'ACR';
    handId = acr[1];
  } else {
    return null;
  }

  // A tournament by name, number or not: Winamax writes `Tournament "Name"`
  // with no number, and that read as a cash game in euros, its chips counted
  // as money because the buy-in on the same line named a currency.
  const tournament = /\b(?:Tournament|Tourney)\b/i.test(line);
  const tournamentId = /Tournament #?\s?(\d+)/i.exec(line)?.[1] ?? null;
  const stakes = PAREN_STAKES.exec(line) ?? DASHED_STAKES.exec(line);
  return {
    site,
    handId,
    tournament,
    tournamentId,
    stakesText: stakes ? stakes[0] : null,
    smallBlind: stakes ? readAmount(stakes[1]) : null,
    bigBlind: stakes ? readAmount(stakes[2]) : null,
  };
};

/**
 * `Seat 3: Name ($12.26 in chips)`, `Seat 1: Name (67.80€)`, and the same with
 * a bounty or "is sitting out" after it. The amount has to lead with a digit
 * or a currency sign, which is what stops a name with brackets in it from
 * ending early.
 */
const SEAT = /^Seat (\d+): (.+?) \(([$€£]?\s?\d[\d.,]*\s?[€$£]?)(?: in chips)?[^()]*\)(.*)$/;

export const parseStarsFamilyHand = (
  lines: readonly string[],
  counts: ReadonlyMap<string, number> = new Map(),
): { hand: ParsedHand } | { skip: string; handId: string | null } => {
  const header = readHeader(lines[0]);
  if (!header) return { skip: 'The first line is not a hand this can read.', handId: null };
  const { handId } = header;

  if (lines.some((line) => /hand (?:was )?cancell?ed/i.test(line))) {
    return { skip: 'The site canceled this hand.', handId };
  }

  const time = readHeaderTime(lines[0]);
  if (!time) return { skip: 'No date and time on the hand.', handId };

  const tableLine = lines.find((line) => /is the button/.test(line)) ?? lines[1] ?? '';
  const tableName = /^Table:? '([^']+)'/.exec(tableLine)?.[1] ?? null;
  // Winamax puts the tournament's number in the table name, `Name(123456)#004`,
  // and none on the first line.
  const tournamentId =
    header.tournamentId ??
    (header.tournament ? (/\((\d+)\)#\d+$/.exec(tableName ?? '')?.[1] ?? null) : null);
  const button = /Seat #?(\d+) is the button/.exec(tableLine);
  const playMoney =
    /play money/i.test(tableLine) || /play money/i.test(lines[0]);

  const seats: Seat[] = [];
  let summaryAt = lines.length;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\*\*\* SUMMARY/.test(line)) {
      summaryAt = i;
      break;
    }
    const seat = SEAT.exec(line);
    if (seat) {
      seats.push({
        seat: Number(seat[1]),
        name: seat[2],
        stack: readAmount(seat[3]),
        out: /sitting out|out of hand/i.test(seat[4]),
      });
    }
  }

  const dealt = readHero(lines, counts);
  if (dealt === null) {
    return { skip: 'No cards were dealt to you in this hand, so it is one you watched.', handId };
  }
  const { hero, holeCards } = dealt;

  const names = longestFirst(seats.map((seat) => seat.name));
  const ledger = new Ledger();
  let showdown = false;
  let streetBoard: string | null = null;

  for (let i = 1; i < summaryAt; i += 1) {
    const line = lines[i].trim();

    const street = /^\*\*\* ([A-Z -]+) \*\*\*(.*)$/.exec(line);
    if (street) {
      // `PRE-FLOP` is Winamax's name for the first street, which the blinds
      // were posted into: starting a new street there forgot them, and every
      // raise from a blind was then counted as if the blind had not been in.
      if (/(?:^|\s)(?:FLOP|TURN|RIVER)$/.test(street[1].trim())) {
        ledger.newStreet();
        const cards = readCards(street[2]);
        if (cards !== null && !/SECOND|2ND/.test(street[1])) streetBoard = cards;
      }
      continue;
    }

    const uncalled = /^Uncalled bet \(([^)]+)\) returned to (.+)$/.exec(line);
    if (uncalled) {
      const amount = readAmount(uncalled[1]);
      if (amount !== null) ledger.returned(uncalled[2].trim(), amount);
      continue;
    }

    const actor = actorOf(line, names);
    if (!actor) continue;
    const { name, rest } = actor;

    let match: RegExpExecArray | null;
    if ((match = /^posts small & big blinds (.+)$/i.exec(rest))) {
      // The small blind half is dead money; the big blind half is live.
      const total = readAmount(match[1]) ?? 0;
      const live = Math.min(total, header.bigBlind ?? total);
      ledger.blind(name, live);
      ledger.dead(name, total - live);
    } else if ((match = /^posts (?:the )?ante (.+)$/i.exec(rest))) {
      ledger.dead(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^posts (?:the )?dead (?:small )?blind (.+)$/i.exec(rest))) {
      ledger.dead(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^posts (.+)$/i.exec(rest))) {
      ledger.blind(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^raises (.+?) to (.+)$/i.exec(rest))) {
      ledger.raiseTo(name, readAmount(match[2]) ?? 0);
    } else if ((match = /^raises (.+)$/i.exec(rest))) {
      ledger.put(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^(?:calls|bets) (.+)$/i.exec(rest))) {
      ledger.put(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^(?:collected|wins|won) \(?([^()]+?)\)? from/i.exec(rest))) {
      ledger.collect(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^(?:collected|wins|won) (.+)$/i.exec(rest))) {
      ledger.collect(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^(?:receives cashout|cashed out the hand for) \(?([^()|]+)/i.exec(rest))) {
      ledger.collect(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^pays cashout risk \(([^()]+)\)/i.exec(rest))) {
      ledger.dead(name, readAmount(match[1]) ?? 0);
    } else if (/^shows \[/i.test(rest) && name === hero) {
      showdown = true;
    }
  }

  let board: string | null = null;
  for (let i = summaryAt; i < lines.length; i += 1) {
    const line = lines[i];
    const summaryBoard = /^(?:First )?Board:? \[([^\]]+)\]/i.exec(line);
    if (summaryBoard && board === null) board = readCards(summaryBoard[1]);
    if (line.includes(`: ${hero} `) && /showed \[/.test(line)) showdown = true;
  }
  board ??= streetBoard;

  const heroSeat = seats.find((seat) => seat.name === hero);
  const positions = positionsAround(orderFromButton(seats, button ? Number(button[1]) : null));

  const { tournament } = header;
  // From the blinds alone. It fell back to the whole header line, which is
  // where a tournament's buy-in is written, so a line with no currency in its
  // blinds could still be read as money. Blinds that name no currency are
  // chips, and chips are the safe mistake: they never reach a bankroll.
  const currency = tournament || playMoney ? null : parseCurrency(header.stakesText ?? '');

  return {
    hand: {
      site: header.site,
      handId,
      table: tableName,
      at: time.at,
      zoned: time.zoned,
      format: tournament ? 'tournament' : 'cash',
      tournamentId,
      currency,
      gameType: readGameType(lines[0]),
      smallBlind: header.smallBlind,
      bigBlind: header.bigBlind,
      hero,
      holeCards,
      board,
      position: positions.get(hero) ?? null,
      net: ledger.net(hero),
      stack: heroSeat?.stack ?? null,
      showdown,
    },
  };
};
