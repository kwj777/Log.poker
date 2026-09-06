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
import { SyncingRepository, memoryCursorStore, type CursorStore } from '../SyncingRepository';
import { mergeIntoBundle } from '../../sync/bundle';
import { countChanges } from '../../sync/protocol';
import type { Fetch } from '../../sync/client';
import type { ChangeSet, Repository } from '../repository';
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
  const held: {
    bundle: unknown;
    offline: boolean;
    unauthorized: boolean;
    calls: number;
    /** Set to hold the answer open, which is where a write lands mid-request. */
    hold: (() => Promise<void>) | null;
  } = {
    bundle: null,
    offline: false,
    unauthorized: false,
    calls: 0,
    hold: null,
  };

  const fetch = (async (_url: string, init: RequestInit) => {
    held.calls += 1;
    if (held.hold) await held.hold();
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

  it('even when it was deleted with no signal and pushed days later', async () => {
    // The cursor is what makes this hard. A delete carries the moment it was
    // made, and if the other device syncs in between, its cursor is already
    // past that moment: the tombstone lands on the server and is then never
    // handed to the one device still holding the row. Nothing refuses it and
    // nothing collects it. The two devices simply disagree, forever.
    const DAY = 24 * HOUR;
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.endSession(session.id, 40_000, now);
    await phone.push();
    await laptop.push(true);
    expect(await laptop.getSession(session.id)).not.toBeNull();

    // Deleted at the table, where there is no wifi.
    tick(DAY);
    held.offline = true;
    await phone.deleteSession(session.id);
    await phone.push(true);
    held.offline = false;

    // Three days later the laptop is used, and its cursor moves well past the
    // moment the phone deleted anything.
    tick(3 * DAY);
    await startSession(laptop, 'Bellagio');
    await laptop.push(true);

    // The phone finds wifi and sends the delete it has been holding.
    tick(HOUR);
    await phone.push(true);
    await laptop.push(true);

    expect(await laptop.getSession(session.id)).toBeNull();
  });

  it('and is not undone by a rule the server ran while it was in flight', async () => {
    // The three constraint rules stamp the records they write with the
    // server's clock. A device that was offline while one of them ran comes
    // back with a delete stamped earlier, loses the comparison, and is thrown
    // away: the session the player deleted is closed instead, and comes back
    // down to the device that deleted it.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    tick(HOUR);
    held.offline = true;
    await phone.deleteSession(session.id);
    await phone.push(true);
    held.offline = false;

    // The laptop starts a session of its own. The server now sees two running
    // and closes the older one, which is the rule working as intended.
    tick(HOUR);
    await startSession(laptop, 'Bellagio');
    await laptop.push(true);

    tick(HOUR);
    await phone.push(true);
    await laptop.push(true);

    expect(await phone.getSession(session.id)).toBeNull();
    expect(await laptop.getSession(session.id)).toBeNull();
  });
});

describe('a note typed while the sync was in flight', () => {
  it('is not overwritten by its own pre-edit self coming back', async () => {
    // Every answer carries back the records the device just pushed, because
    // the server heard them in the request it is answering. So the round trip
    // routinely delivers an older copy of a row this device is still editing,
    // and applying it blind loses the edit twice over: off the screen, and off
    // the list of things still waiting to go up.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');

    const session = await startSession(phone);
    await phone.push();

    // The request goes out, and the note is typed before the answer lands.
    let release: (() => void) | null = null;
    held.hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const inFlight = phone.push(true);
    for (let spin = 0; spin < 50 && release === null; spin += 1) await Promise.resolve();
    tick(HOUR);
    await phone.updateSession(session.id, { notes: 'raised the straddle' });
    (release as unknown as () => void)();
    held.hold = null;
    await inFlight;

    expect((await phone.getSession(session.id))?.notes).toBe('raised the straddle');

    // And it reaches the other device, which is the half that would have gone
    // silently: overwritten, the note also drops below the push mark.
    const laptop = await device(fetch, 'laptop');
    await phone.push(true);
    await laptop.push(true);
    expect((await laptop.getSession(session.id))?.notes).toBe('raised the straddle');
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

describe('what the loop does with a bad day', () => {
  it('does not send back up everything it has just pulled down', async () => {
    // `applyChanges` stores an incoming record under the stamp the device that
    // wrote it chose, so without a mark that covers them, every record just
    // pulled sits above the push cursor. On a laptop that has taken years of
    // somebody's history, the first note they type uploads all of it again,
    // and past the endpoint's body cap that is a wedge rather than a waste.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    tick(HOUR);
    await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
    tick(HOUR);
    await phone.addRebuy({ sessionId: session.id, amount: 20_000, at: now });
    tick(HOUR);
    await phone.push(true);
    await laptop.push(true);
    expect(await laptop.listHands()).toHaveLength(1);
    expect(countChanges(await laptop.listChangedSince(0))).toBe(4);

    // One local write on the laptop. What goes up is that write and, at most,
    // the one stamp of overlap the push mark always re-reads.
    tick(HOUR);
    const sent: number[] = [];
    const counting = ((url: string, init: RequestInit) => {
      const { changes } = JSON.parse(init.body as string);
      sent.push(countChanges(changes));
      return (fetch as unknown as (u: string, i: RequestInit) => unknown)(url, init);
    }) as unknown as typeof fetch;
    const writer = new SyncingRepository(
      (laptop as unknown as { local: Repository }).local,
      'a.b.c.d',
      memoryCursorStore(await (laptop as unknown as { cursors: CursorStore }).cursors.read()),
      { fetch: counting },
      () => now,
    );
    await writer.createVenue({ name: 'Bellagio', isHomeGame: false });
    await writer.push(true);

    expect(held.calls).toBeGreaterThan(0);
    expect(Math.max(...sent)).toBeLessThanOrEqual(2);
  });

  it('gets a backlog too big for one request up, a piece at a time', async () => {
    // Over the endpoint's cap the whole push is refused, the client reads that
    // as `refused`, and it retries the identical body every five minutes for
    // the life of the install. The player this feature exists for is the one
    // it locked out.
    const { held, fetch } = server();
    const CAP = 3_000;
    const refusing = (async (url: string, init: RequestInit) => {
      if ((init.body as string).length > CAP) {
        return { ok: false, status: 400, json: async () => ({ error: 'refused' }) } as Response;
      }
      return (fetch as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;

    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    let counter = 0;
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => `full-${String(++counter).padStart(3, '0')}` },
    });
    await local.init();
    const phone = new SyncingRepository(
      local,
      'a.b.c.d',
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-loaded01' }),
      { fetch: refusing, budget: 1_200 },
      () => now,
    );

    // Years of it, written before this device ever managed to sync: otherwise
    // the push after each write drains the backlog as it is made, and there is
    // never a big one to send.
    held.offline = true;
    const venue = await phone.createVenue({ name: 'Aria', isHomeGame: false });
    const sessions = [];
    for (let index = 0; index < 6; index += 1) {
      tick(HOUR);
      const session = await phone.createSession({
        venueId: venue.id, format: 'cash', gameType: 'NLHE',
        stakes: { smallBlind: 100, bigBlind: 200 }, buyIn: 30_000, startedAt: now,
      });
      tick(HOUR);
      await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
      // Edited afterwards, which is what puts a session's stamp above its own
      // hands and makes a plain time prefix unsafe.
      tick(HOUR);
      await phone.updateSession(session.id, { notes: `table ${index}`.padEnd(120, '.') });
      sessions.push(session.id);
    }

    held.offline = false;
    for (let round = 0; round < 12; round += 1) await phone.push(true);
    expect(phone.current().problem).toBeNull();

    const laptop = await device(refusing, 'laptop');
    await laptop.push(true);
    expect((await laptop.listSessions()).map((session) => session.id).sort())
      .toEqual([...sessions].sort());
    expect(await laptop.listHands()).toHaveLength(6);
    expect(held.calls).toBeGreaterThan(2);
  });

  it('keeps trying after the local database throws, rather than going quiet', async () => {
    // `run` clears the dirty flag before it reads anything, so a throw past
    // that point loses the write, records no failure, arms no backoff, and
    // leaves the state saying a sync is in progress. Forever.
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const session = await startSession(phone);
    await phone.push();

    let failing = true;
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const plain = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => `reader-${String(now)}` },
    });
    await plain.init();
    const brittle = new Proxy(plain, {
      get(target, property, receiver) {
        if (property === 'applyChanges') {
          return async (changes: ChangeSet) => {
            if (failing) throw new Error('disk full');
            await target.applyChanges(changes);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Repository;
    const reader = new SyncingRepository(
      brittle,
      'a.b.c.d',
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-reader001' }),
      { fetch },
      () => now,
    );

    await reader.push(true);
    // Named as a failure and armed to try again, not silently still running.
    expect(reader.current().running).toBe(false);
    expect(reader.current().problem).toBe('unreachable');

    failing = false;
    await reader.push(true);
    expect((await reader.getSession(session.id))?.id).toBe(session.id);
  });

  it('does not sit out a backward clock correction', async () => {
    // The backoff window is an instant on a clock the phone can move, and
    // moving it backwards is exactly what a phone does when it finds the
    // network after being wrong. A wait longer than the longest backoff there
    // is cannot be a real one.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');
    await startSession(phone);

    held.offline = true;
    await phone.push(true);
    expect(phone.current().problem).toBe('unreachable');

    held.offline = false;
    now -= 30 * 24 * HOUR;
    const spent = held.calls;
    await phone.push();
    expect(held.calls).toBeGreaterThan(spent);
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

    // Both devices have to have been answered past the window before the server
    // will draw a line, and each one then sweeps on its own next sync. So it is
    // two rounds each: the first hands the tombstone over and records the
    // device as caught up, the second is the one allowed to sweep. That is
    // exactly the caution the rule is for, and it is cheap -- a sync is a
    // request, and this is a row that has been dead for three months.
    tick(RETENTION + DAY);
    await phone.push(true);
    await laptop.push(true);
    tick(DAY);
    await phone.push(true);
    await laptop.push(true);

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

  it('and a request already in flight cannot undo it', async () => {
    // The reset is a tap, and a push is in flight after every write, so the
    // two overlap by construction. The order that costs the log is this one:
    // the answer has already been applied when the reset lands, and the run
    // then records the cursors it read before it. The device is left empty and
    // holding a cursor that says it has seen everything, so the next sync
    // brings back nothing and it stays empty for good.
    const { fetch } = server();
    const phone = await device(fetch, 'phone');

    const session = await startSession(phone);
    await phone.push();

    // A local repository whose next `applyChanges` yields once it has written,
    // which is where a tap on reset can land. Everything else delegates.
    let release: (() => void) | null = null;
    let hold = false;
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const plain = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => `reading-${String(now)}` },
    });
    await plain.init();
    const gated = new Proxy(plain, {
      get(target, property, receiver) {
        if (property === 'applyChanges') {
          return async (changes: ChangeSet) => {
            await target.applyChanges(changes);
            if (!hold) return;
            hold = false;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Repository;
    const reading = new SyncingRepository(
      gated,
      'a.b.c.d',
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-reading01' }),
      { fetch },
      () => now,
    );

    // One ordinary sync first, so the cursor a stale write would restore is
    // strictly past the session and could never bring it back.
    await reading.push(true);
    expect(await reading.getSession(session.id)).not.toBeNull();
    tick(HOUR);
    await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
    await phone.push(true);

    hold = true;
    const inFlight = reading.push(true);
    for (let spin = 0; spin < 50 && release === null; spin += 1) await Promise.resolve();
    expect(await reading.listHands()).toHaveLength(1);

    await reading.clearAll();
    expect(await reading.listSessions()).toEqual([]);

    (release as unknown as () => void)();
    await inFlight;

    // The cursors the reset wrote have to be the ones that survive, so the
    // next sync brings the whole log back down.
    tick(HOUR);
    await reading.push(true);
    expect((await reading.getSession(session.id))?.id).toBe(session.id);

    // And the phone still has it, which is the half that would be a disaster.
    expect(await phone.getSession(session.id)).not.toBeNull();
  });
});
