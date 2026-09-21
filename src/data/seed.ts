/**
 * Demo dataset -- 32 mixed-result sessions, so a fresh install has a dashboard
 * worth looking at and the variance view has enough history to say something.
 *
 * Deterministic: the same seed always produces the same data, which keeps
 * screenshots stable and lets a test assert on the result. Gated behind a dev
 * flag (`src/config.ts`) and never reachable from a production build.
 */

import { makeRandom } from '../domain/random';
import {
  HAND_TAGS,
  type GameType,
  type HandTag,
  type MoodScore,
  type Position,
  type SessionFormat,
  type Stakes,
} from '../domain/types';
import type { Repository } from './repository';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const STAKES: Record<string, Stakes> = {
  low: { smallBlind: 100, bigBlind: 200 },
  mid: { smallBlind: 100, bigBlind: 300 },
  high: { smallBlind: 200, bigBlind: 500 },
};

const POSITIONS: Position[] = ['UTG', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

const HOLE_CARDS = [
  'AsKd', 'QhQc', '8h8d', 'AhAc', 'Jd Tc'.replace(' ', ''), '7s6s', 'KcQc', '9d9s',
  'AcJh', 'TdTh', '5h5c', 'KdKs', 'Ah5h', 'QsJs', '4c4d', 'AdQd',
];

const HAND_NOTES = [
  'Set over set, no way to fold',
  'Turned the nut flush draw, missed',
  'Three-bet pot, got there on the river',
  'Overplayed top pair against the nit',
  'Ran a triple barrel, he called with ace high',
  'Flopped a set, stacked the loose player',
  'Should have folded the river',
  'Cracked aces with a suited connector',
  'Rivered a boat against his flush',
  'Barrelled into the calling station again',
];

interface SessionPlan {
  venue: 'aria' | 'commerce' | 'home' | 'wynn';
  /** Defaults to a cash game. */
  format?: SessionFormat;
  gameType: GameType;
  /** Cash games only; a tournament has none. */
  stakes?: Stakes;
  buyInDollars: number;
  /** Tournament entry fee, in dollars. */
  feeDollars?: number;
  entrants?: number;
  finishPosition?: number;
  /** Result in dollars, before rebuys are added back. */
  resultDollars: number;
  hours: number;
  rebuyDollars?: number[];
  startMoodScore: MoodScore;
  endMoodScore: MoodScore;
}

/**
 * Hand-authored rather than randomized: the shape of this data is the demo.
 * It is a modest winner (positive overall) with realistic swings, one brutal
 * night, and a couple of heaters -- enough for the variance view to have
 * something honest to say.
 *
 * ## The mood shape, which is also deliberate
 *
 * Six of the twenty cash nights start at 4 or 5, and this player does worse on
 * them: enough for `startMoodComparison` to settle rather than refuse, so the
 * "What tilt costs you" card has something to show. It shipped without that and
 * the card could only ever say *not enough to compare yet*, which demonstrates
 * nothing.
 *
 * **Only the mood labels were chosen for it. Not one result moved**, so the
 * bankroll curve, the totals and every variance verdict are exactly what they
 * were. What changed is which nights this player is recorded as having *arrived*
 * rattled on, and they are mostly nights that already went badly, which is the
 * relationship the feature exists to look for rather than one invented for it.
 *
 * **It is still a constructed player, and nobody should read the demo as
 * evidence.** One of the six went fine, a small win at mid stakes calming from a
 * 4 to a 2, because six for six would be a caricature and the real thing is
 * noisy. The gap it produces is around 37 bb/hour, which is large; a smaller one
 * would not clear the significance bar at only six sessions, and that trade is
 * the arithmetic rather than a choice.
 */
const PLAN: readonly SessionPlan[] = [
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 245, hours: 4.5, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: -300, hours: 3, rebuyDollars: [200], startMoodScore: 2, endMoodScore: 4 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: 410, hours: 5.5, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -180, hours: 6, startMoodScore: 4, endMoodScore: 4 },
  { venue: 'wynn', gameType: 'NLHE', stakes: STAKES.high, buyInDollars: 1000, resultDollars: 1_240, hours: 7, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: 85, hours: 3.5, startMoodScore: 4, endMoodScore: 2 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: -200, hours: 4, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 520, hours: 8, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -300, hours: 2.5, startMoodScore: 4, endMoodScore: 5 },
  { venue: 'commerce', gameType: 'OTHER', stakes: STAKES.low, buyInDollars: 200, resultDollars: 60, hours: 3, startMoodScore: 2, endMoodScore: 2 },
  { venue: 'wynn', gameType: 'NLHE', stakes: STAKES.high, buyInDollars: 1000, resultDollars: -1_000, hours: 5, rebuyDollars: [500, 500], startMoodScore: 2, endMoodScore: 5 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: 175, hours: 4.5, startMoodScore: 1, endMoodScore: 2 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 310, hours: 5, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: -145, hours: 4, startMoodScore: 4, endMoodScore: 3 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -260, hours: 6.5, rebuyDollars: [300], startMoodScore: 4, endMoodScore: 4 },
  { venue: 'wynn', gameType: 'NLHE', stakes: STAKES.high, buyInDollars: 1000, resultDollars: 680, hours: 6, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: -95, hours: 3.5, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: 220, hours: 4, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -420, hours: 5, rebuyDollars: [300], startMoodScore: 5, endMoodScore: 5 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 390, hours: 4.5, startMoodScore: 2, endMoodScore: 1 },
];

/**
 * Tournaments, and shaped like tournaments: seven entries, two cashes, and one
 * of those carrying the whole set. A demo that showed a tidy 60% cash rate would
 * make the copy on the tournament card look like it was written for somebody
 * else, because the copy is about exactly this shape.
 */
const TOURNAMENT_PLAN: readonly SessionPlan[] = [
  { venue: 'aria', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 210, finishPosition: 88, resultDollars: -110, hours: 3.5, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'wynn', format: 'tournament', gameType: 'NLHE', buyInDollars: 200, feeDollars: 20, entrants: 143, finishPosition: 12, resultDollars: 415, hours: 7.5, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'aria', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 188, finishPosition: 121, resultDollars: -110, hours: 2.5, startMoodScore: 3, endMoodScore: 3 },
  { venue: 'commerce', format: 'tournament', gameType: 'PLO', buyInDollars: 150, feeDollars: 15, entrants: 96, finishPosition: 40, resultDollars: -165, hours: 4, startMoodScore: 2, endMoodScore: 4 },
  { venue: 'aria', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 240, finishPosition: 3, resultDollars: 2_640, hours: 11, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'wynn', format: 'tournament', gameType: 'NLHE', buyInDollars: 200, feeDollars: 20, entrants: 167, finishPosition: 94, resultDollars: -220, hours: 3, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'aria', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 205, finishPosition: 61, resultDollars: -110, hours: 4.5, startMoodScore: 2, endMoodScore: 4 },
  { venue: 'commerce', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 132, finishPosition: 77, resultDollars: -110, hours: 3, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'wynn', format: 'tournament', gameType: 'NLHE', buyInDollars: 200, feeDollars: 20, entrants: 154, finishPosition: 110, resultDollars: -220, hours: 2.5, startMoodScore: 3, endMoodScore: 4 },
  { venue: 'aria', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 219, finishPosition: 24, resultDollars: 180, hours: 6, startMoodScore: 2, endMoodScore: 2 },
  { venue: 'aria', format: 'tournament', gameType: 'NLHE', buyInDollars: 100, feeDollars: 10, entrants: 197, finishPosition: 143, resultDollars: -110, hours: 2, startMoodScore: 2, endMoodScore: 4 },
  { venue: 'commerce', format: 'tournament', gameType: 'PLO', buyInDollars: 150, feeDollars: 15, entrants: 88, finishPosition: 51, resultDollars: -165, hours: 3.5, startMoodScore: 3, endMoodScore: 3 },
];

/**
 * Cash and tournaments interleaved by date rather than appended, so the bankroll
 * curve looks like a life rather than two careers stacked end to end.
 *
 * Spread evenly whatever the two lengths are, rather than every nth: the
 * tournament count is chosen to clear `MIN_ENTRIES_FOR_INTERVAL` so the demo
 * actually shows the ROI range, and that number should be free to move without
 * a divisor here quietly dropping entries off the end.
 */
const ALL_PLANS: readonly SessionPlan[] = PLAN.flatMap((plan, index) => {
  const placed = Math.floor((index * TOURNAMENT_PLAN.length) / PLAN.length);
  const wanted = Math.floor(((index + 1) * TOURNAMENT_PLAN.length) / PLAN.length);
  return wanted > placed ? [plan, TOURNAMENT_PLAN[placed]] : [plan];
});

export interface SeedOptions {
  /** Anchor for the most recent session. Defaults to now. */
  now?: number;
  /** Change to get a different (but still repeatable) set of hands. */
  seed?: number;
  /** Wipe existing data first. Defaults to true. */
  clear?: boolean;
}

export interface SeedResult {
  venues: number;
  sessions: number;
  hands: number;
  moodEntries: number;
}

export const DEMO_SESSION_COUNT = ALL_PLANS.length;
export const DEMO_TOURNAMENT_COUNT = ALL_PLANS.filter(
  (plan) => plan.format === 'tournament',
).length;

/** The whole demo set spans this, whatever the plan grows to. */
const DEMO_SPAN_DAYS = 70;

/**
 * Write the demo dataset. Sessions are spread evenly backwards from `now` across
 * `DEMO_SPAN_DAYS`, so the bankroll graph covers a believable couple of months.
 *
 * Derived from the plan length rather than a fixed gap between sessions: a fixed
 * gap means every session added to the plan stretches the demo further into the
 * past, and a "couple of months" quietly becomes half a year.
 */
export const seedDemoData = async (
  repository: Repository,
  options: SeedOptions = {},
): Promise<SeedResult> => {
  const { now = Date.now(), seed = 20_240_115, clear = true } = options;
  const random = makeRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

  if (clear) await repository.clearAll();

  const venues = {
    aria: await repository.createVenue({ name: 'Aria', isHomeGame: false }),
    commerce: await repository.createVenue({ name: 'Commerce Casino', isHomeGame: false }),
    home: await repository.createVenue({ name: 'Tuesday Home Game', isHomeGame: true }),
    wynn: await repository.createVenue({ name: 'Wynn', isHomeGame: false }),
  };

  let handCount = 0;
  let moodCount = 0;

  // Oldest first so the ids and the bankroll curve read chronologically.
  for (const [index, plan] of ALL_PLANS.entries()) {
    const sessionsFromEnd = ALL_PLANS.length - 1 - index;
    const spacing = (DEMO_SPAN_DAYS * DAY) / Math.max(1, ALL_PLANS.length - 1);
    const startedAt =
      now - Math.round(sessionsFromEnd * spacing) - Math.round(plan.hours * HOUR) - 6 * HOUR;
    const endedAt = startedAt + Math.round(plan.hours * HOUR);

    const buyIn = plan.buyInDollars * 100;
    const fee = (plan.feeDollars ?? 0) * 100;
    const rebuys = (plan.rebuyDollars ?? []).map((amount) => amount * 100);
    const invested = buyIn + fee + rebuys.reduce((sum, amount) => sum + amount, 0);
    // The plan states the result; cash-out is derived so the math always ties out.
    const cashOut = Math.max(0, invested + plan.resultDollars * 100);

    const session = await repository.createSession({
      venueId: venues[plan.venue].id,
      format: plan.format ?? 'cash',
      gameType: plan.gameType,
      stakes: plan.stakes,
      buyIn,
      fee: fee === 0 ? null : fee,
      entrants: plan.entrants ?? null,
      finishPosition: plan.finishPosition ?? null,
      startedAt,
    });

    for (const [rebuyIndex, amount] of rebuys.entries()) {
      await repository.addRebuy({
        sessionId: session.id,
        amount,
        at: startedAt + (rebuyIndex + 1) * Math.round((plan.hours * HOUR) / (rebuys.length + 1)),
      });
    }

    await repository.createMoodEntry({
      sessionId: session.id,
      phase: 'start',
      score: plan.startMoodScore,
      at: startedAt,
    });
    moodCount += 1;

    // A mid-session check-in on the longer nights only -- the app is deliberately
    // shy about interrupting a short session.
    if (plan.hours >= 5) {
      await repository.createMoodEntry({
        sessionId: session.id,
        phase: 'mid',
        score: Math.max(1, Math.min(5, Math.round((plan.startMoodScore + plan.endMoodScore) / 2))) as MoodScore,
        at: startedAt + Math.round((plan.hours * HOUR) / 2),
      });
      moodCount += 1;
    }

    await repository.createMoodEntry({
      sessionId: session.id,
      phase: 'end',
      score: plan.endMoodScore,
      at: endedAt,
    });
    moodCount += 1;

    // One to three logged hands per session, weighted so a losing night leaves
    // behind the tags a player would actually reach for.
    const handsToLog = 1 + Math.floor(random() * 3);
    for (let handIndex = 0; handIndex < handsToLog; handIndex += 1) {
      const losing = plan.resultDollars < 0;
      const tagPool: HandTag[] = losing
        ? ['bad_beat', 'cooler', 'misplayed']
        : ['bluff', 'cooler', 'misplayed'];
      const tags: HandTag[] = [pick(tagPool)];
      if (random() < 0.2) {
        const second = pick(HAND_TAGS);
        if (!tags.includes(second)) tags.push(second);
      }

      await repository.createHand({
        sessionId: session.id,
        at: startedAt + Math.round(random() * (endedAt - startedAt)),
        holeCards: pick(HOLE_CARDS),
        position: pick(POSITIONS),
        note: pick(HAND_NOTES),
        tags,
        // Sized off the big blind for a cash game, off the entry for a tournament.
        amount: Math.round((random() * 2 - 1) * (plan.stakes ? plan.stakes.bigBlind * 120 : buyIn)),
      });
      handCount += 1;
    }

    await repository.endSession(session.id, cashOut, endedAt);
  }

  return {
    venues: Object.keys(venues).length,
    // `ALL_PLANS`, which is what the loop above writes: `PLAN` is the cash half
    // alone, so Settings reported 20 sessions after writing 32 and anybody who
    // counted the history screen found the seeder lying about its own work.
    sessions: DEMO_SESSION_COUNT,
    hands: handCount,
    moodEntries: moodCount,
  };
};
