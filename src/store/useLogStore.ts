/**
 * The application store.
 *
 * One store rather than several: every screen in Log reads some mixture of
 * sessions, hands and mood, and splitting them would mean coordinating refreshes
 * across stores for no benefit at this size. The whole dataset is held in memory
 * -- a heavy live player logs a few hundred sessions a year, which is trivial --
 * and the repository stays the source of truth: nothing here is patched in
 * memory from what a write returned, it is read back from the database.
 *
 * **Read back, but not all of it.** A write says which of the four tables it
 * could have disturbed and only those are re-read. That is a good deal faster
 * on a log with years in it, and it also stops a write invalidating every
 * memoized view in the app; see `load` and `read` below, which is where both of
 * those live and where the reasoning for them is written down.
 */

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { getRepository, onSyncApplied } from '../data';
import { planImport, venueNameKey, type ImportedSession } from '../domain/import';
import { selectMoodForSession, selectSessionById } from './selectors';
import type {
  GameType,
  Hand,
  SessionFormat,
  HandTag,
  MoodEntry,
  MoodPhase,
  MoodScore,
  Position,
  Rebuy,
  Session,
  SessionWithChildren,
  Stakes,
  Venue,
} from '../domain/types';
import type { StartingBalance } from '../data/repository';
import type { SyncTable } from '../sync/protocol';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface StartSessionInput {
  venueId: string;
  /** Defaults to a cash game. */
  format?: SessionFormat;
  gameType: GameType;
  /** Null for a tournament, which has no blinds. */
  stakes?: Stakes | null;
  currency?: string;
  buyIn: number;
  /** Tournament entry fee. */
  fee?: number | null;
  /** Defaults to now; set when back-filling a session logged after the fact. */
  startedAt?: number;
  /** Recorded as a `start` mood entry when provided. */
  mood?: MoodScore | null;
}

/**
 * A session that was played before it was logged.
 *
 * Everything `StartSessionInput` takes plus the two things only a finished
 * session has: how long it ran and what came back off the table. It is one
 * input rather than a start followed by an end because it is one write -- see
 * `logPastSession` for why that matters.
 */
export interface PastSessionInput {
  venueId: string;
  format?: SessionFormat;
  gameType: GameType;
  stakes?: Stakes | null;
  currency?: string;
  buyIn: number;
  fee?: number | null;
  /** When the player sat down. */
  startedAt: number;
  /** When they racked up. */
  endedAt: number;
  cashOut: number;
  entrants?: number | null;
  finishPosition?: number | null;
}

/**
 * What a finished session can be corrected to.
 *
 * Every field the storage layer has always been able to patch except the
 * format, which is left out on purpose: cash and tournament are different
 * records, not a setting -- one has blinds and the other a fee, a field and a
 * finish -- and turning one into the other is a different operation from
 * fixing a number that was typed wrong.
 *
 * `undefined` leaves a field alone and `null` clears it, which is why the
 * nullable ones are spelled out rather than being `Partial<Session>`: a
 * cash-out of null is a session put back to running, and that has to be
 * sayable.
 */
export interface EditSessionInput {
  venueId?: string;
  gameType?: GameType;
  stakes?: Stakes | null;
  currency?: string;
  buyIn?: number;
  fee?: number | null;
  cashOut?: number | null;
  entrants?: number | null;
  finishPosition?: number | null;
  startedAt?: number;
  endedAt?: number | null;
}

/** What a tournament knows at the end that a cash game does not. */
export interface EndSessionResult {
  entrants?: number | null;
  finishPosition?: number | null;
  /**
   * When the session actually finished, when that is not now.
   *
   * For the session somebody forgot to cash out. `Date.now()` is right for a
   * player racking up at the table with the app open, and wrong for the one
   * who drove home, slept, and remembered the next morning -- and the gap goes
   * straight into the hourly rate and into the win-rate estimate, both of
   * which divide by hours played.
   */
  endedAt?: number;
}

/** What an import did, for the message the screen shows afterwards. */
export interface ImportSummary {
  imported: number;
  /** Rows already in the log, skipped rather than written twice. */
  duplicates: number;
  /** Names of venues the import had to create. */
  venuesCreated: string[];
}

export interface LogHandInput {
  sessionId: string;
  holeCards?: string | null;
  /** The runout, when it is known. Usually null; see `Hand.board`. */
  board?: string | null;
  position?: Position | null;
  note?: string | null;
  tags?: HandTag[];
  amount?: number | null;
  at?: number;
}

interface LogState {
  status: Status;
  error: string | null;

  venues: Venue[];
  sessions: SessionWithChildren[];
  activeSession: SessionWithChildren | null;
  moodEntries: MoodEntry[];

  /**
   * What the player had behind them before the first logged session.
   *
   * Null is unasked and `{ cents: 0 }` is a player who started from nothing,
   * and nothing downstream may collapse the two: the difference is whether the
   * dashboard headline is a bankroll or a profit figure. It carries its own
   * currency, because the dashboard is scoped to one. See `Preferences`, which
   * also says why this does not sync.
   */
  startingBalance: StartingBalance | null;

  /**
   * How many hands are logged, which is all the store knows about them.
   *
   * It used to hold every one. A hand belongs to a session and every screen
   * that shows hands is a screen about one session, so all that array ever did
   * was get filtered -- while costing the most expensive read in the app on
   * every hand write, to serve one line of Settings that wanted this number.
   */
  handCount: number;
  /**
   * Bumped whenever the hands may have changed, and read by nothing else.
   *
   * With the hands themselves out of the store, `useHandsForSession` is what
   * reads them, and it needs to be told when to read again. A counter rather
   * than a signal, because it is state the hook can depend on: it goes in a
   * dependency array and React does the rest.
   */
  handsVersion: number;

  /** Timestamp of the last mid-session mood prompt, so it is not repeated. */
  lastMidSessionPromptAt: number | null;

  /**
   * Whether the reset offered after a rattling hand has already been made this
   * session, so it is made once rather than on every bad beat.
   *
   * In memory and not on a record, exactly like the field above, and cleared
   * by the same two writes. See `features/family/tableOffer.ts` for why the
   * bound is a session rather than a dismissal: this app has no key-value
   * store to remember one in, and an offer that outlives the night is the
   * standing furniture `FamilyCrossPromo` rules out.
   */
  tableOfferMadeAt: number | null;

  hydrate: () => Promise<void>;
  /**
   * Defaults to every slice; a write names only what it could have changed.
   *
   * Resolves to whether the read landed. It never rejects, because a write
   * that has already committed must not be reported as failed -- see
   * `startSession`, where doing that wrote the session twice -- but a caller
   * that navigates on the strength of the re-read needs to be able to ask.
   */
  refresh: (parts?: readonly Slice[]) => Promise<boolean>;

  /** Null clears it, which puts the dashboard back to showing profit. */
  setStartingBalance: (balance: StartingBalance | null) => Promise<void>;

  createVenue: (name: string, isHomeGame: boolean) => Promise<Venue>;
  renameVenue: (id: string, name: string) => Promise<void>;
  /** Move every session off one venue and onto another, then remove the emptied one. */
  mergeVenues: (fromId: string, intoId: string) => Promise<number>;
  deleteVenue: (id: string) => Promise<void>;

  startSession: (input: StartSessionInput) => Promise<Session>;
  logPastSession: (input: PastSessionInput) => Promise<Session>;
  addRebuy: (sessionId: string, amount: number) => Promise<Rebuy>;
  removeRebuy: (id: string) => Promise<void>;
  endSession: (
    sessionId: string,
    cashOut: number,
    mood?: MoodScore | null,
    result?: EndSessionResult,
  ) => Promise<void>;
  updateSessionNotes: (sessionId: string, notes: string | null) => Promise<void>;
  editSession: (sessionId: string, patch: EditSessionInput) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;

  importSessions: (sessions: readonly ImportedSession[]) => Promise<ImportSummary>;

  logHand: (input: LogHandInput) => Promise<Hand>;
  updateHand: (id: string, patch: Partial<LogHandInput>) => Promise<void>;
  deleteHand: (id: string) => Promise<void>;

  logMood: (sessionId: string, phase: MoodPhase, score: MoodScore) => Promise<void>;
  dismissMidSessionPrompt: () => void;
  markTableOffer: () => void;

  clearAll: () => Promise<void>;
}

/**
 * The four reads the store holds, named so a write can say which it disturbed.
 *
 * `activeSession` is not one of them. It is a session, it changes exactly when
 * the sessions do, and giving it a name of its own would only create a way for
 * the two to be refreshed apart.
 */
type Slice = 'venues' | 'sessions' | 'hands' | 'moodEntries' | 'preferences';

const EVERYTHING: readonly Slice[] = [
  'venues',
  'sessions',
  'hands',
  'moodEntries',
  'preferences',
];

/**
 * Read back the slices a write could have changed, and only those.
 *
 * This used to read all four every time, on the argument that it is cheap and
 * it keeps derived views honest. The second half is right and is why the
 * repository is still the source of truth here: nothing below is patched in
 * memory from what a write returned, it is read back from the database.
 *
 * The first half stopped being true as the log grew, which is the case this
 * app is built for. Against five years of a heavy live player -- 600 sessions,
 * 3600 hands -- one reload measures 49ms on Node's SQLite, and every rebuy
 * during a live session paid it. `listHands` is 31ms of that, and the store
 * holds every hand ever logged so that one screen can count them.
 *
 * There is a second cost that is easier to miss and can be larger. A reload
 * replaced all four arrays, so every `useMemo` downstream of any of them
 * recomputed, whatever had actually changed. Logging a hand re-ran the
 * tournament bootstrap on the variance tab -- two thousand resamples of every
 * entry -- because the sessions array was a new array, even though it held the
 * same sessions.
 *
 * Reading only what changed fixes both, and the second one falls out for free:
 * a slice that is not reloaded keeps the exact array it had, so the memos over
 * it are never invalidated in the first place. No comparison, nothing to keep
 * in step.
 *
 * The cost of being wrong here is a screen that does not notice a change, so
 * the callers below name a slice whenever there is a case for it. `sessionCount`
 * is the one that is easy to miss: it is derived at read time, so writing a
 * session changes every venue.
 */
const load = async (parts: ReadonlySet<Slice>): Promise<Map<Slice, Partial<LogState>>> => {
  const repository = await getRepository();
  const loaded = new Map<Slice, Partial<LogState>>();
  await Promise.all([
    parts.has('venues')
      ? repository.listVenues().then((venues) => void loaded.set('venues', { venues }))
      : null,
    parts.has('sessions')
      ? Promise.all([repository.listSessions(), repository.getActiveSession()]).then(
          ([sessions, activeSession]) => void loaded.set('sessions', { sessions, activeSession }),
        )
      : null,
    parts.has('hands')
      ? repository.countHands().then((handCount) => void loaded.set('hands', { handCount }))
      : null,
    parts.has('moodEntries')
      ? repository
          .listMoodEntries()
          .then((moodEntries) => void loaded.set('moodEntries', { moodEntries }))
      : null,
    // A slice of one value. It goes through the same machinery as the rest
    // rather than being read once at hydrate, because `clearAll` takes it too
    // and a second mechanism to remember that in is a second one to forget.
    parts.has('preferences')
      ? repository
          .getPreferences()
          .then(({ startingBalance }) => void loaded.set('preferences', { startingBalance }))
      : null,
  ]);
  return loaded;
};

/**
 * Which read owns each slice, so a slow one cannot land on top of a fast one.
 *
 * Two reloads can be in flight at once -- a write during a sync, two writes in
 * a row -- and nothing said which of them the store should believe. Whichever
 * resolved last won, which on two overlapping reads of the same table is the
 * older answer as often as not, and it stayed on screen until something else
 * wrote.
 *
 * Counted per slice rather than once for the store, because the reloads are no
 * longer all the same shape. A hand write and a full sync overlap on `hands`
 * and nowhere else: one number would make the sync's venues and sessions stale
 * too, and throw away three good slices to settle one.
 */
const owner: Record<Slice, number> = {
  venues: 0,
  sessions: 0,
  hands: 0,
  moodEntries: 0,
  preferences: 0,
};

/**
 * Take a slice, so anything already reading it loses.
 *
 * `read` does this for itself, and a write that sets a slice straight into the
 * store rather than re-reading it has to do the same or the guard has a hole
 * exactly the width of that write. See `setStartingBalance`, which had one.
 */
const claim = (slice: Slice): void => {
  owner[slice] += 1;
};

/** Claim the slices, read them, and keep whichever are still this read's to set. */
const read = async (parts: readonly Slice[]): Promise<Partial<LogState>> => {
  // Claimed before the read starts, so a reload that overtakes this one owns
  // the slices they share whichever of them finishes first.
  const mine = new Map<Slice, number>();
  for (const slice of parts) mine.set(slice, (owner[slice] += 1));

  const patch: Partial<LogState> = {};
  for (const [slice, values] of await load(new Set(parts))) {
    // Somebody newer has read this table since. Their answer is the current
    // one, and this is a picture of the database from before their write.
    if (owner[slice] !== mine.get(slice)) continue;
    Object.assign(patch, values);
  }
  return patch;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

/**
 * Subscribe to the sync once, however many times the app hydrates.
 *
 * A pull writes rows straight into the local database, and the arrays below
 * are what the screens actually render: without this the history somebody had
 * just signed in for arrived and then sat there until they quit and reopened
 * the app. On a device that has just been signed in on, which is the one most
 * likely to be pulling a whole log down, that looks exactly like sync not
 * working.
 *
 * Guarded because `hydrate` is called from a `useEffect` and React will run
 * that twice in development, and because nothing here ever unsubscribes: the
 * store outlives every screen, so a second listener would be a second full
 * reload of the log on every answer, forever.
 */
let listening = false;

/**
 * Which slices a synced table could have disturbed.
 *
 * The same reasoning the writes below use, pointed the other way. A venue
 * carries into every session row that names it, and a session changes the
 * `sessionCount` derived on every venue at read time, so those two travel
 * together exactly as `renameVenue` and `startSession` already send them.
 * Rebuys are children of the session and arrive inside it. `preferences` is
 * not in `SYNC_TABLES` and so is never in this map.
 */
const SLICES_FOR_TABLE: Record<SyncTable, readonly Slice[]> = {
  venues: ['venues', 'sessions'],
  sessions: ['sessions', 'venues'],
  rebuys: ['sessions'],
  hands: ['hands'],
  moodEntries: ['moodEntries'],
};

const slicesFor = (tables: readonly SyncTable[]): readonly Slice[] => {
  const parts = new Set<Slice>();
  for (const table of tables) for (const slice of SLICES_FOR_TABLE[table]) parts.add(slice);
  return [...parts];
};

const listen = (refresh: (parts: readonly Slice[]) => void): void => {
  if (listening) return;
  listening = true;
  // **Named, not everything.** This fires after every local write on a
  // signed-in device, not only when a pull brings something new: `touched`
  // pushes after each write and the answer always carries the record just
  // pushed back down. Given no names, this re-read all five slices, so logging
  // a hand did the scoped `refresh(['hands'])` above and then, a moment later,
  // replaced the sessions, venues and mood arrays as well -- invalidating
  // every memo keyed on them, which on a five-year log is the expensive half.
  // The answer says which tables moved. `slicesFor` reads it.
  onSyncApplied((tables) => refresh(slicesFor(tables)));
};

export const useLogStore = create<LogState>((set, get) => ({
  status: 'idle',
  error: null,
  venues: [],
  sessions: [],
  activeSession: null,
  moodEntries: [],
  startingBalance: null,
  handCount: 0,
  handsVersion: 0,
  lastMidSessionPromptAt: null,
  tableOfferMadeAt: null,

  hydrate: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      set({ ...(await read(EVERYTHING)), status: 'ready', error: null });
      listen((parts) => void get().refresh(parts));
    } catch (error) {
      set({ status: 'error', error: describeError(error) });
    }
  },

  refresh: async (parts = EVERYTHING) => {
    try {
      const patch = await read(parts);
      // A hands read that landed means the hands may have moved, and the hook
      // that holds them is watching this number rather than the store.
      set((state) => ({
        ...patch,
        error: null,
        handsVersion: 'handCount' in patch ? state.handsVersion + 1 : state.handsVersion,
      }));
      return true;
    } catch (error) {
      // Recorded and reported, which used to be only the first of those. The
      // `error` written here is drawn by `StaleDataNote` in the root layout,
      // so the app says the data on screen may be behind; that is the right
      // answer for a screen that is merely showing stale rows.
      //
      // It is not the right answer for a caller that is about to act on the
      // re-read. `startSession` awaits this in a `finally` and returns the
      // committed session either way, so a read that never landed arrived at
      // `app/session/new.tsx` as a resolved promise and an empty store, and
      // the screen replaced itself with one that says "No session running"
      // about a session that is running. The only obvious move from there
      // writes a second live session.
      set({ error: describeError(error) });
      return false;
    }
  },

  setStartingBalance: async (balance) => {
    const repository = await getRepository();
    const { startingBalance } = await repository.setPreferences({ startingBalance: balance });
    // Claimed, because this is the one write that sets a slice into the store
    // without going through `read`, and so the one that was outside the guard
    // `read` exists to provide. A `refresh()` over everything is what
    // `onSyncApplied` fires, so a pull landing while somebody is on Settings
    // had a preferences read already in the air: it still believed it owned
    // the slice, and it assigned its pre-write answer over this one. The
    // number the player had just typed reverted on screen, the dashboard
    // headline flipped from Bankroll back to Profit, and the right value was
    // in the database the whole time.
    claim('preferences');
    // Set from the answer rather than from the argument, so the screen shows
    // what was stored rather than what was asked for.
    set({ startingBalance });
  },

  createVenue: async (name, isHomeGame) => {
    const repository = await getRepository();
    const venue = await repository.createVenue({ name, isHomeGame });
    await get().refresh(['venues']);
    return venue;
  },

  renameVenue: async (id, name) => {
    const repository = await getRepository();
    // Sessions too: `SessionWithChildren` carries its venue, so a rename that
    // did not reload them would leave the old name on every row that shows one.
    await repository.updateVenue(id, { name });
    await get().refresh(['venues', 'sessions']);
  },

  /**
   * Fold one venue into another and return how many sessions moved.
   *
   * The two spellings of a room somebody typed at a table on two different
   * nights are the case this exists for, and until now they were permanent:
   * `deleteVenue` is refused while anything is logged against a venue, which
   * is right, and left a typo with one session against it there forever.
   *
   * Session by session rather than in one statement, because the contract has
   * no bulk update and inventing one for this would mean a new method on both
   * repositories, both their tests and the sync payload. A merge is a handful
   * of rows and a deliberate act somebody waits a moment for.
   *
   * Not a transaction, which is the honest cost. A failure part way leaves the
   * sessions that moved on the new venue and the rest on the old one, with
   * both venues still there -- which is the state the merge started from, only
   * smaller, and running it again finishes the job. The alternative was a
   * transaction primitive the contract does not have.
   */
  mergeVenues: async (fromId, intoId) => {
    if (fromId === intoId) return 0;
    const repository = await getRepository();
    const moving = await repository.listSessions({ venueId: fromId });
    // The half-done state above is an accepted cost in storage and was not one
    // in memory: a throw part way skipped the re-read, so the store went on
    // describing venue counts and session rows as they were before a single
    // row moved. Settings draws those counts, so a merge that stopped halfway
    // looked like a merge that had not started. Same shape as `startSession`
    // and `endSession`, which is where the reasoning for it is written out.
    try {
      for (const session of moving) {
        await repository.updateSession(session.id, { venueId: intoId });
      }
      await repository.deleteVenue(fromId);
    } finally {
      await get().refresh(['venues', 'sessions']);
    }
    return moving.length;
  },

  deleteVenue: async (id) => {
    const repository = await getRepository();
    await repository.deleteVenue(id);
    await get().refresh(['venues', 'sessions']);
  },

  startSession: async ({
    venueId,
    format,
    gameType,
    stakes,
    currency,
    buyIn,
    fee,
    startedAt,
    mood,
  }) => {
    const repository = await getRepository();
    const at = startedAt ?? Date.now();
    const session = await repository.createSession({
      venueId,
      format,
      gameType,
      stakes,
      currency,
      buyIn,
      fee,
      startedAt: at,
    });
    // The session is committed from here on, and everything below it is a
    // second write that can fail on its own.
    //
    // It used to fail the whole call, and the refresh below never ran: the
    // store went on showing no session while the database held a live one, and
    // `app/session/new.tsx` caught the rejection, said "That session could not
    // be started" and put the Start button back. Pressing it wrote a second
    // live session, and `getActiveSession` reads the newest open one, so the
    // first became a row that is invisible and permanently open, which is the
    // state `resolveActiveSessions` exists to clean up after two devices.
    //
    // **The mood does not get to say the session failed.** It is one optional
    // tap, it is offered again two hours in by `MidSessionCheckIn`, and a
    // night in the log twice is a worse thing to carry than a tilt reading
    // nobody took. So the start stands, and the refresh runs on both paths, so
    // the store matches storage whatever happened.
    try {
      if (mood != null) {
        await repository.createMoodEntry({ sessionId: session.id, phase: 'start', score: mood, at });
      }
    } catch {
      // Left unrecorded rather than fatal. See above.
    } finally {
      set({ lastMidSessionPromptAt: null, tableOfferMadeAt: null });
      // Venues, because `sessionCount` is derived at read time and this changed it.
      await get()
        .refresh(mood == null ? ['sessions', 'venues'] : ['sessions', 'venues', 'moodEntries']);
    }
    return session;
  },

  /**
   * Log a session that was played before it was logged.
   *
   * One write rather than a start and then an end. A session that is created
   * live and cashed out later is two writes because those are two moments
   * hours apart; this one is a single form submitted once, and splitting it
   * would open a window where the second write failing leaves a session
   * running that nobody is playing -- exactly the state the "Still playing?"
   * correction on the live screen exists to clean up.
   *
   * No mood: the pre-session score is asked for at the table because it is
   * about how somebody feels right then, and a score remembered a week later
   * is a different measurement wearing the same name.
   */
  logPastSession: async (input) => {
    const repository = await getRepository();
    const session = await repository.createSession(input);
    // Venues, because `sessionCount` is derived at read time and this changed it.
    await get().refresh(['sessions', 'venues']);
    return session;
  },

  addRebuy: async (sessionId, amount) => {
    const repository = await getRepository();
    // Rebuys are children of the session, so the sessions read carries them.
    const rebuy = await repository.addRebuy({ sessionId, amount, at: Date.now() });
    await get().refresh(['sessions']);
    return rebuy;
  },

  removeRebuy: async (id) => {
    const repository = await getRepository();
    await repository.deleteRebuy(id);
    await get().refresh(['sessions']);
  },

  endSession: async (sessionId, cashOut, mood, result) => {
    const repository = await getRepository();
    const endedAt = result?.endedAt ?? Date.now();
    await repository.endSession(sessionId, cashOut, endedAt);
    // The night is closed from here on, and the two writes below can fail
    // after it. They used to take the refresh down with them, so the store
    // went on drawing a session the database had already finished: History
    // showed it live, the dashboard left it out of every total, and the
    // cash-out sheet stayed open inviting a second go at a session that no
    // longer had one to give.
    //
    // The throw stands, unlike the mood on the way in, because what is in
    // these two is a tournament's field and finish rather than an optional
    // tap: worth telling somebody about, and fixable in Edit once the store
    // agrees the session is over.
    try {
      // A second write rather than a wider `endSession`: cashing out is the same
      // operation for both formats, and only a tournament has anywhere it came.
      if (result && (result.entrants != null || result.finishPosition != null)) {
        await repository.updateSession(sessionId, {
          ...(result.entrants == null ? {} : { entrants: result.entrants }),
          ...(result.finishPosition == null ? {} : { finishPosition: result.finishPosition }),
        });
      }
      if (mood != null) {
        await repository.createMoodEntry({ sessionId, phase: 'end', score: mood, at: endedAt });
      }
    } finally {
      set({ lastMidSessionPromptAt: null, tableOfferMadeAt: null });
      await get().refresh(mood == null ? ['sessions'] : ['sessions', 'moodEntries']);
    }
  },

  updateSessionNotes: async (sessionId, notes) => {
    const repository = await getRepository();
    await repository.updateSession(sessionId, { notes });
    await get().refresh(['sessions']);
  },

  /**
   * Correct a session that was logged wrong.
   *
   * Only what the caller named: the screen sends the fields it owns, and a
   * field left out keeps whatever is stored. Venues are reloaded as well as
   * sessions, because moving a session to another room changes the
   * `sessionCount` on both of them and that number is derived at read time.
   */
  editSession: async (sessionId, patch) => {
    const repository = await getRepository();
    await repository.updateSession(sessionId, patch);
    await get().refresh(['sessions', 'venues']);
  },

  deleteSession: async (sessionId) => {
    const repository = await getRepository();
    // Everything: the tombstone cascades to the session's hands and mood
    // entries, and it changes the venue's `sessionCount` on the way past.
    await repository.deleteSession(sessionId);
    await get().refresh();
  },

  /**
   * Write a parsed session-summary import.
   *
   * Rows already carrying a stored import key are dropped before anything is
   * written, so running the same file again next month adds only what is new.
   * The sessions themselves go in as one all-or-nothing batch; the venues they
   * name cannot, since creating a venue is its own write -- so a failure after
   * that point deletes the rooms this import invented rather than leaving them
   * in the picker for a session that never landed.
   */
  importSessions: async (sessions) => {
    const repository = await getRepository();
    const venues = await repository.listVenues();
    const plan = planImport(
      sessions,
      new Set(await repository.listImportKeys()),
      venues.map((venue) => venue.name),
    );

    if (plan.writes.length === 0) {
      return { imported: 0, duplicates: plan.duplicates, venuesCreated: [] };
    }

    const byName = new Map(venues.map((venue) => [venueNameKey(venue.name), venue.id]));
    const created: Venue[] = [];

    try {
      for (const name of plan.venuesToCreate) {
        const venue = await repository.createVenue({ name, isHomeGame: false });
        byName.set(venueNameKey(venue.name), venue.id);
        created.push(venue);
      }

      await repository.createSessions(
        plan.writes.map((session) => ({
          ...session.draft,
          venueId: byName.get(venueNameKey(session.venueName)) as string,
          importKey: session.importKey,
        })),
      );
    } catch (error) {
      for (const venue of created) {
        await repository.deleteVenue(venue.id).catch(() => undefined);
      }
      throw error;
    }

    await get().refresh(['sessions', 'venues']);
    return {
      imported: plan.writes.length,
      duplicates: plan.duplicates,
      venuesCreated: created.map((venue) => venue.name),
    };
  },

  logHand: async (input) => {
    const repository = await getRepository();
    const hand = await repository.createHand({
      sessionId: input.sessionId,
      at: input.at ?? Date.now(),
      holeCards: input.holeCards ?? null,
      board: input.board ?? null,
      position: input.position ?? null,
      note: input.note ?? null,
      tags: input.tags ?? [],
      amount: input.amount ?? null,
    });
    await get().refresh(['hands']);
    return hand;
  },

  updateHand: async (id, patch) => {
    const repository = await getRepository();
    await repository.updateHand(id, {
      holeCards: patch.holeCards,
      board: patch.board,
      position: patch.position,
      note: patch.note,
      tags: patch.tags,
      amount: patch.amount,
    });
    await get().refresh(['hands']);
  },

  deleteHand: async (id) => {
    const repository = await getRepository();
    await repository.deleteHand(id);
    await get().refresh(['hands']);
  },

  logMood: async (sessionId, phase, score) => {
    const repository = await getRepository();
    await repository.createMoodEntry({ sessionId, phase, score, at: Date.now() });
    if (phase === 'mid') set({ lastMidSessionPromptAt: Date.now() });
    await get().refresh(['moodEntries']);
  },

  dismissMidSessionPrompt: () => set({ lastMidSessionPromptAt: Date.now() }),

  markTableOffer: () => set({ tableOfferMadeAt: Date.now() }),

  clearAll: async () => {
    const repository = await getRepository();
    await repository.clearAll();
    await get().refresh();
  },
}));

// ------------------------------------------------------------------- reads

/**
 * Screens use these hooks rather than passing a filtering selector to
 * `useLogStore`.
 *
 * Zustand compares the selector's result by reference, so a selector that builds
 * a new array on every call reports a change on every render -- which is an
 * infinite render loop, not merely a wasted render. Subscribing to the stored
 * array (a stable reference) and deriving inside `useMemo` keeps the comparison
 * honest.
 */
/**
 * One session's hands, read when they are wanted rather than held for ever.
 *
 * The store used to hold every hand in the log and this filtered them. That is
 * why a hand write was the most expensive write in the app: 3600 rows read and
 * mapped so that six could be shown.
 *
 * **Null means not read yet, and it is not the same as none.** A screen that
 * treats them alike says "no hands logged for this session" in the gap before
 * the first read lands, which is a sentence that is wrong rather than merely
 * early. The two callers both branch on it.
 *
 * Reloaded when `handsVersion` moves, which is any write or sync that touched
 * the hands. The previous answer is left on screen while the next one is read,
 * so logging a hand does not blank the list it is being added to.
 */
export const useHandsForSession = (sessionId: string | null): Hand[] | null => {
  const version = useLogStore((state) => state.handsVersion);
  const [answer, setAnswer] = useState<{ sessionId: string; hands: Hand[] } | null>(null);

  useEffect(() => {
    if (sessionId === null) return;
    // Guarded rather than canceled: the read cannot be stopped, but an answer
    // that arrives after this hook has moved on must not be kept.
    let live = true;
    void (async () => {
      try {
        const repository = await getRepository();
        const rows = await repository.listHands(sessionId);
        if (live) setAnswer({ sessionId, hands: rows });
      } catch {
        // The screen keeps whatever it had. A failed read here is the local
        // database being unavailable, which the root layout already reports.
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId, version]);

  // Derived rather than stored, which is what makes the answer to the wrong
  // question unreachable rather than merely short-lived: moving to another
  // session reads as unknown on the same render, without a state change to
  // schedule and a frame of the previous session's hands to get through first.
  if (sessionId === null) return [];
  return answer !== null && answer.sessionId === sessionId ? answer.hands : null;
};

/**
 * Every hand, for the screen that browses them.
 *
 * Read through the repository rather than held in the store, which is the same
 * decision `useHandsForSession` makes and for the reason recorded above
 * `handCount`: keeping the hands in memory cost the most expensive read in the
 * app on every hand write, to serve screens that each wanted one session's
 * worth. A screen that genuinely wants all of them pays for them while it is
 * open, and nothing else pays anything.
 *
 * `null` while the first read is outstanding, so a screen can tell "no hands
 * logged" from "not yet known" -- an empty list drawn during the read is an
 * empty state that flashes and then fills, which reads as a bug.
 *
 * ## `enabled`, and why the paragraph above needed it
 *
 * "While it is open" was true of the screen this was written for, which is
 * pushed and popped, and not of the other caller. The Variance tab is a bottom
 * tab: react-navigation mounts it on first focus and keeps it mounted, so from
 * a player's first visit onward this hook was subscribed for the rest of the
 * session. `handsVersion` moves on every `logHand`, `updateHand` and
 * `deleteHand`, so every hand written at the table paid for a full read of the
 * journal on a screen nobody was looking at -- the most expensive read in the
 * app, at the one moment the app should be doing least.
 *
 * A caller that can be off screen passes whether it is on it. Going from false
 * back to true re-runs the effect, so a screen that was away while hands moved
 * reads once when it comes back rather than not at all.
 */
export const useAllHands = (enabled = true): Hand[] | null => {
  const version = useLogStore((state) => state.handsVersion);
  const [hands, setHands] = useState<Hand[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const repository = await getRepository();
        const rows = await repository.listHands();
        if (live) setHands(rows);
      } catch {
        // The screen keeps whatever it had, as the two hooks below do: a
        // failed read here is the local database being unavailable, which the
        // root layout already reports.
      }
    })();
    return () => {
      live = false;
    };
  }, [version, enabled]);

  return hands;
};

/**
 * One hand, read by id, for the screen that edits it.
 *
 * Three answers rather than two, which is why this does not simply return
 * `Hand | null` the way the list above does. A list has no third state: it has
 * arrived or it has not, and an empty one is an answer. A single record can
 * also be *absent* -- a hand deleted on another device and synced away while
 * its screen is open -- and "still reading" and "there is no such hand" want
 * opposite things on screen. So `undefined` is the read that has not landed,
 * and `null` is the answer that there is nothing there.
 *
 * Re-read on `handsVersion` like the list, so editing a hand and coming back
 * to it does not show the version before the edit.
 */
export const useHandById = (id: string | null): Hand | null | undefined => {
  const version = useLogStore((state) => state.handsVersion);
  const [answer, setAnswer] = useState<{ id: string; hand: Hand | null } | null>(null);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    void (async () => {
      try {
        const repository = await getRepository();
        const row = await repository.getHand(id);
        if (live) setAnswer({ id, hand: row });
      } catch {
        // As above: a failed read is the database being unavailable, which the
        // root layout already has a screen for.
      }
    })();
    return () => {
      live = false;
    };
  }, [id, version]);

  if (id === null) return null;
  return answer !== null && answer.id === id ? answer.hand : undefined;
};

export const useMoodForSession = (sessionId: string | null): MoodEntry[] => {
  const entries = useLogStore((state) => state.moodEntries);
  return useMemo(
    () => (sessionId === null ? [] : selectMoodForSession(entries, sessionId)),
    [entries, sessionId],
  );
};

export const useSessionById = (id: string | null): SessionWithChildren | null => {
  const sessions = useLogStore((state) => state.sessions);
  return useMemo(() => (id === null ? null : selectSessionById(sessions, id)), [sessions, id]);
};

export * from './selectors';
