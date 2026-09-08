/**
 * A blob store that behaves like the real one where it matters.
 *
 * Shared by `signinEndpoint.test.ts` and `signinSweep.test.ts` because both
 * need the same three things, and the first version of each hand-rolled its
 * own: **etags, conditional writes, and a reason to fail**. A plain `Map` is
 * linearizable and always answers with the latest value, which is exactly the
 * store under which every race in these two files is invisible. Two fakes that
 * were nearly the same would be a slower way of getting the same blind spot.
 *
 * The conditional-write semantics are copied from `@netlify/blobs` rather than
 * invented, because the endpoint now depends on their details:
 *
 *   `onlyIfNew`     writes only when the key is absent, and answers
 *                   `modified: false` when it is not.
 *   `onlyIfMatch`   writes only when the current tag is the one given.
 *   the answer      carries the new tag when, and only when, something was
 *                   written. The endpoint refuses to trust `modified` on its
 *                   own, so a fake that always returned a tag would hide that.
 *
 * Nothing here models eventual consistency, because neither caller can ask for
 * it any more: both pass `consistency: 'strong'`, and `reads` records the
 * options so a test can hold them to it.
 */

import type { CodeStore } from '../signinEndpoint';
import type { SweepStore } from '../signinSweep';

/** What the fake keeps: a value, and the tag that says which value. */
export interface Held {
  value: unknown;
  etag: string;
}

export interface Fake extends CodeStore, SweepStore {
  held: Map<string, Held>;
  /** What the fake was asked to read, so consistency can be asserted. */
  reads: { key: string; options: unknown }[];
  /** Milliseconds each read costs, for the runs that are about a budget. */
  slow: number;
  /** Reads that never answer, for the runs about one bad key. */
  hangs: Set<string>;
  /** Keys the read makes vanish, as a redemption between listing and read does. */
  vanishes: Set<string>;
  /** Keys the read rewrites underneath itself, which is what an etag catches. */
  rewrites: Set<string>;
  /** Keys whose read answers with no tag at all. */
  tagless: Set<string>;
  /** Keys whose write answers `modified` with no tag, as a 429 does. */
  untagged: Set<string>;
  /** Extra rows the listing invents, for guards a prefix filter would hide. */
  invents: { key: string; etag: string }[];
  /**
   * Held in front of every read, so a test can decide the interleaving.
   *
   * Without it, whether two requests race is up to the microtask queue, and a
   * concurrency test that only sometimes concurs is worse than none: it passes
   * on the broken code often enough to look fine. Set it and every reader
   * stops at the same line until it resolves, which is the interleaving these
   * races actually need.
   */
  gate: Promise<void> | null;
  /**
   * Key prefixes whose conditional writes always report `modified: false`.
   *
   * Relentless contention, without having to arrange it. A record somebody
   * else is rewriting faster than this request can read it is indistinguishable
   * from one that simply refuses every condition, and it is the case where a
   * retry loop has to decide what losing every round means.
   */
  loses: Set<string>;
  readThrows: boolean;
  writeThrows: boolean;
  deleteThrows: boolean;
  getThrows: Set<string>;
  deleteKeyThrows: Set<string>;
  listThrows: boolean;
  /** Write straight past the conditions, for arranging a starting state. */
  put(key: string, value: unknown): void;
}

export interface Clock {
  now: () => number;
  to: (when: number) => void;
  by: (ms: number) => void;
}

export const fakeStore = (start: number): { store: Fake; clock: Clock } => {
  let at = start;
  const clock: Clock = {
    now: () => at,
    to: (when) => {
      at = when;
    },
    by: (ms) => {
      at += ms;
    },
  };

  let written = 0;
  const write = (key: string, value: unknown): string => {
    written += 1;
    const etag = `v${written}`;
    store.held.set(key, { value: JSON.parse(JSON.stringify(value)), etag });
    return etag;
  };

  const store: Fake = {
    held: new Map(),
    reads: [],
    slow: 0,
    hangs: new Set(),
    vanishes: new Set(),
    rewrites: new Set(),
    tagless: new Set(),
    untagged: new Set(),
    invents: [],
    gate: null,
    loses: new Set(),
    readThrows: false,
    writeThrows: false,
    deleteThrows: false,
    getThrows: new Set(),
    deleteKeyThrows: new Set(),
    listThrows: false,

    put: (key, value) => void write(key, value),

    async getWithMetadata(key, options) {
      at += store.slow;
      store.reads.push({ key, options });
      if (store.hangs.has(key)) return new Promise(() => {});
      if (store.gate !== null) await store.gate;
      if (store.readThrows || store.getThrows.has(key)) throw new Error('unreachable');
      if (store.vanishes.has(key)) {
        store.held.delete(key);
        return null;
      }
      const found = store.held.get(key);
      if (found === undefined) return null;
      // A write landing between a listing and this read. What comes back is
      // the new record, and its tag is what gives that away.
      if (store.rewrites.has(key)) write(key, found.value);
      const now = store.held.get(key) as Held;
      return { data: now.value, etag: store.tagless.has(key) ? undefined : now.etag };
    },

    async setJSON(key, value, options) {
      if (store.writeThrows) throw new Error('unreachable');
      if ([...store.loses].some((prefix) => key.startsWith(prefix))) return { modified: false };
      const found = store.held.get(key);
      if ('onlyIfNew' in options && found !== undefined) return { modified: false };
      if ('onlyIfMatch' in options && found?.etag !== options.onlyIfMatch) {
        return { modified: false };
      }
      const etag = write(key, value);
      // A write the client could not confirm: `modified` without a tag, which
      // is what a 429 or a 500 looks like after its own retries.
      return store.untagged.has(key) ? { modified: true } : { modified: true, etag };
    },

    async delete(key) {
      if (store.deleteThrows || store.deleteKeyThrows.has(key)) throw new Error('unreachable');
      store.held.delete(key);
    },

    async list({ prefix }) {
      if (store.listThrows) throw new Error('unreachable');
      return {
        blobs: [
          ...[...store.held.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, one]) => ({ key, etag: one.etag })),
          ...store.invents,
        ],
      };
    },
  };

  return { store, clock };
};

/** The store as values alone, which is what a test comparing two of them means. */
export const snapshot = (store: Fake): [string, unknown][] =>
  [...store.held.entries()].map(([key, one]) => [key, one.value] as [string, unknown]).sort();
