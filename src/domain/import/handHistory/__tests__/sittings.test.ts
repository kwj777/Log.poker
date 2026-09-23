/**
 * Where imported hands go.
 *
 * The first case is the question this feature was built to answer: start a
 * session on the phone, play online, import the hands on the laptop while
 * the session is still running, and the hands go into it.
 */

import {
  BIG_POT_BB,
  MATCH_SLACK_MS,
  SITTING_GAP_MS,
  candidateSessions,
  defaultDestination,
  groupSittings,
  handFromParsed,
  handIdentity,
  isBigPot,
  matchSession,
  planHandImport,
  sessionFromSitting,
  sittingImportKey,
  type Destination,
  type ParsedHand,
} from '..';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 8, 23, 18);

let serial = 0;
const hand = (overrides: Partial<ParsedHand> = {}): ParsedHand => {
  serial += 1;
  return {
    site: 'PokerStars',
    handId: String(1000 + serial),
    table: 'Aludra',
    at: T0,
    zoned: true,
    format: 'cash',
    tournamentId: null,
    currency: 'USD',
    gameType: 'NLHE',
    smallBlind: 5,
    bigBlind: 10,
    hero: 'Hero',
    holeCards: 'AsKd',
    board: null,
    position: 'BTN',
    net: 0,
    stack: 1000,
    showdown: false,
    ...overrides,
  };
};

const session = (
  id: string,
  startedAt: number,
  endedAt: number | null,
  importKey: string | null = null,
) => ({ id, startedAt, endedAt, importKey });

describe('grouping hands into sittings', () => {
  it('keeps tables played at once together, and splits at a long break', () => {
    const sittings = groupSittings([
      hand({ at: T0, table: 'A' }),
      hand({ at: T0 + MIN, table: 'B' }),
      hand({ at: T0 + 20 * MIN, table: 'A' }),
      hand({ at: T0 + 20 * MIN + SITTING_GAP_MS + 1, table: 'A' }),
    ]);
    expect(sittings.map((sitting) => sitting.hands.length)).toEqual([3, 1]);
    expect(sittings[0].tables).toBe(2);
    expect(sittings[0].startedAt).toBe(T0);
    expect(sittings[0].endedAt).toBe(T0 + 20 * MIN);
  });

  it('keeps apart games that cannot share a session', () => {
    const sittings = groupSittings([
      hand({ at: T0 }),
      hand({ at: T0 + MIN, smallBlind: 10, bigBlind: 25 }),
      hand({ at: T0 + 2 * MIN, currency: null }),
    ]);
    expect(sittings).toHaveLength(3);
    expect(sittings.map((sitting) => sitting.money)).toEqual([true, true, false]);
  });

  it('keeps a tournament whole across a long break', () => {
    const sittings = groupSittings([
      hand({ at: T0, format: 'tournament', tournamentId: '9', currency: null }),
      hand({ at: T0 + 3 * HOUR, format: 'tournament', tournamentId: '9', currency: null }),
    ]);
    expect(sittings).toHaveLength(1);
    expect(sittings[0].money).toBe(false);
  });
});

describe('matching a sitting to a session', () => {
  it('puts hands into the session still running, which is the case this was built for', () => {
    const [sitting] = groupSittings([hand({ at: T0 + 10 * MIN }), hand({ at: T0 + 2 * HOUR })]);
    const running = session('live', T0, null);
    const now = T0 + 2 * HOUR + 5 * MIN;
    expect(matchSession(sitting, [running], now)).toBe('live');
    expect(defaultDestination(sitting, [running], now)).toEqual({
      kind: 'session',
      sessionId: 'live',
    });
  });

  it('allows for tables opened before Start was tapped and played after End', () => {
    const [before] = groupSittings([hand({ at: T0 - MATCH_SLACK_MS + MIN })]);
    const [after] = groupSittings([hand({ at: T0 + HOUR + MATCH_SLACK_MS - MIN })]);
    const [far] = groupSittings([hand({ at: T0 + HOUR + MATCH_SLACK_MS + MIN })]);
    const played = session('s', T0, T0 + HOUR);
    expect(matchSession(before, [played], T0 + 5 * HOUR)).toBe('s');
    expect(matchSession(after, [played], T0 + 5 * HOUR)).toBe('s');
    expect(matchSession(far, [played], T0 + 5 * HOUR)).toBeNull();
  });

  it('picks the session covering the most hands, and the running one on a tie', () => {
    const [sitting] = groupSittings([
      hand({ at: T0 }),
      hand({ at: T0 + 20 * MIN }),
      hand({ at: T0 + 40 * MIN }),
      hand({ at: T0 + 60 * MIN }),
    ]);
    const early = session('early', T0 - 2 * HOUR, T0 - 10 * MIN);
    const late = session('late', T0 + 30 * MIN, T0 + 3 * HOUR);
    expect(matchSession(sitting, [early, late], T0 + 5 * HOUR)).toBe('late');

    const [short] = groupSittings([hand({ at: T0 })]);
    const finished = session('done', T0 - HOUR, T0);
    const running = session('live', T0, null);
    expect(matchSession(short, [finished, running], T0 + MIN)).toBe('live');
  });

  it('sends a sitting back to the session it made last time', () => {
    const [sitting] = groupSittings([hand({ at: T0 })]);
    const own = session('mine', T0 - 10 * HOUR, T0 - 9 * HOUR, sittingImportKey(sitting));
    const overlapping = session('other', T0 - HOUR, T0 + HOUR);
    expect(matchSession(sitting, [overlapping, own], T0 + HOUR)).toBe('mine');
  });

  it('makes a new session for real money with nowhere to go, and leaves chips out', () => {
    const [cash] = groupSittings([hand({ at: T0 })]);
    const [chips] = groupSittings([hand({ at: T0, currency: null })]);
    expect(defaultDestination(cash, [], T0)).toEqual({ kind: 'new' });
    expect(defaultDestination(chips, [], T0)).toEqual({ kind: 'skip' });
  });

  it('offers the running session and the ones near in time, nearest first', () => {
    const [sitting] = groupSittings([hand({ at: T0 })]);
    const offered = candidateSessions(sitting, [
      session('last-month', T0 - 30 * 24 * HOUR, T0 - 30 * 24 * HOUR + HOUR),
      session('yesterday', T0 - 20 * HOUR, T0 - 18 * HOUR),
      session('tonight', T0 - HOUR, T0 + HOUR),
      session('live', T0 - 40 * 24 * HOUR, null),
    ]);
    expect(offered.map((s) => s.id)).toEqual(['tonight', 'yesterday', 'live']);
  });
});

describe('a session built from a sitting', () => {
  it('ends with the chips left on every table and started with that less the result', () => {
    const [sitting] = groupSittings([
      hand({ at: T0, table: 'A', stack: 1000, net: -300 }),
      hand({ at: T0 + MIN, table: 'B', stack: 1000, net: 250 }),
      // Topped back up on A between hands: the stack says so, and the buy-in
      // picks it up without the file having to.
      hand({ at: T0 + 2 * MIN, table: 'A', stack: 1000, net: 120 }),
    ]);
    const built = sessionFromSitting(sitting);
    // Left: A 1000 + 120 = 1120, B 1000 + 250 = 1250. Result +70.
    expect(built?.draft).toMatchObject({
      format: 'cash',
      currency: 'USD',
      stakes: { smallBlind: 5, bigBlind: 10 },
      cashOut: 2370,
      buyIn: 2300,
      startedAt: T0,
      endedAt: T0 + 2 * MIN,
    });
    expect(built?.venueName).toBe('PokerStars');
    expect(built?.importKey).toBe(sittingImportKey(sitting));
  });

  it('is not made from chips', () => {
    const [sitting] = groupSittings([hand({ currency: null })]);
    expect(sessionFromSitting(sitting)).toBeNull();
  });
});

describe('the hand a parsed hand becomes', () => {
  it('carries its result as money at a real-money table', () => {
    const written = handFromParsed(hand({ handId: '77', net: 1131, table: 'Skat' }), 's1');
    expect(written).toMatchObject({
      sessionId: 's1',
      amount: 1131,
      note: 'PokerStars hand #77, table Skat',
      tags: [],
    });
  });

  it('carries a chip result in the note rather than as money', () => {
    const written = handFromParsed(hand({ handId: '78', net: 425000, currency: null }), 's1');
    expect(written.amount).toBeNull();
    expect(written.note).toBe('PokerStars hand #78, table Aludra. +4,250 chips');
  });
});

describe('planning an import', () => {
  const big = BIG_POT_BB * 10;

  it('takes the big pots by default and every hand when asked', () => {
    const sittings = groupSittings([
      hand({ at: T0, net: big }),
      hand({ at: T0 + MIN, net: -big }),
      hand({ at: T0 + 2 * MIN, net: big - 1 }),
    ]);
    expect(sittings[0].hands.filter(isBigPot)).toHaveLength(2);
    const to: Map<string, Destination> = new Map([
      [sittings[0].key, { kind: 'session', sessionId: 's' }],
    ]);
    expect(planHandImport(sittings, to, false, new Set()).groups[0].hands).toHaveLength(2);
    expect(planHandImport(sittings, to, true, new Set()).groups[0].hands).toHaveLength(3);
  });

  it('leaves out what is already in the log, and what was sent nowhere', () => {
    const first = hand({ at: T0, net: big });
    const second = hand({ at: T0 + MIN, net: big });
    const elsewhere = hand({ at: T0 + 5 * HOUR, net: big });
    const sittings = groupSittings([first, second, elsewhere]);
    const to: Map<string, Destination> = new Map([
      [sittings[0].key, { kind: 'session', sessionId: 's' }],
      [sittings[1].key, { kind: 'skip' }],
    ]);
    const plan = planHandImport(sittings, to, false, new Set([handIdentity(first)]));
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].hands).toEqual([second]);
    expect(plan.duplicates).toBe(1);
    expect(plan.skipped).toBe(1);
  });

  it('builds a new session from every hand even when only big pots are kept', () => {
    const sittings = groupSittings([
      hand({ at: T0, net: big, stack: 1000 }),
      hand({ at: T0 + MIN, net: -5, stack: 1000 + big }),
    ]);
    const plan = planHandImport(sittings, new Map([[sittings[0].key, { kind: 'new' }]]), false, new Set());
    expect(plan.groups[0].hands).toHaveLength(1);
    expect(plan.groups[0].session?.draft.cashOut).toBe(1000 + big - 5);
    expect(plan.groups[0].session?.draft.buyIn).toBe(1000);
  });
});
