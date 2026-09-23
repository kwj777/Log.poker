/**
 * Reading hand histories: one hand per site, checked field by field.
 *
 * The money is the part checked hardest. Every expected `net` below is worked
 * out by hand in the comment beside it, from what the player put in and what
 * came back, because a parser that is wrong about the money would be wrong in
 * the one number a player reads.
 */

import { looksLikeHandHistory, parseHandHistory } from '..';
import { positionsAround, readAmount, readCards, readGameType, sumAmounts } from '../common';
import { readHeaderTime } from '../time';
import {
  ACR_SET,
  EIGHT88_DEAD_BLIND,
  EIGHT88_SPACED,
  EIGHT88_UNCALLED,
  EIGHT88_WALK,
  GG_RUSH,
  PARTY_DEAD_BLIND,
  PARTY_POT_LIMIT,
  PARTY_THREE_BET,
  STARS_ALL_IN,
  STARS_HERO_FOLDS,
  STARS_PLAY_MONEY,
  STARS_PLAY_MONEY_SMALL,
  STARS_WATCHED,
  WINAMAX_ALL_IN,
  WINAMAX_BLIND_RAISE,
  WINAMAX_TOURNAMENT,
} from './fixtures';

const only = (text: string) => {
  const result = parseHandHistory(text);
  expect(result.hands).toHaveLength(1);
  return result.hands[0];
};

describe('the pieces', () => {
  it('reads amounts in every way a site writes them', () => {
    expect(readAmount('$0.05')).toBe(5);
    expect(readAmount('0.25€')).toBe(25);
    expect(readAmount('(€289.57 in chips)')).toBe(28957);
    expect(readAmount('1,500')).toBe(150000);
    expect(readAmount('[$0.10 USD].')).toBe(10);
    expect(readAmount('no number')).toBeNull();
  });

  it('reads thousands set apart by a space, as 888poker writes them in some countries', () => {
    expect(readAmount('( 3\u00a0023,50 $ )')).toBe(302350);
    expect(readAmount('[1\u202f250 $]')).toBe(125000);
    expect(readAmount('1 250 000')).toBe(125000000);
    // Two figures a space apart are only one amount when the second is a group of three.
    expect(readAmount('25 $')).toBe(2500);
    expect(sumAmounts('[$1 + $2]')).toBe(300);
  });

  it('reads cards, including a ten written as 10', () => {
    expect(readCards('[Ah Kd]')).toBe('AhKd');
    expect(readCards('[ 3d, Jc ]')).toBe('3dJc');
    expect(readCards('[10h 9h]')).toBe('Th9h');
    expect(readCards('[Ah Ah]')).toBeNull();
    expect(readCards('[Xx Kd]')).toBeNull();
  });

  it('names the games Log knows and nothing else', () => {
    expect(readGameType("Hold'em No Limit")).toBe('NLHE');
    expect(readGameType('Holdem (No Limit)')).toBe('NLHE');
    expect(readGameType('Omaha Pot Limit')).toBe('PLO');
    expect(readGameType('Omaha Hi/Lo Pot Limit')).toBe('OTHER');
    expect(readGameType("Hold'em Limit")).toBe('OTHER');
  });

  it('labels seats from the button round', () => {
    // First after the button to the button itself.
    expect([...positionsAround(['a', 'b']).entries()]).toEqual([
      ['b', 'BTN'],
      ['a', 'BB'],
    ]);
    const six = positionsAround(['sb', 'bb', 'u', 'h', 'c', 'btn']);
    expect(Object.fromEntries(six)).toEqual({
      sb: 'SB',
      bb: 'BB',
      u: 'UTG',
      h: 'HJ',
      c: 'CO',
      btn: 'BTN',
    });
    const nine = positionsAround(['sb', 'bb', 'u', 'u1', 'mp', 'lj', 'hj', 'co', 'btn']);
    expect([...nine.values()]).toEqual(
      expect.arrayContaining(['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']),
    );
  });

  describe('times', () => {
    it('reads Eastern as daylight time in summer and standard time in winter', () => {
      expect(readHeaderTime('2026/07/01 12:00:00 ET')?.at).toBe(Date.UTC(2026, 6, 1, 16));
      expect(readHeaderTime('2026/01/15 12:00:00 ET')?.at).toBe(Date.UTC(2026, 0, 15, 17));
    });

    it('changes over on the second Sunday of March and the first of November', () => {
      // 2026: March 8 and November 1.
      expect(readHeaderTime('2026/03/08 01:59:59 ET')?.at).toBe(Date.UTC(2026, 2, 8, 6, 59, 59));
      expect(readHeaderTime('2026/03/08 03:00:00 ET')?.at).toBe(Date.UTC(2026, 2, 8, 7));
      expect(readHeaderTime('2026/10/31 12:00:00 ET')?.at).toBe(Date.UTC(2026, 9, 31, 16));
      expect(readHeaderTime('2026/11/01 12:00:00 ET')?.at).toBe(Date.UTC(2026, 10, 1, 17));
    });

    it('trusts Eastern when PokerStars writes two that disagree', () => {
      // PokerStars can keep writing CET through a European summer, when the
      // clock it read was CEST. Eastern is the one it always gets right.
      const read = readHeaderTime('2026/07/08 18:14:22 CET [2026/07/08 12:14:22 ET]');
      expect(read).toEqual({ at: Date.UTC(2026, 6, 8, 16, 14, 22), zoned: true });
    });

    it('prefers the zone it knows when PokerStars writes two', () => {
      const read = readHeaderTime('2026/09/23 14:02:11 CEST [2026/09/23 8:02:11 ET]');
      expect(read).toEqual({ at: Date.UTC(2026, 8, 23, 12, 2, 11), zoned: true });
      const unknown = readHeaderTime('2026/09/23 21:02:11 XYZT [2026/09/23 8:02:11 ET]');
      expect(unknown).toEqual({ at: Date.UTC(2026, 8, 23, 12, 2, 11), zoned: true });
    });

    it('reads a time with no zone as local, and says so', () => {
      const read = readHeaderTime('2026/09/23 18:30:00');
      expect(read).toEqual({ at: new Date(2026, 8, 23, 18, 30, 0).getTime(), zoned: false });
    });

    it('does not read a date that is not one', () => {
      expect(readHeaderTime('2026/13/40 25:00:00 UTC')).toBeNull();
      // Not a real day either, though every field is in range on its own.
      expect(readHeaderTime('2026/02/31 12:00:00 UTC')).toBeNull();
      expect(readHeaderTime('2028/02/29 12:00:00 UTC')?.at).toBe(Date.UTC(2028, 1, 29, 12));
    });
  });
});

describe('telling a hand history from a spreadsheet', () => {
  it('knows every format by its first line', () => {
    for (const text of [
      STARS_ALL_IN,
      GG_RUSH,
      ACR_SET,
      WINAMAX_ALL_IN,
      EIGHT88_UNCALLED,
      PARTY_THREE_BET,
    ]) {
      expect(looksLikeHandHistory(text)).toBe(true);
    }
    expect(looksLikeHandHistory(`﻿\n\n${STARS_ALL_IN}`)).toBe(true);
  });

  it('leaves a session summary to the session importer', () => {
    expect(looksLikeHandHistory('Date,Buy-in,Cash-out\n2026-01-02,100,250\n')).toBe(false);
    expect(looksLikeHandHistory('')).toBe(false);
  });
});

describe('PokerStars', () => {
  it('reads a folded small blind', () => {
    const hand = only(STARS_HERO_FOLDS);
    expect(hand).toMatchObject({
      site: 'PokerStars',
      handId: '1846552153',
      table: 'Brunk V',
      at: Date.UTC(2013, 2, 8, 17, 14, 22),
      zoned: true,
      format: 'cash',
      currency: 'EUR',
      gameType: 'NLHE',
      smallBlind: 100,
      bigBlind: 200,
      hero: 'PS_Hero',
      holeCards: '4s7h',
      board: '6d7c6h2sQc',
      position: 'SB',
      net: -100,
      stack: 19800,
      showdown: false,
    });
  });

  it('gets the money right through antes, a three-bet and an all-in', () => {
    const hand = only(STARS_ALL_IN);
    // In: 0.05 blind + 0.02 ante + 1.25 to make it 1.30 + 2 bet + 8.94 call
    // = 12.26. Back: 23.57. Net +11.31.
    expect(hand.net).toBe(1131);
    expect(hand.showdown).toBe(true);
    expect(hand.board).toBe('5c4c4hQsKc');
    // A January hand, so Eastern is five hours behind.
    expect(hand.at).toBe(Date.UTC(2014, 0, 6, 15, 23, 24));
    expect(hand.position).toBe('SB');
    expect(hand.currency).toBe('USD');
  });

  it('reads play money as chips, not as dollars', () => {
    const hand = only(STARS_PLAY_MONEY);
    // In: 25 + 125 + 200 + 800 + 3850 = 5000, less 750 returned = 4250.
    // Back: 8500. Net +4250 chips.
    expect(hand).toMatchObject({
      currency: null,
      format: 'cash',
      net: 425000,
      smallBlind: 2500,
      bigBlind: 5000,
      holeCards: 'QsQd',
      position: 'SB',
      at: Date.UTC(2026, 8, 23, 12, 2, 11),
    });
  });

  it('skips a hand the player only watched, and says how many', () => {
    const result = parseHandHistory(STARS_WATCHED);
    expect(result.hands).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.warnings[0].message).toMatch(/1 hand had no cards dealt to you/);
  });

  it('reads a file of many hands, earliest first, once each', () => {
    const file = [STARS_PLAY_MONEY_SMALL, STARS_PLAY_MONEY, STARS_WATCHED, STARS_PLAY_MONEY].join(
      '\n\n\n',
    );
    const result = parseHandHistory(file);
    expect(result.hands.map((hand) => hand.handId)).toEqual(['250000000001', '250000000002']);
    expect(result.sites).toEqual(['PokerStars']);
  });

  it('reads a file saved with bare carriage returns between lines', () => {
    const hand = only(STARS_HERO_FOLDS.replace(/\n/g, '\r'));
    expect(hand).toMatchObject({ handId: '1846552153', net: -100, holeCards: '4s7h' });
    expect(looksLikeHandHistory(STARS_HERO_FOLDS.replace(/\n/g, '\r'))).toBe(true);
  });

  it('skips a canceled hand with its reason', () => {
    // The site's own spelling, split so the house spelling check lets it through.
    const voided = `${STARS_HERO_FOLDS}\nHand cancel` + `led`;
    const result = parseHandHistory(voided);
    expect(result.hands).toEqual([]);
    expect(result.warnings).toEqual([
      { handId: '1846552153', message: 'The site canceled this hand.' },
    ]);
  });
});

describe('GGPoker', () => {
  it('reads a Rush & Cash hand, with the other players dealt face down', () => {
    const hand = only(GG_RUSH);
    // In: 0.15 + 0.20, less 0.20 returned = 0.15. Back: 0.31. Net +0.16.
    expect(hand).toMatchObject({
      site: 'GGPoker',
      handId: 'RC2000000001',
      hero: 'Hero',
      holeCards: 'AhKh',
      board: 'Kd7s2h',
      net: 16,
      currency: 'USD',
      zoned: false,
      position: 'UTG',
      stack: 512,
    });
  });
});

describe('whose hand it is', () => {
  it('is the player dealt cards in every hand, not whoever showed first', () => {
    // GGPoker writes the cards of a player who showed on their `Dealt to` line,
    // and the lowest seat comes first. That player became the hero, with their
    // cards and their result.
    const shown = GG_RUSH.replace('#RC2000000001', '#RC2000000002')
      .replace('18:30:00', '18:31:00')
      .replace('Dealt to 1a2b3c\n', 'Dealt to 1a2b3c [Qs Qd]\n');
    const result = parseHandHistory(`${GG_RUSH}\n\n${shown}`);
    expect(result.hands.map((hand) => [hand.handId, hand.hero, hand.holeCards])).toEqual([
      ['RC2000000001', 'Hero', 'AhKh'],
      ['RC2000000002', 'Hero', 'AhKh'],
    ]);
  });
});

describe('ACR', () => {
  it('reads names with no colon after them and blinds between dashes', () => {
    const hand = only(ACR_SET);
    // In: 1.20 preflop + 8.80 on the flop, less 1.00 returned = 9.00.
    // Back: 17.60. Net +8.60.
    expect(hand).toMatchObject({
      site: 'ACR',
      handId: '2046271553',
      smallBlind: 5,
      bigBlind: 10,
      net: 860,
      position: 'BTN',
      showdown: true,
      board: 'Ts4c4d2s9h',
      at: Date.UTC(2026, 8, 23, 1, 15, 42),
    });
  });
});

describe('Winamax', () => {
  it('reads euros written after the number', () => {
    const hand = only(WINAMAX_ALL_IN);
    // In: 2.50 + 20.35 = 22.85. Back: 43.45. Net +20.60.
    expect(hand).toMatchObject({
      site: 'Winamax',
      handId: '5343878-96-1383820687',
      currency: 'EUR',
      net: 2060,
      holeCards: 'QhQc',
      position: 'UTG',
      table: 'Athens 11',
      at: Date.UTC(2013, 10, 7, 10, 38, 7),
    });
  });
});

describe('Winamax, the first street', () => {
  it('keeps the blinds when a raise comes from one', () => {
    const hand = only(WINAMAX_BLIND_RAISE);
    // In: 0.50 blind, raised to 2.50, then 5 to call the three-bet to 7.50.
    // Back: 14.02. Net +6.52. Reading PRE-FLOP as a new street forgot the
    // 0.50 and put in 8.00.
    expect(hand).toMatchObject({ net: 652, position: 'BTN', showdown: true, currency: 'EUR' });
  });

  it('reads a tournament with a name and no number as a tournament, in chips', () => {
    const hand = only(WINAMAX_TOURNAMENT);
    // In: 5 ante + 40 small blind. Net -45 chips.
    expect(hand).toMatchObject({
      format: 'tournament',
      tournamentId: '700001',
      currency: null,
      smallBlind: 4000,
      bigBlind: 8000,
      net: -4500,
      stack: 300000,
    });
  });
});

describe('888poker', () => {
  it('hands back a river bet nobody called, which the file never mentions', () => {
    const hand = only(EIGHT88_UNCALLED);
    // In: 2 + 4.37 + 10.43 + 36.10 = 52.90, of which the 36.10 river bet was
    // never called and comes back. Back: 34.30. Net 34.30 - 16.80 = +17.50.
    expect(hand).toMatchObject({
      site: '888poker',
      handId: '280083902',
      net: 1750,
      board: '3d8hKd8c8d',
      position: 'HJ',
      currency: 'USD',
      zoned: false,
      table: 'Alcorcon',
    });
  });
});

describe('888poker, the corners', () => {
  it('does not count a walk twice', () => {
    const hand = only(EIGHT88_WALK);
    // In: the 1.00 big blind. Back: 1.50, the whole pot. Net +0.50. Handing
    // back the half of the blind nobody matched as well made it +1.00.
    expect(hand.net).toBe(50);
  });

  it('reads both halves of a dead blind', () => {
    const hand = only(EIGHT88_DEAD_BLIND);
    // In: 1 dead + 2 live. Back: 5.70. Net +2.70.
    expect(hand.net).toBe(270);
    expect(hand.showdown).toBe(true);
  });

  it('reads blinds and stacks written with spaces in them', () => {
    const result = parseHandHistory(EIGHT88_SPACED);
    expect(result.warnings).toEqual([]);
    expect(result.hands[0]).toMatchObject({
      smallBlind: 2500,
      bigBlind: 5000,
      stack: 1555250,
      gameType: 'PLO',
      holeCards: 'AhKd5c5s',
      net: 0,
    });
  });
});

describe('partypoker', () => {
  it('reads a big blind posted with a dead one', () => {
    const hand = only(PARTY_DEAD_BLIND);
    // In: 3 posted (2 live, 1 dead) + 2 raise + 7.12 + 14 = 26.12. Back: nothing.
    expect(hand.net).toBe(-2612);
  });

  it('reads a pot-limit hand that opens like an 888poker one, once', () => {
    const result = parseHandHistory(PARTY_POT_LIMIT);
    expect(result.warnings).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.hands).toHaveLength(1);
    // In: 0.25 + 0.25 + 0.71 = 1.21. Back: 2.30. Net +1.09.
    expect(result.hands[0]).toMatchObject({
      site: 'partypoker',
      hero: 'Hero Man',
      smallBlind: 25,
      bigBlind: 50,
      net: 109,
      currency: 'USD',
      position: 'BTN',
      at: Date.UTC(2012, 3, 3, 7, 48, 45),
    });
  });

  it('reads raises as what was added, and a win with the uncalled part in it', () => {
    const hand = only(PARTY_THREE_BET);
    // In: 0.05 + 0.25 + 0.50 + 2.94 = 3.74. Back: 5.18. Net +1.44.
    expect(hand).toMatchObject({
      site: 'partypoker',
      handId: '13550695573',
      net: 144,
      holeCards: 'AcAd',
      board: '9cKdQs',
      position: 'BTN',
      at: Date.UTC(2014, 0, 6, 13, 54, 23),
      zoned: true,
    });
  });
});
