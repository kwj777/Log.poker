/**
 * What survives a restart, and what a device is told when nothing does.
 *
 * This file had no tests, which mattered more than it looked: the store is the
 * only thing that carries a cursor across a launch, so a field it quietly
 * dropped would make whatever depends on that field inert on a real device and
 * perfectly fine in every other suite. `settled` was added with exactly that
 * exposure -- neutralizing its parse changed nothing anywhere -- and it is the
 * one field whose loss is not self-correcting: a lost `pulled` or `pushed`
 * costs one full re-sync, and a lost `settled` costs a delete.
 *
 * The web store, because `localStorage` is a dozen lines to stand up in Node
 * and SecureStore is not. The two files are the same parser.
 */

import { cursorStore, freshCursors } from '../cursorStore.web';

const KEY = 'log_sync_cursors';

const stub = () => {
  const held = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
  return held;
};

describe('carrying cursors across a launch', () => {
  let held: Map<string, string>;

  beforeEach(() => {
    held = stub();
  });

  it('reads back every number it was given', async () => {
    await cursorStore.write({
      pulled: 40,
      pushed: 30,
      device: 'device-aaaa0001',
      settled: 20,
      subject: 'log_abc',
    });
    expect(await cursorStore.read()).toEqual({
      pulled: 40,
      pushed: 30,
      device: 'device-aaaa0001',
      settled: 20,
      subject: 'log_abc',
    });
  });

  it('and keeps how far back it is safe to collect, which is the one that costs a delete', async () => {
    // `pulled` and `pushed` are worth one full re-sync each if they are lost.
    // `settled` is worth a resurrected session: a device that loses it sweeps
    // tombstones on the window while the bucket still holds the live rows.
    await cursorStore.write({ pulled: 0, pushed: 0, device: 'device-aaaa0001', settled: 12_345, subject: null });
    expect((await cursorStore.read()).settled).toBe(12_345);
  });

  it('answers zero for a record written before that field existed', async () => {
    // The upgrade path, and the safe direction to be wrong in. A record from
    // an older build was either pushed -- so the server holds the delete too --
    // or never sent, in which case no bucket is waiting to send anything back.
    held.set(KEY, JSON.stringify({ pulled: 40, pushed: 30, device: 'device-aaaa0001' }));
    expect((await cursorStore.read()).settled).toBe(0);
  });

  it('and for anything stored there that is not a number', async () => {
    for (const settled of ['20', -1, null, {}, Number.NaN]) {
      held.set(KEY, JSON.stringify({ pulled: 0, pushed: 0, device: 'device-aaaa0001', settled }));
      expect((await cursorStore.read()).settled).toBe(0);
    }
  });

  it('keeps the device id even when the rest of the record is wrong', async () => {
    // Minting a new one makes this device look new to the server, which holds
    // collection up for a whole window under a name nobody will use again.
    held.set(KEY, JSON.stringify({ pulled: 'no', pushed: null, device: 'device-keepme001' }));
    expect((await cursorStore.read()).device).toBe('device-keepme001');
  });

  it('and reads nothing at all as a device that has seen nothing', async () => {
    expect(await cursorStore.read()).toEqual(freshCursors());
  });

  it('and does not throw when there is nowhere to store anything', async () => {
    // A private window, or site data blocked: `localStorage` does not merely
    // come back empty, it throws on access. An app that cannot sync is a
    // working app; one that throws on launch is not.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      await expect(cursorStore.read()).resolves.toEqual(freshCursors());
      await expect(
        cursorStore.write({ pulled: 1, pushed: 1, device: 'device-aaaa0001', settled: 1, subject: null }),
      ).resolves.toBeUndefined();
    } finally {
      // Put it back, or the getter throws again inside jest's own teardown and
      // the whole suite reports as failing to run rather than as passing.
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    }
  });
});
