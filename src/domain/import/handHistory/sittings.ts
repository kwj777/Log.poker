/**
 * Which session each imported hand goes into.
 *
 * ## Sittings
 *
 * A file of hands is grouped into sittings first: hands at one site, one game
 * and one stake, with no gap longer than `SITTING_GAP_MS` between them. Four
 * tables played at once are one sitting, because they are one night; the same
 * table after dinner is a second. A sitting is the thing a player recognizes
 * ("Tuesday's 25NL"), and it is what gets a destination, so a night's hands
 * never end up split between two sessions by accident.
 *
 * ## Where a sitting goes
 *
 * Into the session whose clock it falls inside: the session that was running,
 * give or take `MATCH_SLACK_MS`, while the most of its hands were dealt. A
 * session still running counts as running until now. That is the case the
 * whole feature was asked for: start a session on the phone, play online,
 * import the hands on the laptop before ending it, and the hands are in it.
 *
 * With no session to go into, a real-money cash sitting becomes a session of
 * its own, built from the hands: it started with the first hand, ended with
 * the last, and its result is what the hands add up to. A tournament or a
 * play-money sitting has no money to build one from, so it goes nowhere until
 * the player picks a session for it. Nothing is invented.
 *
 * The match is a default, not a verdict. The preview shows where each sitting
 * is going and lets the player send it somewhere else, which also covers the
 * file whose clock could not be read.
 */

import type { ImportedSession } from '../sessionImport';
import type { Cents, Hand, NewHand, Session, Stakes, Timestamp } from '../../types';
import type { HandSite, ParsedHand } from './types';

/** A break longer than this starts a new sitting. */
export const SITTING_GAP_MS = 30 * 60_000;

/**
 * How far outside a session's own start and end a hand can fall and still
 * belong to it. People open the tables before they tap Start, and play the
 * last orbit after they tap End.
 */
export const MATCH_SLACK_MS = 30 * 60_000;

/**
 * A pot this big, in big blinds, is one worth a journal entry by default.
 *
 * A night online is hundreds of hands, and Log's hand list is a journal of the
 * ones worth remembering, not a database of every orbit folded. So the preview
 * starts with the hands that moved at least this much and offers every hand as
 * the other choice.
 */
export const BIG_POT_BB = 20;

export interface Sitting {
  /** Stable for a given file, so a choice made in the preview survives a re-render. */
  key: string;
  site: HandSite;
  hands: ParsedHand[];
  startedAt: Timestamp;
  endedAt: Timestamp;
  tables: number;
  /** Real-money cash at a single currency: the only kind a session can be built from. */
  money: boolean;
  /** Every hand's time was read with a zone, so the match is not a guess. */
  zoned: boolean;
}

const groupKey = (hand: ParsedHand): string =>
  [
    hand.site,
    hand.format,
    hand.tournamentId ?? '',
    hand.currency ?? 'chips',
    hand.gameType,
    hand.smallBlind ?? '',
    hand.bigBlind ?? '',
  ].join('|');

/** Hands in, sittings out, earliest first. `hands` must be sorted by time. */
export const groupSittings = (hands: readonly ParsedHand[]): Sitting[] => {
  const open = new Map<string, ParsedHand[]>();
  const done: ParsedHand[][] = [];
  for (const hand of hands) {
    const key = groupKey(hand);
    const current = open.get(key);
    // A tournament is one sitting however long a break it has in it.
    const gap = hand.format === 'tournament' ? Infinity : SITTING_GAP_MS;
    if (current && hand.at - current[current.length - 1].at <= gap) {
      current.push(hand);
    } else {
      if (current) done.push(current);
      open.set(key, [hand]);
    }
  }
  done.push(...open.values());

  return done
    .map((group) => ({
      key: `${group[0].site}:${group[0].handId}`,
      site: group[0].site,
      hands: group,
      startedAt: group[0].at,
      endedAt: group[group.length - 1].at,
      tables: new Set(group.map((hand) => hand.table ?? '')).size,
      money: group[0].format === 'cash' && group[0].currency !== null,
      zoned: group.every((hand) => hand.zoned),
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
};

/** Whether a hand moved enough to be worth a journal entry on its own. */
export const isBigPot = (hand: ParsedHand): boolean =>
  hand.bigBlind !== null && hand.bigBlind > 0 && Math.abs(hand.net) >= BIG_POT_BB * hand.bigBlind;

type SessionLike = Pick<Session, 'id' | 'startedAt' | 'endedAt' | 'importKey'>;

const covers = (session: SessionLike, at: Timestamp, now: number): boolean =>
  at >= session.startedAt - MATCH_SLACK_MS &&
  at <= (session.endedAt ?? Math.max(now, session.startedAt)) + MATCH_SLACK_MS;

/** The import key of the session a sitting would become, fixed by its first hand. */
export const sittingImportKey = (sitting: Sitting): string =>
  `hands|${sitting.site.toLowerCase()}|${sitting.hands[0].handId}`;

/**
 * The session a sitting belongs in, or null when none was running.
 *
 * A session this import made last time wins outright, which is what makes
 * importing the same file twice land the hands in the same place. Otherwise
 * it is the session that covers the most of the sitting's hands, and on a tie
 * the one still running.
 */
export const matchSession = (
  sitting: Sitting,
  sessions: readonly SessionLike[],
  now: number,
): string | null => {
  const key = sittingImportKey(sitting);
  const own = sessions.find((session) => session.importKey === key);
  if (own) return own.id;

  let best: { id: string; count: number; live: boolean } | null = null;
  for (const session of sessions) {
    const count = sitting.hands.filter((hand) => covers(session, hand.at, now)).length;
    if (count === 0) continue;
    const live = session.endedAt === null;
    if (!best || count > best.count || (count === best.count && live && !best.live)) {
      best = { id: session.id, count, live };
    }
  }
  return best?.id ?? null;
};

/** Where a sitting's hands go. */
export type Destination = { kind: 'session'; sessionId: string } | { kind: 'new' } | { kind: 'skip' };

export const defaultDestination = (
  sitting: Sitting,
  sessions: readonly SessionLike[],
  now: number,
): Destination => {
  const matched = matchSession(sitting, sessions, now);
  if (matched !== null) return { kind: 'session', sessionId: matched };
  return sitting.money ? { kind: 'new' } : { kind: 'skip' };
};

/**
 * The sessions worth offering as somewhere else to put a sitting: the one
 * running now, and any that started within a day of it, nearest first.
 */
export const candidateSessions = <S extends SessionLike>(
  sitting: Sitting,
  sessions: readonly S[],
  limit = 4,
): S[] => {
  const day = 24 * 60 * 60_000;
  const near = sessions
    .filter(
      (session) =>
        session.endedAt === null ||
        Math.abs(session.startedAt - sitting.startedAt) <= day,
    )
    .sort(
      (a, b) =>
        Math.abs(a.startedAt - sitting.startedAt) - Math.abs(b.startedAt - sitting.startedAt),
    );
  return near.slice(0, limit);
};

/**
 * The session a sitting becomes when there is none to put it in.
 *
 * The cash-out is the chips left on every table after the last hand there, and
 * the buy-in is that less what the hands won. Worked backwards like that, a
 * top-up in the middle of the night is part of the buy-in without the file
 * having to say when it happened, and the result is exactly what the hands add
 * up to, which is the one figure a hand history can be trusted for.
 */
export const sessionFromSitting = (sitting: Sitting): ImportedSession | null => {
  if (!sitting.money) return null;
  const first = sitting.hands[0];
  const lastByTable = new Map<string, ParsedHand>();
  for (const hand of sitting.hands) lastByTable.set(hand.table ?? '', hand);

  let cashOut: Cents = 0;
  for (const hand of lastByTable.values()) {
    if (hand.stack === null) return null;
    cashOut += Math.max(0, hand.stack + hand.net);
  }
  const net = sitting.hands.reduce((sum, hand) => sum + hand.net, 0);
  const buyIn = Math.max(0, cashOut - net);

  const stakes: Stakes | null =
    first.smallBlind !== null && first.bigBlind !== null
      ? { smallBlind: first.smallBlind, bigBlind: first.bigBlind }
      : null;

  return {
    importKey: sittingImportKey(sitting),
    venueName: sitting.site,
    line: 0,
    draft: {
      format: 'cash',
      gameType: first.gameType,
      stakes,
      currency: first.currency as string,
      buyIn,
      fee: null,
      cashOut: buyIn + net,
      entrants: null,
      finishPosition: null,
      startedAt: sitting.startedAt,
      endedAt: sitting.endedAt,
      notes: `From ${sitting.site} hand histories: ${sitting.hands.length} hand${
        sitting.hands.length === 1 ? '' : 's'
      } on ${sitting.tables} table${sitting.tables === 1 ? '' : 's'}.`,
    },
  };
};

const formatChips = (hundredths: number): string => {
  const chips = Math.round(hundredths / 100);
  return `${chips > 0 ? '+' : ''}${chips.toLocaleString('en-US')}`;
};

/**
 * The journal entry a hand becomes.
 *
 * The note says where it came from, which is also how somebody finds it again
 * by searching for the hand number the site shows. `amount` is money, so a
 * hand played for chips carries its result in the note instead: a play-money
 * pot of 3,450 is not $34.50, and the bankroll-adjacent totals on the Variance
 * tab would read it as though it were.
 */
export const handFromParsed = (hand: ParsedHand, sessionId: string): NewHand => {
  const where = hand.table === null ? '' : `, table ${hand.table}`;
  const chips = hand.currency === null ? `. ${formatChips(hand.net)} chips` : '';
  return {
    sessionId,
    at: hand.at,
    holeCards: hand.holeCards,
    board: hand.board,
    position: hand.position,
    note: `${hand.site} hand #${hand.handId}${where}${chips}`,
    tags: [],
    amount: hand.currency === null ? null : hand.net,
  };
};

/**
 * Whether a hand is already in the log: the same moment and the same cards.
 *
 * Not a stored key, deliberately. A key would be a new column on every hand,
 * on two storage engines and the sync format, for a question this answers
 * already: two different hands dealt the same two cards in the same second is
 * not something that happens.
 */
export const handIdentity = (hand: Pick<Hand, 'at' | 'holeCards'>): string =>
  `${hand.at}|${hand.holeCards ?? ''}`;

export interface HandImportGroup {
  destination: Exclude<Destination, { kind: 'skip' }>;
  /** Set when the destination is a new session. */
  session: ImportedSession | null;
  hands: ParsedHand[];
}

export interface HandImportPlan {
  groups: HandImportGroup[];
  /** Hands already in the log, left alone. */
  duplicates: number;
  /** Hands in sittings sent nowhere. */
  skipped: number;
}

/**
 * What an import will write, worked out before anything is.
 *
 * `every` is the preview's choice between the big pots and the whole file. A
 * new session is always built from every hand in the sitting whichever is
 * chosen, because its result is the sum of all of them, even when only the
 * big pots become journal entries.
 */
export const planHandImport = (
  sittings: readonly Sitting[],
  destinations: ReadonlyMap<string, Destination>,
  every: boolean,
  stored: ReadonlySet<string>,
): HandImportPlan => {
  const groups: HandImportGroup[] = [];
  let duplicates = 0;
  let skipped = 0;

  for (const sitting of sittings) {
    const destination = destinations.get(sitting.key) ?? { kind: 'skip' };
    const chosen = every ? sitting.hands : sitting.hands.filter(isBigPot);
    if (destination.kind === 'skip') {
      skipped += chosen.length;
      continue;
    }
    const fresh = chosen.filter((hand) => !stored.has(handIdentity(hand)));
    duplicates += chosen.length - fresh.length;

    const session = destination.kind === 'new' ? sessionFromSitting(sitting) : null;
    if (destination.kind === 'new' && session === null) {
      skipped += fresh.length;
      continue;
    }
    if (fresh.length === 0 && session === null) continue;
    groups.push({ destination, session, hands: fresh });
  }

  return { groups, duplicates, skipped };
};
