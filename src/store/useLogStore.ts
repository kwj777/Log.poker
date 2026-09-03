/**
 * The application store.
 *
 * One store rather than several: every screen in Log reads some mixture of
 * sessions, hands and mood, and splitting them would mean coordinating refreshes
 * across stores for no benefit at this size. The whole dataset is held in memory
 * -- a heavy live player logs a few hundred sessions a year, which is trivial --
 * and the repository stays the source of truth, re-read after every write.
 */

import { useMemo } from 'react';
import { create } from 'zustand';

import { getRepository } from '../data';
import { planImport, venueNameKey, type ImportedSession } from '../domain/import';
import {
  selectHandsForSession,
  selectMoodForSession,
  selectSessionById,
} from './selectors';
import type {
  GameType,
  Hand,
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
  gameType: GameType;
  stakes: Stakes;
  buyIn: number;
  /** Defaults to now; set when back-filling a session logged after the fact. */
  startedAt?: number;
  /** Recorded as a `start` mood entry when provided. */
  mood?: MoodScore | null;
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
  hands: Hand[];
  moodEntries: MoodEntry[];

  /** Timestamp of the last mid-session mood prompt, so it is not repeated. */
  lastMidSessionPromptAt: number | null;

  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;

  createVenue: (name: string, isHomeGame: boolean) => Promise<Venue>;
  renameVenue: (id: string, name: string) => Promise<void>;
  deleteVenue: (id: string) => Promise<void>;

  startSession: (input: StartSessionInput) => Promise<Session>;
  addRebuy: (sessionId: string, amount: number) => Promise<Rebuy>;
  removeRebuy: (id: string) => Promise<void>;
  endSession: (sessionId: string, cashOut: number, mood?: MoodScore | null) => Promise<void>;
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

/** Read everything back from storage. Cheap, and it keeps derived views honest. */
const loadAll = async () => {
  const repository = await getRepository();
  const [venues, sessions, hands, moodEntries, activeSession] = await Promise.all([
    repository.listVenues(),
    repository.listSessions(),
    repository.listHands(),
    repository.listMoodEntries(),
    repository.getActiveSession(),
  ]);
  return { venues, sessions, hands, moodEntries, activeSession };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

export const useLogStore = create<LogState>((set, get) => ({
  status: 'idle',
  error: null,
  venues: [],
  sessions: [],
  activeSession: null,
  hands: [],
  moodEntries: [],
  lastMidSessionPromptAt: null,

  hydrate: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      set({ ...(await loadAll()), status: 'ready' });
    } catch (error) {
      set({ status: 'error', error: describeError(error) });
    }
  },

  refresh: async () => {
    try {
      set({ ...(await loadAll()), error: null });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  createVenue: async (name, isHomeGame) => {
    const repository = await getRepository();
    const venue = await repository.createVenue({ name, isHomeGame });
    await get().refresh();
    return venue;
  },

  renameVenue: async (id, name) => {
    const repository = await getRepository();
    await repository.updateVenue(id, { name });
    await get().refresh();
  },

  deleteVenue: async (id) => {
    const repository = await getRepository();
    await repository.deleteVenue(id);
    await get().refresh();
  },

  startSession: async ({ venueId, gameType, stakes, buyIn, startedAt, mood }) => {
    const repository = await getRepository();
    const at = startedAt ?? Date.now();
    const session = await repository.createSession({
      venueId,
      gameType,
      stakes,
      buyIn,
      startedAt: at,
    });
    if (mood != null) {
      await repository.createMoodEntry({ sessionId: session.id, phase: 'start', score: mood, at });
    }
    set({ lastMidSessionPromptAt: null });
    await get().refresh();
    return session;
  },

  addRebuy: async (sessionId, amount) => {
    const repository = await getRepository();
    const rebuy = await repository.addRebuy({ sessionId, amount, at: Date.now() });
    await get().refresh();
    return rebuy;
  },

  removeRebuy: async (id) => {
    const repository = await getRepository();
    await repository.deleteRebuy(id);
    await get().refresh();
  },

  endSession: async (sessionId, cashOut, mood) => {
    const repository = await getRepository();
    const endedAt = Date.now();
    await repository.endSession(sessionId, cashOut, endedAt);
    if (mood != null) {
      await repository.createMoodEntry({ sessionId, phase: 'end', score: mood, at: endedAt });
    }
    set({ lastMidSessionPromptAt: null });
    await get().refresh();
  },

  updateSessionNotes: async (sessionId, notes) => {
    const repository = await getRepository();
    await repository.updateSession(sessionId, { notes });
    await get().refresh();
  },

  deleteSession: async (sessionId) => {
    const repository = await getRepository();
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

    await get().refresh();
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
    await get().refresh();
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
    await get().refresh();
  },

  deleteHand: async (id) => {
    const repository = await getRepository();
    await repository.deleteHand(id);
    await get().refresh();
  },

  logMood: async (sessionId, phase, score) => {
    const repository = await getRepository();
    await repository.createMoodEntry({ sessionId, phase, score, at: Date.now() });
    if (phase === 'mid') set({ lastMidSessionPromptAt: Date.now() });
    await get().refresh();
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
export const useHandsForSession = (sessionId: string | null): Hand[] => {
  const hands = useLogStore((state) => state.hands);
  return useMemo(
    () => (sessionId === null ? [] : selectHandsForSession(hands, sessionId)),
    [hands, sessionId],
  );
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
