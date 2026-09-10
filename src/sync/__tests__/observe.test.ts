/**
 * What the endpoint says about the bundle it just handled.
 *
 * The open question is whether the bundle needs a size cap, and it cannot be
 * answered from a synthetic log: what twenty years weighs is known, whether
 * anybody's real log is near it is not. This is what would tell us.
 *
 * Two things matter beyond the arithmetic. It must stay quiet about the
 * ordinary, or the deploy log buries the answer under the question. And it must
 * name nobody: the bucket is an HMAC so the store never holds a customer id,
 * and a log line carrying that id would undo it.
 */

import type { Bundle } from '../protocol';
import { emptyBundle } from '../protocol';
import {
  BYTES_PER_RECORD,
  NOTABLE_RECORDS,
  WATCH_MERGE_MS,
  WATCH_RECORDS,
  countRecords,
  describe as line,
  observe,
} from '../observe';

const bundleWith = (counts: Partial<Record<keyof Bundle['records'], number>>): Bundle => {
  const bundle = emptyBundle();
  for (const [table, n] of Object.entries(counts)) {
    for (let i = 0; i < (n ?? 0); i += 1) {
      bundle.records[table as keyof Bundle['records']][`${table}-${i}`] = {
        record: { id: `${table}-${i}`, updatedAt: i },
        deletedAt: null,
        heardAt: i,
      } as Bundle['records']['hands'][string];
    }
  }
  return bundle;
};

describe('counting what is there', () => {
  it('adds up every table', () => {
    expect(countRecords(bundleWith({ sessions: 3, hands: 12, venues: 2 }))).toBe(17);
  });

  it('and an empty bundle is nothing rather than a crash', () => {
    expect(countRecords(emptyBundle())).toBe(0);
  });
});

describe('what is worth a line', () => {
  it('says nothing about an ordinary bundle', () => {
    // The deploy log must not bury the answer under the question.
    expect(observe(200, 4, 1)).toBeNull();
  });

  it('speaks once a bundle is big enough to be interesting', () => {
    expect(observe(NOTABLE_RECORDS, 10, 1)).not.toBeNull();
  });

  it('speaks about a slow merge however small the bundle', () => {
    // Small and slow is worth knowing about on its own: it is the shape of a
    // problem that is not about size at all.
    const seen = observe(50, WATCH_MERGE_MS, 1);
    expect(seen?.watch).toBe(true);
  });

  it('and about a request that had to go round again', () => {
    expect(observe(50, 4, 2)?.watch).toBe(true);
  });

  it('marks the ones that crossed a line the design note names', () => {
    expect(observe(WATCH_RECORDS, 4, 1)?.watch).toBe(true);
    expect(observe(WATCH_RECORDS - 1, 4, 1)?.watch).toBe(false);
  });
});

describe('the size it reports', () => {
  it('is arithmetic from the count, plainly labeled as an estimate', () => {
    // Measuring bytes means serializing the bundle a second time, which is the
    // most expensive thing in the request. One number measured, one derived.
    const seen = observe(10_000, 20, 1);
    expect(seen?.estimatedBytes).toBe(10_000 * BYTES_PER_RECORD);
    expect(line(seen!)).toContain('est');
  });

  it('rounds the duration, because a fraction of a millisecond is noise', () => {
    expect(observe(2_000, 61.7, 1)?.mergeMs).toBe(62);
  });
});

describe('the line itself', () => {
  it('carries the count, the estimate, the duration and the rounds', () => {
    const text = line(observe(7_000, 62, 1)!);
    expect(text).toContain('7000 records');
    expect(text).toContain('MB est');
    expect(text).toContain('62ms');
    expect(text).toContain('1 round');
  });

  it('names which line was crossed, so a reader knows why it spoke', () => {
    const text = line(observe(WATCH_RECORDS, WATCH_MERGE_MS, 3)!);
    expect(text).toContain(`records>=${WATCH_RECORDS}`);
    expect(text).toContain(`merge>=${WATCH_MERGE_MS}ms`);
    expect(text).toContain('contended');
  });

  it('and says nothing about watching when nothing was crossed', () => {
    expect(line(observe(NOTABLE_RECORDS, 4, 1)!)).not.toContain('watch');
  });

  it('identifies nobody', () => {
    // The bucket is an HMAC of the subject so the store never holds a customer
    // id. A line carrying it would put a stable per-person handle in the deploy
    // log, beside how much poker they play.
    const text = line(observe(20_000, 148, 4)!);
    expect(text).toMatch(/^[\x20-\x7e]+$/);
    for (const identifier of ['log_', 'sub', 'bucket', 'token', 'Bearer', '@']) {
      expect(text).not.toContain(identifier);
    }
    // Everything in it is a number, a unit, or a word about the numbers.
    expect(text).not.toMatch(/[0-9a-f]{16,}/);
  });

  it('counts one round in the singular', () => {
    expect(line(observe(2_000, 4, 1)!)).toMatch(/1 round(?!s)/);
    expect(line(observe(2_000, 4, 2)!)).toContain('2 rounds');
  });
});
