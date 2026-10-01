/**
 * What the last night left behind.
 *
 * The cases that matter are not "does the arithmetic work" but "how often does
 * this speak, and does it speak in both directions for the same reason". A
 * card on the screen whose job is the Start button earns its place by being
 * quiet, and the three ways this could be wrong are all about frequency:
 *
 *  - It could fire on an ordinary night, which is most nights, and become
 *    furniture.
 *  - It could fire on a loss and stay silent on a heater, which is the
 *    asymmetry the whole point of this is that it does not have.
 *  - It could go on firing for a fortnight after one bad night, at which point
 *    it is a statistic rather than a frame of mind, and the Variance tab is
 *    where statistics are answered.
 */

import { CARRY_OVER_SIGMAS, CARRY_OVER_WINDOW_MS, carryOver } from '../carryOver';
import type { SessionWithChildren } from '../types';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1, 12);
const BB = 200;

/**
 * A four-hour $1/$2 cash session ending `endedAgo` before `NOW`, which won or
 * lost `resultBb` big blinds.
 */
const night = (
  id: string,
  resultBb: number,
  endedAgo: number,
  over: Partial<SessionWithChildren> = {},
): SessionWithChildren => {
  const endedAt = NOW - endedAgo;
  return {
    id,
    venueId: 'v1',
    format: 'cash',
    gameType: 'NLHE',
    stakes: { smallBlind: 100, bigBlind: BB },
    currency: 'USD',
    buyIn: 30_000,
    fee: null,
    cashOut: 30_000 + resultBb * BB,
    entrants: null,
    finishPosition: null,
    startedAt: endedAt - 4 * HOUR,
    endedAt,
    notes: null,
    importKey: null,
    createdAt: endedAt,
    updatedAt: endedAt,
    rebuys: [],
    venue: null,
    ...over,
  };
};

/**
 * A history with a real spread, so there is a sigma to measure against, plus
 * whatever `last` is meant to be.
 *
 * The background nights are all older than the window, so only `last` is ever
 * a candidate: these are here to be the sample, not to be read.
 */
const historyThen = (last: SessionWithChildren | null): SessionWithChildren[] => {
  const background = Array.from({ length: 24 }, (_, i) =>
    night(`b${i}`, ((i % 7) - 3) * 30, (i + 5) * DAY),
  );
  return last === null ? background : [last, ...background];
};

/** The spread of the background history above, in big blinds for a four-hour night. */
const nightSpread = () => {
  // Measured through the function rather than recomputed here: a second copy of
  // `stretchSpread`'s arithmetic in a test is a second thing to keep right.
  let low = 0;
  while (carryOver(historyThen(night('x', -low, HOUR)), NOW)?.direction !== 'loss') {
    low += 5;
    if (low > 5_000) throw new Error('no loss threshold found');
  }
  return low;
};

describe('what the last night left behind', () => {
  it('says nothing after an ordinary night, which is most of them', () => {
    // The background's own middle. A card that spoke here would be furniture
    // inside a month.
    expect(carryOver(historyThen(night('last', 0, 12 * HOUR)), NOW)).toBeNull();
  });

  it('speaks after a night a long way below the player’s own average', () => {
    const carried = carryOver(historyThen(night('last', -nightSpread(), 12 * HOUR)), NOW);

    expect(carried?.direction).toBe('loss');
    expect(carried?.sessionId).toBe('last');
    expect(carried?.z ?? 0).toBeLessThanOrEqual(-CARRY_OVER_SIGMAS);
  });

  it('speaks after a heater, for the same reason and at the same distance', () => {
    // The asymmetry this must not have. A win carries over too, and the leak it
    // produces costs the same as the one a loss produces.
    const carried = carryOver(historyThen(night('last', nightSpread(), 12 * HOUR)), NOW);

    expect(carried?.direction).toBe('win');
    expect(carried?.z ?? 0).toBeGreaterThanOrEqual(CARRY_OVER_SIGMAS);
  });

  it('goes quiet once the night is out of the window', () => {
    const far = CARRY_OVER_WINDOW_MS + HOUR;
    expect(carryOver(historyThen(night('last', -nightSpread(), far)), NOW)).toBeNull();
  });

  it('still counts Friday when somebody comes back on Sunday', () => {
    const inside = CARRY_OVER_WINDOW_MS - HOUR;
    expect(carryOver(historyThen(night('last', -nightSpread(), inside)), NOW)?.direction).toBe(
      'loss',
    );
  });

  it('reads the last finished session, not the one that is running', () => {
    const live = night('live', 0, 0, { endedAt: null, cashOut: null });
    const finished = night('last', -nightSpread(), 2 * HOUR);

    expect(carryOver([live, ...historyThen(finished)], NOW)?.sessionId).toBe('last');
  });

  it('says nothing when there is no last session at all', () => {
    expect(carryOver(historyThen(null), NOW)).toBeNull();
    expect(carryOver([], NOW)).toBeNull();
  });

  describe('with nothing to scale by', () => {
    // A new player, a tournament, or a night with no blinds recorded. The
    // fallback fires more readily on purpose: somebody with no history is the
    // player least practiced at putting a night in context.
    it('reads a plain loss as one', () => {
      expect(carryOver([night('last', -5, 2 * HOUR)], NOW)).toEqual({
        direction: 'loss',
        sessionId: 'last',
        z: null,
      });
    });

    it('wants a night that more than doubled the buy-in before it calls it big', () => {
      // 150 big blinds is $300 on this game, which is exactly the buy-in.
      expect(carryOver([night('last', 150, 2 * HOUR)], NOW)).toBeNull();
      expect(carryOver([night('last', 151, 2 * HOUR)], NOW)?.direction).toBe('win');
    });

    it('reads a busted tournament as a loss', () => {
      const busted = night('last', 0, 2 * HOUR, {
        format: 'tournament',
        stakes: null,
        fee: 1_000,
        cashOut: 0,
        entrants: 120,
        finishPosition: 44,
      });

      expect(carryOver([busted], NOW)?.direction).toBe('loss');
    });

    it('does not read a break-even night as either', () => {
      expect(carryOver([night('last', 0, 2 * HOUR)], NOW)).toBeNull();
    });
  });
});
