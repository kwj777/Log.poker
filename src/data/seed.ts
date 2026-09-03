/**
 * Demo dataset -- 20 mixed-result sessions, so a fresh install has a dashboard
 * worth looking at and the variance view has enough history to say something.
 *
 * Deterministic: the same seed always produces the same data, which keeps
 * screenshots stable and lets a test assert on the result. Gated behind a dev
 * flag (`src/config.ts`) and never reachable from a production build.
 */

import { HAND_TAGS, type GameType, type HandTag, type MoodScore, type Position, type Stakes } from '../domain/types';
import type { Repository } from './repository';

/** mulberry32 -- small, fast, and identical across every JS engine we ship to. */
const makeRandom = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const STAKES: Record<string, Stakes> = {
  low: { smallBlind: 100, bigBlind: 200, currency: 'USD' },
  mid: { smallBlind: 100, bigBlind: 300, currency: 'USD' },
  high: { smallBlind: 200, bigBlind: 500, currency: 'USD' },
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
  gameType: GameType;
  stakes: Stakes;
  buyInDollars: number;
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
 */
const PLAN: readonly SessionPlan[] = [
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 245, hours: 4.5, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: -300, hours: 3, rebuyDollars: [200], startMoodScore: 2, endMoodScore: 4 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: 410, hours: 5.5, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -180, hours: 6, startMoodScore: 3, endMoodScore: 4 },
  { venue: 'wynn', gameType: 'NLHE', stakes: STAKES.high, buyInDollars: 1000, resultDollars: 1_240, hours: 7, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: 85, hours: 3.5, startMoodScore: 3, endMoodScore: 2 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: -200, hours: 4, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 520, hours: 8, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -300, hours: 2.5, startMoodScore: 4, endMoodScore: 5 },
  { venue: 'commerce', gameType: 'OTHER', stakes: STAKES.low, buyInDollars: 200, resultDollars: 60, hours: 3, startMoodScore: 2, endMoodScore: 2 },
  { venue: 'wynn', gameType: 'NLHE', stakes: STAKES.high, buyInDollars: 1000, resultDollars: -1_000, hours: 5, rebuyDollars: [500, 500], startMoodScore: 2, endMoodScore: 5 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: 175, hours: 4.5, startMoodScore: 1, endMoodScore: 2 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 310, hours: 5, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: -145, hours: 4, startMoodScore: 3, endMoodScore: 3 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -260, hours: 6.5, rebuyDollars: [300], startMoodScore: 2, endMoodScore: 4 },
  { venue: 'wynn', gameType: 'NLHE', stakes: STAKES.high, buyInDollars: 1000, resultDollars: 680, hours: 6, startMoodScore: 2, endMoodScore: 1 },
  { venue: 'home', gameType: 'PLO', stakes: STAKES.low, buyInDollars: 200, resultDollars: -95, hours: 3.5, startMoodScore: 2, endMoodScore: 3 },
  { venue: 'commerce', gameType: 'NLHE', stakes: STAKES.mid, buyInDollars: 300, resultDollars: 220, hours: 4, startMoodScore: 1, endMoodScore: 1 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: -420, hours: 5, rebuyDollars: [300], startMoodScore: 3, endMoodScore: 5 },
  { venue: 'aria', gameType: 'NLHE', stakes: STAKES.low, buyInDollars: 300, resultDollars: 390, hours: 4.5, startMoodScore: 2, endMoodScore: 1 },
];

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

export const DEMO_SESSION_COUNT = PLAN.length;

/**
 * Write the demo dataset. Sessions are spaced roughly every three days working
 * backwards from `now`, so the bankroll graph spans a believable couple of months.
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
  for (const [index, plan] of PLAN.entries()) {
    const sessionsFromEnd = PLAN.length - 1 - index;
    const startedAt =
      now - sessionsFromEnd * 3 * DAY - Math.round(plan.hours * HOUR) - 6 * HOUR;
    const endedAt = startedAt + Math.round(plan.hours * HOUR);

    const buyIn = plan.buyInDollars * 100;
    const rebuys = (plan.rebuyDollars ?? []).map((amount) => amount * 100);
    const invested = buyIn + rebuys.reduce((sum, amount) => sum + amount, 0);
    // The plan states the result; cash-out is derived so the math always ties out.
    const cashOut = Math.max(0, invested + plan.resultDollars * 100);

    const session = await repository.createSession({
      venueId: venues[plan.venue].id,
      gameType: plan.gameType,
      stakes: plan.stakes,
      buyIn,
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
        amount: Math.round((random() * 2 - 1) * plan.stakes.bigBlind * 120),
      });
      handCount += 1;
    }

    await repository.endSession(session.id, cashOut, endedAt);
  }

  return {
    venues: Object.keys(venues).length,
    sessions: PLAN.length,
    hands: handCount,
    moodEntries: moodCount,
  };
};
