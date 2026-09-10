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

/** What a tournament knows at the end that a cash game does not. */
export interface EndSessionResult {
  entrants?: number | null;
  finishPosition?: number | null;
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

  hydrate: () => Promise<void>;
  /** Defaults to every slice; a write names only what it could have changed. */
  refresh: (parts?: readonly Slice[]) => Promise<void>;

  createVenue: (name: string, isHomeGame: boolean) => Promise<Venue>;
  renameVenue: (id: string, name: string) => Promise<void>;
  deleteVenue: (id: string) => Promise<void>;

  startSession: (input: StartSessionInput) => Promise<Session>;
  addRebuy: (sessionId: string, amount: number) => Promise<Rebuy>;
  removeRebuy: (id: string) => Promise<void>;
  endSession: (
    sessionId: string,
    cashOut: number,
    mood?: MoodScore | null,
    result?: EndSessionResult,
  ) => Promise<void>;
  updateSessionNotes: (sessionId: string, notes: string | null) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;

  importSessions: (sessions: readonly ImportedSession[]) => Promise<ImportSummary>;

  logHand: (input: LogHandInput) => Promise<Hand>;
  updateHand: (id: string, patch: Partial<LogHandInput>) => Promise<void>;
  deleteHand: (id: string) => Promise<void>;

  logMood: (sessionId: string, phase: MoodPhase, score: MoodScore) => Promise<void>;
  dismissMidSessionPrompt: () => void;

  clearAll: () => Promise<void>;
}

/**
 * The four reads the store holds, named so a write can say which it disturbed.
 *
 * `activeSession` is not one of them. It is a session, it changes exactly when
 * the sessions do, and giving it a name of its own would only create a way for
 * the two to be refreshed apart.
 */
type Slice = 'venues' | 'sessions' | 'hands' | 'moodEntries';

const EVERYTHING: readonly Slice[] = ['venues', 'sessions', 'hands', 'moodEntries'];

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
const owner: Record<Slice, number> = { venues: 0, sessions: 0, hands: 0, moodEntries: 0 };

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

const listen = (refresh: () => void): void => {
  if (listening) return;
  listening = true;
  onSyncApplied(refresh);
};

export const useLogStore = create<LogState>((set, get) => ({
  status: 'idle',
  error: null,
  venues: [],
  sessions: [],
  activeSession: null,
  moodEntries: [],
  handCount: 0,
  handsVersion: 0,
  lastMidSessionPromptAt: null,

  hydrate: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      set({ ...(await read(EVERYTHING)), status: 'ready', error: null });
      listen(() => void get().refresh());
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
    } catch (error) {
      set({ error: describeError(error) });
    }
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
    if (mood != null) {
      await repository.createMoodEntry({ sessionId: session.id, phase: 'start', score: mood, at });
    }
    set({ lastMidSessionPromptAt: null });
    // Venues, because `sessionCount` is derived at read time and this changed it.
    await get().refresh(mood == null ? ['sessions', 'venues'] : ['sessions', 'venues', 'moodEntries']);
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
    const endedAt = Date.now();
    await repository.endSession(sessionId, cashOut, endedAt);
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
    set({ lastMidSessionPromptAt: null });
    await get().refresh(mood == null ? ['sessions'] : ['sessions', 'moodEntries']);
  },

  updateSessionNotes: async (sessionId, notes) => {
    const repository = await getRepository();
    await repository.updateSession(sessionId, { notes });
    await get().refresh(['sessions']);
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
