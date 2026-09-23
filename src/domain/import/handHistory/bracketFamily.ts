/**
 * 888poker and partypoker, which write every amount in square brackets.
 *
 * The two share a layout that owes nothing to PokerStars: `** Dealing flop **`
 * for a street, `raises [$2]` for an action, and amounts that are always what
 * the player added rather than what they came to. They differ in how a hand
 * ends, which matters for the money:
 *
 * - 888poker hands an uncalled bet back without a line to say so, and writes
 *   the pot collected without it. The ledger works the refund out itself.
 * - partypoker writes the pot won with the uncalled part still in it, so there
 *   is nothing to hand back.
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
  type Seat,
} from './common';
import { fromWallClock, type ReadTime } from './time';
import type { HandSite, ParsedHand } from './types';

export const BRACKET_FAMILY_START = /^(?:#Game No : \d|\*{5} Hand History for Game \d)/;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** 888poker: `*** 06 01 2014 10:56:05`, day first, with no zone. */
const read888Time = (line: string): ReadTime | null => {
  const match = /\*\*\* (\d{1,2}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}):(\d{2})/.exec(line);
  if (!match) return null;
  return fromWallClock(
    {
      day: Number(match[1]),
      month: Number(match[2]),
      year: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6]),
    },
    null,
  );
};

/** partypoker: `Sunday, January 05, 19:24:07 EST 2014`. */
const readPartyTime = (line: string): ReadTime | null => {
  const match =
    /([A-Za-z]+) (\d{1,2}), (\d{1,2}):(\d{2}):(\d{2}) ([A-Z]{2,5}) (\d{4})/.exec(line);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1;
  if (month === 0) return null;
  return fromWallClock(
    {
      year: Number(match[7]),
      month,
      day: Number(match[2]),
      hour: Number(match[3]),
      minute: Number(match[4]),
      second: Number(match[5]),
    },
    match[6],
  );
};

const SEAT = /^Seat (\d+): (.+?) \( ?([^()]*?) ?\)\s*(.*)$/;

export const parseBracketFamilyHand = (
  lines: readonly string[],
): { hand: ParsedHand } | { skip: string; handId: string | null } => {
  const is888 = /^#Game No/.test(lines[0]);
  const site: HandSite = is888 ? '888poker' : 'partypoker';
  const handId = /(?:#Game No : |Hand History for Game )(\d+)/.exec(lines[0])?.[1] ?? null;
  if (handId === null) return { skip: 'The first line is not a hand this can read.', handId };

  // The line with the blinds and the date on it: the second for partypoker,
  // the third for 888poker, whose second line only repeats the hand number.
  const gameLine = lines.find((line, index) => index > 0 && /\d\/[$€£]?\d/.test(line)) ?? '';
  const time = is888 ? read888Time(gameLine) : readPartyTime(gameLine);
  if (!time) return { skip: 'No date and time on the hand.', handId };

  const tableLine = lines.find((line) => /^Table /.test(line)) ?? '';
  const tableName = /^Table (.+?)(?: \d+ Max)?(?: \((?:Real|Play) Money\))?\s*$/.exec(tableLine)?.[1] ?? null;
  const playMoney = /play money/i.test(tableLine);
  const tournamentId = /Tournament #?\s?(\d+)/i.exec(lines.slice(0, 5).join(' '))?.[1] ?? null;
  const button = /^Seat (\d+) is the button/m.exec(lines.join('\n'));

  const stakes = /([$€£]?[\d.,]+)\/([$€£]?[\d.,]+)/.exec(gameLine);
  const smallBlind = stakes ? readAmount(stakes[1]) : null;
  const bigBlind = stakes ? readAmount(stakes[2]) : null;

  const seats: Seat[] = [];
  let hero: string | null = null;
  let holeCards: string | null = null;
  for (const line of lines) {
    const seat = SEAT.exec(line);
    if (seat && /\d/.test(seat[3])) {
      seats.push({
        seat: Number(seat[1]),
        name: seat[2],
        stack: readAmount(seat[3]),
        out: /sitting out/i.test(seat[4]),
      });
    }
    const dealt = /^Dealt to (.+?) \[([^\]]+)\]/.exec(line);
    if (dealt && hero === null) {
      hero = dealt[1];
      holeCards = readCards(dealt[2]);
    }
  }
  if (hero === null) {
    return { skip: 'No cards were dealt to you in this hand, so it is one you watched.', handId };
  }

  const names = longestFirst(seats.map((seat) => seat.name));
  const ledger = new Ledger();
  let board = '';
  let showdown = false;

  const endStreet = () => {
    if (is888) ledger.refundUncalled();
    ledger.newStreet();
  };

  for (const raw of lines) {
    const line = raw.trim();
    const street = /^\*\* Dealing (flop|turn|river) \*\* \[([^\]]+)\]/i.exec(line);
    if (street) {
      endStreet();
      board += readCards(street[2]) ?? '';
      continue;
    }
    const actor = actorOf(line, names);
    if (!actor) continue;
    const { name, rest } = actor;

    let match: RegExpExecArray | null;
    if ((match = /^posts (?:ante|dead) (?:\w+ )?\[(.+?)\]/i.exec(rest))) {
      ledger.dead(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^(?:posts [\w ]*?|calls|bets|raises|is all-in)\s*\[(.+?)\]/i.exec(rest))) {
      ledger.put(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^collected \[(.+?)\]/i.exec(rest))) {
      ledger.collect(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^wins (.+?)(?: from| with|$)/i.exec(rest))) {
      ledger.collect(name, readAmount(match[1]) ?? 0);
    } else if (/^shows \[/i.test(rest) && name === hero) {
      showdown = true;
    }
  }
  if (is888) ledger.refundUncalled();

  const heroSeat = seats.find((seat) => seat.name === hero);
  const positions = positionsAround(orderFromButton(seats, button ? Number(button[1]) : null));
  const tournament = tournamentId !== null;

  return {
    hand: {
      site,
      handId,
      table: tableName,
      at: time.at,
      zoned: time.zoned,
      format: tournament ? 'tournament' : 'cash',
      tournamentId,
      currency: tournament || playMoney ? null : (parseCurrency(gameLine) ?? null),
      gameType: readGameType(gameLine),
      smallBlind,
      bigBlind,
      hero,
      holeCards,
      board: board === '' ? null : board,
      position: positions.get(hero) ?? null,
      net: ledger.net(hero),
      stack: heroSeat?.stack ?? null,
      showdown,
    },
  };
};
