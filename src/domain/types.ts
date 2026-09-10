/**
 * Core domain model for Log.
 *
 * Every record is timestamped (`createdAt` / `updatedAt`, epoch milliseconds UTC)
 * and carries a client-generated string id. Both are deliberate: when cloud sync
 * lands post-MVP, rows can be reconciled by (id, updatedAt) without a schema
 * migration, and ids never collide across devices because they are random.
 *
 * Money is stored in **cents** as integers everywhere. Floating point dollars
 * accumulate rounding error over thousands of sessions; cents do not.
 */

/** Epoch milliseconds, UTC. */
export type Timestamp = number;

/** Money in whole cents. Always an integer; may be negative. */
export type Cents = number;

/**
 * Cash game or tournament.
 *
 * The two are different games for every purpose this app has. A cash session
 * has blinds that stay still and chips you can walk away with; a tournament has
 * an entry fee, a field, a finish, and a result that is zero most of the time.
 * They share a venue, a clock and a bankroll, and almost nothing else -- which
 * is why this is a discriminator on the record rather than a tag on the side.
 */
export const SESSION_FORMATS = ['cash', 'tournament'] as const;
export type SessionFormat = (typeof SESSION_FORMATS)[number];

export const SESSION_FORMAT_LABELS: Record<SessionFormat, string> = {
  cash: 'Cash game',
  tournament: 'Tournament',
};

export const GAME_TYPES = ['NLHE', 'PLO', 'OTHER'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_LABELS: Record<GameType, string> = {
  NLHE: 'No-Limit Hold’em',
  PLO: 'Pot-Limit Omaha',
  OTHER: 'Other',
};

/** 1 = calm and focused, 5 = fully tilted. */
export const MOOD_SCALE = [1, 2, 3, 4, 5] as const;
export type MoodScore = (typeof MOOD_SCALE)[number];

export const MOOD_PHASES = ['start', 'mid', 'end'] as const;
export type MoodPhase = (typeof MOOD_PHASES)[number];

/** Table positions, stored abbreviated so they survive table-size changes. */
export const POSITIONS = ['UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = (typeof POSITIONS)[number];

export const HAND_TAGS = ['bad_beat', 'misplayed', 'cooler', 'bluff'] as const;
export type HandTag = (typeof HAND_TAGS)[number];

export const HAND_TAG_LABELS: Record<HandTag, string> = {
  bad_beat: 'bad beat',
  misplayed: 'misplayed?',
  cooler: 'cooler',
  bluff: 'bluff',
};

export interface Venue {
  id: string;
  name: string;
  /** Free text: "Bellagio", "Mike's basement", "Bay 101". */
  isHomeGame: boolean;
  /**
   * Number of sessions logged here. Derived at read time by both repositories
   * rather than stored, so it can never drift out of sync with the sessions
   * table; the venue picker sorts by it to put the player's regular room first.
   */
  sessionCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Stakes are stored as the two blind values in cents plus an optional straddle /
 * ante, rather than a display string, so that "profit by stakes" can group
 * numerically and the same 1/2 game reads identically no matter how it was typed.
 *
 * No currency here: a session has one currency and its blinds are numbers in it,
 * so it lives on `Session` where a tournament -- which has no blinds at all --
 * can still say what its money was in.
 */
export interface Stakes {
  smallBlind: Cents;
  bigBlind: Cents;
  /** Optional bring-in for games with a mandatory ante (common in home games). */
  ante?: Cents;
}

export interface Rebuy {
  id: string;
  sessionId: string;
  amount: Cents;
  at: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Session {
  id: string;
  venueId: string;
  format: SessionFormat;
  gameType: GameType;
  /**
   * Null for a tournament, whose blinds move every level and mean nothing
   * afterwards -- and null for a cash session whose blinds were never recorded,
   * which an import can produce. Both cases are the same to everything
   * downstream: there is no big blind to measure a result in.
   */
  stakes: Stakes | null;
  currency: string;
  buyIn: Cents;
  /**
   * The tournament entry fee -- the "+10" in "$100+$10". Kept apart from the
   * buy-in because that is how every tournament is advertised and how players
   * think about them, and because a year of rake is worth being able to total.
   * Null for a cash game, which has no such thing.
   */
  fee: Cents | null;
  /** Null while the session is still running. For a tournament, the prize won. */
  cashOut: Cents | null;
  /** Tournament field size. Null when unknown, and for cash games. */
  entrants: number | null;
  /** Where the player finished, 1 being the win. Null when unknown, and for cash. */
  finishPosition: number | null;
  startedAt: Timestamp;
  /** Null while the session is still running. */
  endedAt: Timestamp | null;
  notes: string | null;
  /**
   * Provenance for a session that came from a file rather than from a player
   * tapping Start: a stable key derived from the imported row.
   *
   * Null for everything logged in the app. Unique across the table where it is
   * set, which is what makes re-importing last month's export add the three new
   * sessions on the end and silently skip the rest -- a duplicated bankroll being
   * exactly the kind of failure nobody notices until it has compounded.
   */
  importKey: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A session with its child records resolved -- what the UI almost always wants. */
export interface SessionWithChildren extends Session {
  rebuys: Rebuy[];
  venue: Venue | null;
}

export interface Hand {
  id: string;
  sessionId: string;
  /**
   * Stable, parseable notation for the hole cards -- e.g. `"AsKd"`, `"Th9h"`.
   * Two characters per card: rank (`23456789TJQKA`) then suit (`shdc`).
   * Null when the player logged a hand without recording cards.
   *
   * This is the hand-off format for TiltProof drills; see `handNotation.ts`.
   */
  holeCards: string | null;
  /**
   * The board, in the same notation: three cards for a flop, four for a turn,
   * five for the whole runout, and null when it was not recorded.
   *
   * Optional and expected to be null on most hands. It is here because three
   * of the four tags a hand can carry -- bad beat, cooler, bluff -- are claims
   * about a runout, and without this the record cannot show the runout they are
   * claims about. See `isBoard` for what counts as one.
   */
  board: string | null;
  position: Position | null;
  note: string | null;
  tags: HandTag[];
  /** Optional pot swing, for hands the player wants to quantify. */
  amount: Cents | null;
  at: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MoodEntry {
  id: string;
  sessionId: string;
  phase: MoodPhase;
  score: MoodScore;
  at: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Fields the caller supplies; ids and timestamps are filled in by the repository. */
export type NewVenue = Pick<Venue, 'name' | 'isHomeGame'>;
export type NewSession = Pick<Session, 'venueId' | 'gameType' | 'buyIn' | 'startedAt'> &
  Partial<
    Pick<
      Session,
      | 'format'
      | 'stakes'
      | 'currency'
      | 'fee'
      | 'notes'
      | 'cashOut'
      | 'endedAt'
      | 'entrants'
      | 'finishPosition'
      | 'importKey'
    >
  >;
export type NewRebuy = Pick<Rebuy, 'sessionId' | 'amount' | 'at'>;
export type NewHand = Pick<Hand, 'sessionId' | 'at'> &
  Partial<Pick<Hand, 'holeCards' | 'board' | 'position' | 'note' | 'tags' | 'amount'>>;
export type NewMoodEntry = Pick<MoodEntry, 'sessionId' | 'phase' | 'score' | 'at'>;
