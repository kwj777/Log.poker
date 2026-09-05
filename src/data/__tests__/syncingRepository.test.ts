/**
 * Two devices, one server, and no fakes in between.
 *
 * Everything under test here is the code that ships: two real `SqlRepository`
 * instances against real SQLite, each wrapped in the real `SyncingRepository`,
 * talking to the real `mergeIntoBundle` through a `fetch` that hands one to the
 * other. The only thing standing in is the transport, which is a function call
 * instead of a socket.
 *
 * That is deliberate, and it is the point of the whole phase-2 shape. Every
 * other test in `src/sync` proves one piece answers correctly on its own. This
 * one asks the question a player would: **I logged it on my phone; is it on my
 * laptop, and is it still gone after I delete it?**
 */

import { SqlRepository } from '../sql/SqlRepository';
import { SyncingRepository, memoryCursorStore } from '../SyncingRepository';
import { mergeIntoBundle } from '../../sync/bundle';
import type { Fetch } from '../../sync/client';
import { NodeSqliteDriver } from './support/nodeSqliteDriver';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

/** One clock for everything, so a stamp is a fact rather than a race. */
let now = T0;
const tick = (ms: number) => {
  now += ms;
};

/**
 * The server: one bundle, and the real merge over it.
 *
 * `offline` is the card room. `unauthorized` is a token that has stopped
 * meaning anything, which the loop has to treat differently from a bad signal.
 */
const server = () => {
  const held: { bundle: unknown; offline: boolean; unauthorized: boolean; calls: number } = {
    bundle: null,
    offline: false,
    unauthorized: false,
    calls: 0,
  };

  const fetch = (async (_url: string, init: RequestInit) => {
    held.calls += 1;
    if (held.offline) throw new TypeError('Network request failed');
    if (held.unauthorized) return { ok: false, status: 401, json: async () => ({}) } as Response;
    if (init.method === 'DELETE') {
      held.bundle = null;
      return { ok: true, status: 204, json: async () => null } as Response;
    }

    const { since, changes, device } = JSON.parse(init.body as string);
    const merged = mergeIntoBundle(held.bundle, changes, since, now, device);
    held.bundle = JSON.parse(JSON.stringify(merged.bundle));
    return {
      ok: true,
      status: 200,
      json: async () =>
        JSON.parse(
          JSON.stringify({
            cursor: merged.cursor,
            changes: merged.changes,
            collectedThrough: merged.collectedThrough,
          }),
        ),
    } as Response;
  }) as unknown as Fetch;

  return { held, fetch };
};

const drivers: NodeSqliteDriver[] = [];

/** A device: its own database, its own cursor, the shared server. */
const device = async (fetch: Fetch, name: string, id = `device-${name}0001`) => {
  const driver = new NodeSqliteDriver(':memory:');
  drivers.push(driver);
  let counter = 0;
  const local = new SqlRepository(driver, {
    clock: { now: () => now },
    ids: { next: () => `${name}-${String(++counter).padStart(3, '0')}` },
  });
  await local.init();
  return new SyncingRepository(
    local,
    'a.b.c.d',
    memoryCursorStore({ pulled: 0, pushed: 0, device: id }),
    { fetch },
    () => now,
  );
};

const startSession = async (repository: SyncingRepository, venueName = 'Aria') => {
  const venue = await repository.createVenue({ name: venueName, isHomeGame: false });
  return repository.createSession({
    venueId: venue.id,
    format: 'cash',
    gameType: 'NLHE',
    stakes: { smallBlind: 100, bigBlind: 200 },
    buyIn: 30_000,
    startedAt: now,
  });
};

beforeEach(() => {
  now = T0;
});

afterEach(async () => {
  while (drivers.length) await drivers.pop()?.close();
});

describe('a log written on one device and read on another', () => {
  it('arrives', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    const there = await laptop.getSession(session.id);
    expect(there?.id).toBe(session.id);
    expect(there?.venue?.name).toBe('Aria');
  });

  it('arrives with its hands and its rebuys', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.addRebuy({ sessionId: session.id, amount: 20_000, at: now });
    await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
    await phone.push();
    await laptop.push(true);

    expect((await laptop.listHands()).map((hand) => hand.holeCards)).toEqual(['AsKd']);
    expect((await laptop.listRebuys(session.id)).map((rebuy) => rebuy.amount)).toEqual([20_000]);
  });

  it('and an edit made afterwards catches up', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    tick(HOUR);
    await phone.updateSession(session.id, { notes: 'table broke at 1am' });
    await phone.push();
    await laptop.push(true);

    expect((await laptop.getSession(session.id))?.notes).toBe('table broke at 1am');
  });
});

describe('editing a session on one device', () => {
  it('does not destroy the hands logged on the other', async () => {
    // This is the question the rest of this file was supposed to be asking and
    // was not. Every case here applied a session in the SAME delta as its
    // children -- a fresh insert. The ordinary case is an edit arriving for a
    // session whose children this device already has, and that was silently
    // hard-deleting all of them on the native engine.
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
    await phone.addRebuy({ sessionId: session.id, amount: 20_000, at: now });
    await phone.push();
    await laptop.push(true);
    expect(await laptop.listHands()).toHaveLength(1);

    // The laptop edits nothing but the notes. The phone pulls that edit.
    tick(HOUR);
    await laptop.updateSession(session.id, { notes: 'table broke at 1am' });
    await laptop.push();
    await phone.push(true);

    expect((await phone.getSession(session.id))?.notes).toBe('table broke at 1am');
    expect(await phone.listHands()).toHaveLength(1);
    expect(await phone.listRebuys(session.id)).toHaveLength(1);
  });

  it('and the hands survive an edit made on the device that owns them', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
    await phone.push();
    await laptop.push(true);

    // Round trip: the phone's own edit comes back to it from the server.
    tick(HOUR);
    await phone.updateSession(session.id, { notes: 'mine' });
    await phone.push();
    await phone.push(true);

    expect(await phone.listHands()).toHaveLength(1);
    expect(await laptop.listHands()).toHaveLength(1);
  });
});

describe('a session deleted on one device', () => {
  it('stays deleted on the other, which is the whole reason for tombstones', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);
    expect(await laptop.getSession(session.id)).not.toBeNull();

    tick(HOUR);
    await phone.deleteSession(session.id);
    await phone.push();
    await laptop.push(true);

    expect(await laptop.getSession(session.id)).toBeNull();
    expect(await laptop.listSessions()).toEqual([]);
  });

  it('and does not come back on the next sync after that', async () => {
    // The failure this whole phase exists to prevent: the laptop still holds
    // the row and would push it back up as news.
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);
    tick(HOUR);
    await phone.deleteSession(session.id);
    await phone.push();
    await laptop.push(true);

    tick(HOUR);
    await laptop.push(true);
    await phone.push(true);

    expect(await laptop.listSessions()).toEqual([]);
    expect(await phone.listSessions()).toEqual([]);
  });
});

describe('both devices used while neither could sync', () => {
  it('ends with both logs on both', async () => {
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    held.offline = true;
    const onPhone = await startSession(phone, 'Aria');
    tick(HOUR);
    const onLaptop = await startSession(laptop, 'Bellagio');

    // Both writes committed locally with the network dead. That is the normal
    // case in a card room, not the degraded one.
    expect(await phone.getSession(onPhone.id)).not.toBeNull();
    expect(await laptop.getSession(onLaptop.id)).not.toBeNull();

    held.offline = false;
    tick(HOUR);
    await phone.push(true);
    await laptop.push(true);
    await phone.push(true);

    const seen = async (repository: SyncingRepository) =>
      (await repository.listSessions()).map((session) => session.id).sort();
    expect(await seen(phone)).toEqual([onLaptop.id, onPhone.id].sort());
    expect(await seen(laptop)).toEqual([onLaptop.id, onPhone.id].sort());
  });

  it('and one of the two running sessions is closed, on both', async () => {
    // Log allows one active session. Two devices can each start one without
    // either being wrong, and the merge has to settle it the same way for both.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    held.offline = true;
    await startSession(phone);
    tick(2 * HOUR);
    const later = await startSession(laptop);

    held.offline = false;
    tick(HOUR);
    await phone.push(true);
    await laptop.push(true);
    await phone.push(true);

    for (const repository of [phone, laptop]) {
      const running = await repository.listSessions({ status: 'active' });
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(later.id);
    }

    // The one that lost is ended but has no cash-out, so it is neither active
    // nor complete and stays out of every total until somebody says what came
    // off the table.
    const closed = await phone.listSessions({ status: 'completed' });
    expect(closed).toHaveLength(1);
    expect(closed[0].cashOut).toBeNull();
  });
});

describe('the loop around it', () => {
  it('commits locally before the network is touched at all', async () => {
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    held.offline = true;

    const session = await startSession(phone);
    expect(await phone.getSession(session.id)).not.toBeNull();
    expect(phone.current().problem).not.toBe(null);
  });

  it('sends what it could not send, once it can', async () => {
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    held.offline = true;
    const session = await startSession(phone);
    await phone.push(true);
    expect(phone.current().problem).toBe('unreachable');

    held.offline = false;
    await phone.push(true);
    expect(phone.current().problem).toBeNull();
    expect(phone.current().lastSyncedAt).not.toBeNull();

    await laptop.push(true);
    expect(await laptop.getSession(session.id)).not.toBeNull();
  });

  it('stops trying when the token has stopped meaning anything', async () => {
    // Retrying cannot fix this one: somebody has to sign in again, and a loop
    // that kept asking would spend a battery to be told so repeatedly.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    held.unauthorized = true;

    await phone.push(true);
    expect(phone.current().problem).toBe('unauthorized');

    const spent = held.calls;
    await phone.push();
    expect(held.calls).toBe(spent);
  });

  it('waits before trying again after an ordinary failure', async () => {
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    held.offline = true;

    await phone.push(true);
    const spent = held.calls;
    await phone.push();
    expect(held.calls).toBe(spent);

    // And tries again once the wait is over.
    tick(10 * 60_000);
    held.offline = false;
    await phone.push();
    expect(held.calls).toBeGreaterThan(spent);
  });

  it('does not ask again when nothing has changed', async () => {
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    await startSession(phone);
    await phone.push(true);

    const spent = held.calls;
    await phone.push();
    expect(held.calls).toBe(spent);
  });
});

describe('collecting tombstones, once nobody is still waiting', () => {
  const DAY = 24 * HOUR;
  const RETENTION = 90 * DAY;

  it('is not collected while the other device has not seen the delete', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    tick(DAY);
    await phone.deleteSession(session.id);
    await phone.push();

    // The laptop has not synced since the delete. Well past the window, and the
    // tombstone still has to be there: the laptop is holding the live row, and
    // without something to refuse it, it would push the session back.
    tick(RETENTION + DAY);
    await phone.push(true);
    const { sessions } = await phone.listChangedSince(0);
    expect(sessions.some((change) => change.record.id === session.id)).toBe(true);
  });

  it('and once it has, the row goes from the server and from both devices', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    tick(DAY);
    await phone.deleteSession(session.id);
    await phone.push();
    await laptop.push(true);
    expect(await laptop.getSession(session.id)).toBeNull();

    // Both devices have to have been seen past the window before the server
    // will draw a line, and each one then sweeps on its own next sync. So it
    // takes a round each, which is exactly the caution the rule is for.
    tick(RETENTION + DAY);
    await phone.push(true);
    await laptop.push(true);
    tick(DAY);
    await phone.push(true);

    // Gone for real on both, not merely invisible.
    for (const repository of [phone, laptop]) {
      const { sessions } = await repository.listChangedSince(0);
      expect(sessions.some((change) => change.record.id === session.id)).toBe(false);
    }

    // And it does not come back on the sync after that, which is the failure
    // collecting too early would produce.
    tick(DAY);
    await laptop.push(true);
    await phone.push(true);
    expect(await phone.listSessions()).toEqual([]);
    expect(await laptop.listSessions()).toEqual([]);
  });

  it('never collects further than the server has', async () => {
    // A device that swept on its own clock could drop a tombstone the others
    // have not seen, and then push the live row back itself.
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);
    tick(DAY);
    await phone.deleteSession(session.id);
    await phone.push();

    // The phone is long past the window on its own reckoning. The laptop is not
    // caught up, so the server has drawn no line and the phone collects nothing.
    tick(RETENTION + DAY);
    await phone.push(true);
    const { sessions } = await phone.listChangedSince(0);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].deletedAt).not.toBeNull();
  });
});

describe('resetting a device', () => {
  it('empties it, and the next sync brings the log back', async () => {
    // Reset means this device, not every device. Wiping a phone that is about
    // to be sold must not take five years of history off the laptop.
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    await laptop.clearAll();
    expect(await laptop.listSessions()).toEqual([]);

    tick(HOUR);
    await laptop.push(true);
    expect((await laptop.getSession(session.id))?.id).toBe(session.id);

    // And the phone still has it, which is the half that would be a disaster.
    expect(await phone.getSession(session.id)).not.toBeNull();
  });
});
