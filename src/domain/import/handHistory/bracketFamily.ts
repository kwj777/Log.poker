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
  readHero,
  sumAmounts,
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
  counts: ReadonlyMap<string, number> = new Map(),
): { hand: ParsedHand } | { skip: string; handId: string | null } => {
  // partypoker can open with 888poker's `#Game No` line too; its own line
  // below that, with no site named in it, is what tells them apart.
  const is888 = !lines.slice(0, 2).some((line) => /^\*{5} Hand History for Game/.test(line));
  const site: HandSite = is888 ? '888poker' : 'partypoker';
  const handId = /(?:#Game No : |Hand History for Game )(\d+)/.exec(lines[0])?.[1] ?? null;
  if (handId === null) return { skip: 'The first line is not a hand this can read.', handId };

  // The line with the game and the date on it, found by the date: the second
  // for partypoker, the third for 888poker, whose second line only repeats
  // the hand number. It was found by its blinds, which missed 888poker's
  // `25 $/50 $` and every partypoker pot-limit game, whose line names the
  // table's maximum buy-in and no blinds at all.
  const readTime = is888 ? read888Time : readPartyTime;
  const gameLine = lines.find((line, index) => index > 0 && readTime(line) !== null) ?? '';
  const time = readTime(gameLine);
  if (!time) return { skip: 'No date and time on the hand.', handId };

  const tableLine = lines.find((line) => /^Table /.test(line)) ?? '';
  const tableName = /^Table (.+?)(?: \d+ Max)?(?: \((?:Real|Play) Money\))?\s*$/.exec(tableLine)?.[1] ?? null;
  const playMoney = /play money/i.test(tableLine);
  const head = lines.slice(0, 5).join(' ');
  const tournament = /\b(?:Tournament|Tourney)\b/i.test(head);
  const tournamentId = /Tournament #?\s?(\d+)/i.exec(head)?.[1] ?? null;
  const button = /^Seat (\d+) is the button/m.exec(lines.join('\n'));

  const stakes = /([$€£]?[\d.,]+(?: ?[$€£])?)\s?\/\s?([$€£]?[\d.,]+)/.exec(gameLine);
  // Without blinds on the game line, the blinds posted say what they were.
  const posted = (which: string): number | null => {
    for (const line of lines) {
      const match = new RegExp(`posts ${which} blind \\[([^\\]]+)\\]`, 'i').exec(line);
      if (match) return readAmount(match[1]);
    }
    return null;
  };
  const smallBlind = stakes ? readAmount(stakes[1]) : posted('small');
  const bigBlind = stakes ? readAmount(stakes[2]) : posted('big');

  const seats: Seat[] = [];
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
  }
  const dealt = readHero(lines, counts);
  if (dealt === null) {
    return { skip: 'No cards were dealt to you in this hand, so it is one you watched.', handId };
  }
  const { hero, holeCards } = dealt;

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
    if ((match = /^posts ante\s*\[(.+?)\]/i.exec(rest))) {
      ledger.dead(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^posts [^[]*dead[^[]*\[(.+?)\]/i.exec(rest))) {
      // A player coming in out of turn posts both blinds: 888poker writes
      // `posts dead blind [$1 + $2]` and partypoker `posts big blind + dead
      // [$3]`. The big blind of that is live and the rest is dead. Reading
      // only the first figure, or not reading the partypoker line at all,
      // lost part of what the player put in.
      const total = sumAmounts(match[1]);
      const live = Math.min(total, bigBlind ?? 0);
      ledger.blind(name, live);
      ledger.dead(name, total - live);
    } else if ((match = /^posts [^[]*\[(.+?)\]/i.exec(rest))) {
      ledger.blind(name, readAmount(match[1]) ?? 0);
    } else if ((match = /^(?:calls|bets|raises|is all-in)\s*\[(.+?)\]/i.exec(rest))) {
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
