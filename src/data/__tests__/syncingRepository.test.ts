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
import { SyncingRepository, memoryCursorStore, type CursorStore, type Cursors } from '../SyncingRepository';
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
    /** Lowered so a handful of records can meet the answer cap. */
    answerBudget: number | undefined;
  } = {
    bundle: null,
    offline: false,
    unauthorized: false,
    calls: 0,
    hold: null,
    answerBudget: undefined,
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
    const merged = mergeIntoBundle(held.bundle, changes, since, now, device, held.answerBudget);
    held.bundle = JSON.parse(JSON.stringify(merged.bundle));
    return {
      ok: true,
      status: 200,
      json: async () =>
        JSON.parse(
          JSON.stringify({
            cursor: merged.cursor,
            changes: merged.changes,
            more: merged.more,
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
    memoryCursorStore({ pulled: 0, pushed: 0, device: id, settled: 0, subject: null }),
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
    // The point of the test: the row is here whether or not the network is.
    expect(await phone.getSession(session.id)).not.toBeNull();

    // And the failure is recorded, once the push that `touched` started has
    // got as far as failing. This used to read `current()` straight after
    // `startSession` and pass on the background push happening to have
    // finished inside its awaits, which is a race rather than an assertion:
    // one more await anywhere above the network call and it reads a run still
    // in flight and sees no problem yet.
    await phone.push(true);
    expect(phone.current().problem).toBe('unreachable');
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
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-loaded01', settled: 0, subject: null }),
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

  it('sends what a slow-clocked device wrote between syncs', async () => {
    // The push mark rises to whatever the newest record in the backlog says,
    // and that includes records pulled from a device running a few minutes
    // ahead. Once the mark sits above this device's own clock, a floor that
    // clamped to the clock read from *now* and so skipped everything written
    // before now: every write between syncs, on every sync, silently, with
    // each round reported a success.
    const SKEW = 10 * 60_000;
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');

    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    let counter = 0;
    const local = new SqlRepository(driver, {
      clock: { now: () => now - SKEW },
      ids: { next: () => `slow-${String(++counter).padStart(3, '0')}` },
    });
    await local.init();
    const laptop = new SyncingRepository(
      local,
      'a.b.c.d',
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-slow0001', settled: 0, subject: null }),
      { fetch },
      () => now - SKEW,
    );

    await startSession(phone, 'Aria');
    await phone.push(true);
    tick(60_000);
    await laptop.push(true);
    tick(60_000);
    await laptop.push(true);

    // Written on the slow clock, with no signal, so it is still waiting when
    // the next sync comes round.
    tick(60_000);
    held.offline = true;
    const venue = await laptop.createVenue({ name: 'Bellagio', isHomeGame: false });
    await laptop.push(true).catch(() => undefined);
    held.offline = false;

    // And several ordinary syncs later, it has to be on the other device.
    for (const step of [2, 3, 4, 5]) {
      tick(step * 60_000);
      await laptop.push(true);
    }
    await phone.push(true);
    expect((await phone.listVenues()).map((v) => v.name).sort()).toContain('Bellagio');
    expect(await phone.getVenue(venue.id)).not.toBeNull();
  });

  it('takes a history too big for one answer, a piece at a time', async () => {
    // The request was capped and the answer was not, which is the wrong way
    // round: a first pull is the big one, and it is the one the feature exists
    // for. Past what the platform will return, a device could never finish a
    // first sync and no amount of retrying would change it.
    const { held, fetch } = server();
    const phone = await device(fetch, 'phone');

    const venue = await phone.createVenue({ name: 'Aria', isHomeGame: false });
    for (let index = 0; index < 6; index += 1) {
      tick(HOUR);
      const session = await phone.createSession({
        venueId: venue.id, format: 'cash', gameType: 'NLHE',
        stakes: { smallBlind: 100, bigBlind: 200 }, buyIn: 30_000, startedAt: now,
      });
      tick(HOUR);
      await phone.createHand({ sessionId: session.id, holeCards: 'AsKd', at: now });
    }
    await phone.push(true);

    // A laptop with nothing, asking for all of it through a keyhole.
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => `late-${String(now)}` },
    });
    await local.init();
    const laptop = new SyncingRepository(
      local,
      'a.b.c.d',
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-late00001', settled: 0, subject: null }),
      { fetch },
      () => now,
    );

    // Through a keyhole: a handful of records is enough to meet this cap.
    held.answerBudget = 900;

    // One call. Coming back for the rest is the loop's own job, driven by the
    // flag on the answer, so a device that only ever reads still finishes.
    const before = held.calls;
    await laptop.push(true);
    expect(held.calls - before).toBeGreaterThan(1);
    expect((await laptop.listSessions()).length).toBeGreaterThan(1);

    // And it finishes, over as many syncs as it takes.
    for (let round = 0; round < 12; round += 1) await laptop.push(true);
    expect(laptop.current().problem).toBeNull();
    expect(await laptop.listHands()).toHaveLength(6);
    expect((await laptop.listSessions())).toHaveLength(6);
  });

  it('says what is still waiting when a round could not send it all', async () => {
    // Every round but the last overwrites this with the true count, so the lie
    // only ever showed on the round the loop stopped on -- which is the one a
    // player reads. A backlog above five rounds ended reporting a sync that had
    // just succeeded with nothing left to send, and thousands of records here.
    const { held, fetch } = server();
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
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-heavy001', settled: 0, subject: null }),
      { fetch, budget: 400 },
      () => now,
    );

    held.offline = true;
    const venue = await phone.createVenue({ name: 'Aria', isHomeGame: false });
    for (let index = 0; index < 20; index += 1) {
      tick(HOUR);
      await phone.createSession({
        venueId: venue.id, format: 'cash', gameType: 'NLHE',
        stakes: { smallBlind: 100, bigBlind: 200 }, buyIn: 30_000, startedAt: now,
      });
    }
    // Drained while still offline, so the forced push below is its own run
    // rather than a join onto one that had already failed.
    await phone.push(true).catch(() => undefined);
    held.offline = false;

    await phone.push(true);
    // The loop stopped with records still to go, and it says so.
    expect(phone.current().pending).toBeGreaterThan(0);
    expect(countChanges(await phone.listChangedSince(0))).toBeGreaterThan(
      phone.current().pending,
    );
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
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-reader001', settled: 0, subject: null }),
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

  it('takes a live hand with the session it hangs off, on the server and on both devices', async () => {
    // The one assertion in `collect` that nothing checked. Its orphan sweep
    // deletes any child whose session is no longer in the bundle, with no
    // horizon and no acked check, and the comment justifying that says *both
    // device engines take that child with the session when they sweep*. That
    // sentence is load-bearing for a rule which permanently destroys live
    // records, and it was asserted nowhere: the server rule is tested in
    // `bundle.test.ts`, each engine's sweep in the repository contract, and
    // the agreement between them by nothing at all. If either side drifts, the
    // server destroys a row the devices still hold, or keeps one they dropped
    // and re-serves it to every device forever.
    //
    // A live child under a session tombstone is not exotic. It is what happens
    // whenever one device logs a hand on a session another has just deleted.
    const { fetch, held } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();
    await laptop.push(true);

    tick(DAY);
    await laptop.deleteSession(session.id);
    await laptop.push();

    // The phone has not heard about the delete yet, so the session is still
    // live here and a hand can be logged on it. It goes up in the same round
    // that brings the tombstone down.
    tick(HOUR);
    const hand = await phone.createHand({ sessionId: session.id, at: now });
    await phone.push(true);
    expect(await phone.getSession(session.id)).toBeNull();

    // It reached the server and was served on: both ends are holding a live
    // hand under a tombstoned session, which is the state being collected.
    await laptop.push(true);
    for (const repository of [phone, laptop]) {
      const { hands } = await repository.listChangedSince(0);
      expect(hands.some((change) => change.record.id === hand.id)).toBe(true);
    }

    // Two rounds each past the window, as above: the first records each device
    // as caught up, the second is the one allowed to sweep.
    tick(RETENTION + DAY);
    await phone.push(true);
    await laptop.push(true);
    tick(DAY);
    await phone.push(true);
    await laptop.push(true);

    // The session went, and the hand went with it, in all three places. A hand
    // left on the server here would be served in every full pull from then on
    // and skipped by every device that received it.
    for (const repository of [phone, laptop]) {
      const { sessions, hands } = await repository.listChangedSince(0);
      expect(sessions.some((change) => change.record.id === session.id)).toBe(false);
      expect(hands.some((change) => change.record.id === hand.id)).toBe(false);
    }

    // And gone from the bundle, which is the only place it can be seen to be
    // gone. A device asked about an orphaned hand skips it -- its session is
    // missing -- so every device looks identical whether the server dropped it
    // or is still holding it. That is exactly why it can rot there: served in
    // every full pull from then on, and skipped by everything that receives it.
    const bundle = held.bundle as { records: { hands: Record<string, unknown> } };
    expect(Object.keys(bundle.records.hands)).toEqual([]);

    const fresh = await device(fetch, 'fresh');
    await fresh.push(true);
    expect(await fresh.listHands()).toEqual([]);
    expect(await fresh.listSessions()).toEqual([]);
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

    // Nothing is pushed here on purpose. `clearAll` promises the next sync
    // brings the log back, and it has to be the one that asks for it: this test
    // used to supply the call itself, which is why nothing noticed that a reset
    // device sat empty until somebody typed into it or reopened the app.
    for (let spin = 0; spin < 50; spin += 1) await Promise.resolve();
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
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-reading01', settled: 0, subject: null }),
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

/* ------------------------------------------------------- forgetting a bucket */

/**
 * What a device forgets when it puts a token down.
 *
 * The cursors are this device's place in a conversation with one bucket, and
 * for a while nothing ever forgot them. That is not untidiness: it is silent
 * data loss twice over, and both halves are here.
 */
describe('forgetting where the conversation had got to', () => {
  /**
   * One local database and one cursor store, wrapped as many times as asked.
   *
   * Which is what the app does: `forget` halts the wrapper, and signing in
   * again builds a new one over the same two things. A test that made a second
   * *device* instead would be pushing an empty log and proving nothing.
   */
  const reWrappable = async (fetch: Fetch, name: string, id = `device-${name}0001`) => {
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    let counter = 0;
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => `${name}-${String(++counter).padStart(3, '0')}` },
    });
    await local.init();
    const cursors = memoryCursorStore({ pulled: 0, pushed: 0, device: id, settled: 0, subject: null });
    return {
      cursors,
      wrap: () => new SyncingRepository(local, 'a.b.c.d', cursors, { fetch }, () => now),
    };
  };

  /**
   * Two sessions an hour apart, pushed.
   *
   * The gap is the whole point. Both comparisons read one millisecond back, so
   * the newest records are re-sent on every sync whatever the cursor says: a
   * log written in one millisecond goes back up with or without this fix, and
   * a test built on one passes either way. Only the older session is genuinely
   * behind the mark, so only the older session proves anything.
   */
  const twoSessions = async (fetch: Fetch, held: { bundle: unknown }) => {
    const phone = await reWrappable(fetch, 'phone');
    const signedIn = phone.wrap();
    const older = await startSession(signedIn, 'Aria');
    tick(HOUR);
    await startSession(signedIn, 'Bellagio');
    await signedIn.push();
    expect(held.bundle).not.toBeNull();
    return { phone, signedIn, older };
  };

  it('lets an erased log go back up, which it could not before', async () => {
    // The erase deletes the bucket. Without this the device still believes it
    // has pushed everything, so signing in again pushes only the last
    // millisecond of it, the rest never goes back, and the app reports that it
    // is up to date.
    const { fetch, held } = server();
    const { phone, signedIn, older } = await twoSessions(fetch, held);

    // The server copy is erased out from under it, the way the DELETE does,
    // and then this device puts its token down.
    held.bundle = null;
    await signedIn.forget();

    // Signing in again: a new wrapper over the same local database and the
    // same cursor store, which is what `recomposeRepository` builds.
    await phone.wrap().push(true);

    const laptop = await device(fetch, 'laptop');
    await laptop.push(true);
    expect((await laptop.getSession(older.id))?.id).toBe(older.id);
  });

  it('and a push already in flight cannot put the old place back', async () => {
    // The erase is a tap and a push is in flight after every write, so the two
    // overlap by construction. A run that started first must not write the
    // cursors it read before the forget, or the log is stranded again and
    // nothing says so. The epoch fence is what stops it.
    const { fetch, held } = server();
    const { phone, signedIn, older } = await twoSessions(fetch, held);

    let release: (() => void) | null = null;
    held.hold = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });

    const inFlight = signedIn.push(true);
    for (let spin = 0; spin < 50 && release === null; spin += 1) await Promise.resolve();

    held.bundle = null;
    await signedIn.forget();

    (release as unknown as () => void)();
    await inFlight;
    held.hold = null;

    // The forget has to be what survives, so the whole log still goes back up.
    await phone.wrap().push(true);

    const laptop = await device(fetch, 'laptop');
    await laptop.push(true);
    expect((await laptop.getSession(older.id))?.id).toBe(older.id);
  });

  it('keeps the device id, or the server counts one phone as two', async () => {
    // Forgetting it would make this device look new and hold up collection for
    // a whole retention window under a name nobody will use again.
    const cursors = memoryCursorStore({ pulled: 40, pushed: 30, device: 'device-keepme001', settled: 0, subject: null });
    const { fetch } = server();
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'x-001' },
    });
    await local.init();

    await new SyncingRepository(local, 'a.b.c.d', cursors, { fetch }, () => now).forget();

    // And carries what the server has heard across, which is the other thing
    // that must not be forgotten here. `pushed` is thrown away because it is
    // this account's place in a conversation; `settled` is kept because it is
    // how far back this database is safe to collect, which is a fact about the
    // device and not about who was signed in.
    expect(await cursors.read()).toEqual({
      pulled: 0,
      pushed: 0,
      device: 'device-keepme001',
      settled: 30,
      // Kept as it was. A rewind is not a change of bucket, and `settle` is
      // what notices one of those.
      subject: null,
    });
  });

  /** A wrapper over an empty database, which is all these two need. */
  const forgetting = async (start: Cursors) => {
    const cursors = memoryCursorStore(start);
    const { fetch } = server();
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'x-001' },
    });
    await local.init();
    return {
      cursors,
      wrapper: new SyncingRepository(local, 'a.b.c.d', cursors, { fetch }, () => now),
    };
  };

  it('carries the high-water mark forward rather than the higher of the two', async () => {
    // `settled` only ever moves forward. A sign-out after a sync that pushed
    // less than a previous one -- a batch held back, so `pushed` came back
    // lower -- must not walk the mark backwards, or a tombstone that was
    // already safe to collect stops being collectable and stays forever.
    const { cursors, wrapper } = await forgetting({
      pulled: 40,
      pushed: 10,
      device: 'device-keepme001',
      settled: 99,
      subject: null,
    });
    await wrapper.forget();
    expect((await cursors.read()).settled).toBe(99);
  });

  it('rewinds the push cursor when the token names a different bucket', async () => {
    // The hole this closes has nothing to do with signing out, because `forget`
    // already rewinds there. The way in is an expiry: `SessionManager.current`
    // clears a token that has run out, on its own, with no card on screen and
    // nothing calling `forget`. The cursors outlive the session, and the next
    // sign-in on that device inherits them. A second person on a shared phone,
    // or the same person after the family's other door stopped being taken,
    // then has `pushed` saying their whole log was already sent -- to a bucket
    // that is not theirs -- so the new one is never sent anything and the card
    // reports it as up to date.
    const cursors = memoryCursorStore({
      pulled: 900,
      pushed: 800,
      device: 'device-shared001',
      settled: 100,
      subject: 'log_' + 'a1'.repeat(16),
    });
    const { fetch } = server();
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'x-001' },
    });
    await local.init();

    const other = 'log_' + 'b2'.repeat(16);
    const token = `${Math.floor((now + 3_600_000) / 1000)}.free.${other}.sig`;
    await new SyncingRepository(local, token, cursors, { fetch }, () => now).push(true);

    const held = await cursors.read();
    expect(held.subject).toBe(other);
    // Both, because it is a different conversation in both directions.
    expect(held.pulled).toBe(0);
    // And the high-water mark carries, so a tombstone that was already safe to
    // collect stays safe. Zeroing it here is what would resurrect a delete.
    expect(held.settled).toBe(800);
  });

  it('but leaves a device that is still talking to the same bucket alone', async () => {
    // The rule has to cost nothing on the ordinary path, which is every sync
    // by everybody who has not changed who they are signed in as.
    const mine = 'log_' + 'c3'.repeat(16);
    const cursors = memoryCursorStore({
      pulled: 900,
      pushed: 800,
      device: 'device-shared001',
      settled: 100,
      subject: mine,
    });
    const { fetch } = server();
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'y-001' },
    });
    await local.init();

    const token = `${Math.floor((now + 3_600_000) / 1000)}.free.${mine}.sig`;
    await new SyncingRepository(local, token, cursors, { fetch }, () => now).push(true);
    expect((await cursors.read()).settled).toBe(100);
  });

  it('and does not rewind on a token it cannot read, which is every expiry', async () => {
    // `readClaim` answers null for an expired token, and a run past the
    // thirtieth day would otherwise read that as a change of bucket and rewind
    // on every launch. The server is the one that refuses a dead token.
    const mine = 'log_' + 'd4'.repeat(16);
    const cursors = memoryCursorStore({
      pulled: 900,
      pushed: 800,
      device: 'device-shared001',
      settled: 100,
      subject: mine,
    });
    const { fetch } = server();
    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'z-001' },
    });
    await local.init();

    const dead = `${Math.floor((now - 3_600_000) / 1000)}.free.${'log_' + 'e5'.repeat(16)}.sig`;
    await new SyncingRepository(local, dead, cursors, { fetch }, () => now).push(true);
    const held = await cursors.read();
    expect(held.subject).toBe(mine);
    // `settled` is what tells the two branches apart: a rewind would have
    // raised it to `pushed`. `pulled` cannot say, because a sync that succeeds
    // overwrites it either way.
    expect(held.settled).toBe(100);
  });

  it('and a local reset keeps it, because the bucket is still there', async () => {
    // `clearAll` comes through the same rewind. It empties this device and
    // asks for the log back, and the server keeps everything it had, so
    // nothing about what it has heard has changed. Zeroing the mark here would
    // leave the gap between the reset and the next successful sync sweeping on
    // the window, with the bucket still holding every live row.
    const { cursors, wrapper } = await forgetting({
      pulled: 40,
      pushed: 30,
      device: 'device-keepme001',
      settled: 99,
      subject: null,
    });
    await wrapper.clearAll();
    expect((await cursors.read()).settled).toBe(99);
  });

  it('and drops it entirely when the bucket behind it is gone', async () => {
    // The erase door. Nothing is left in the bucket to send a deleted row
    // back, so this device is as free to collect as one that never signed in.
    // Keeping the mark here would leave somebody who erases and stays signed
    // out holding every tombstone they write from then on, forever.
    const { cursors, wrapper } = await forgetting({
      pulled: 40,
      pushed: 30,
      device: 'device-keepme001',
      settled: 99,
      subject: null,
    });
    await wrapper.forget({ erased: true });
    expect((await cursors.read()).settled).toBe(0);
  });
});

/* ------------------------------------------------------- telling the screens */

/**
 * Whether anything can tell that a pull moved the log.
 *
 * The rows go straight into the local database, and the store above holds the
 * arrays every screen renders. Nothing connected the two: the history somebody
 * signed in for arrived and then sat there, invisible, until the app was quit
 * and reopened.
 */
describe('saying that an answer changed the log', () => {
  it('counts up when an answer carries records', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    const session = await startSession(phone);
    await phone.push();

    const seen: number[] = [];
    laptop.subscribe((state) => seen.push(state.applied));

    await laptop.push(true);
    expect((await laptop.getSession(session.id))?.id).toBe(session.id);
    expect(Math.max(...seen)).toBe(1);
  });

  it('and not when there was nothing in it at all', async () => {
    // Which is a narrower case than it sounds, and worth being exact about:
    // both comparisons read one millisecond back, so a device that has already
    // pulled everything is served its own boundary records again on the next
    // sync and counts that. The redundant reload is one per sync on a device
    // that is syncing anyway, and every other write in the app already reloads
    // the log, so it is cheaper than the machinery to tell the two apart.
    const { fetch } = server();
    const alone = await device(fetch, 'alone');

    const seen: number[] = [];
    alone.subscribe((state) => seen.push(state.applied));

    await alone.push(true);
    expect(seen.every((count) => count === 0)).toBe(true);
  });
});

/* ------------------------------------------------------- which token it sends */

/**
 * The token this wrapper carries, and when it reads it.
 *
 * It used to be a string, captured once when the wrapper was built. Renewal
 * writes a fresh one to the store beside it at launch and nothing re-read it,
 * so a process outliving thirty days -- a browser tab left open, which is the
 * ordinary way to use the web build -- went on sending the token it started
 * with. The endpoint answers 401, `halted` latches, and sync stops for good
 * with a perfectly valid token sitting in the store. Nothing on screen says why.
 */
describe('the token it sends', () => {
  /** A server that writes down the bearer it was handed on every request. */
  const watching = () => {
    const { fetch, held } = server();
    const bearers: (string | null)[] = [];
    const watched = (async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
      bearers.push(auth === null ? null : auth.replace('Bearer ', ''));
      return fetch(url, init);
    }) as unknown as Fetch;
    return { fetch: watched, held, bearers };
  };

  it('is read again on every sync, so a renewal is picked up', async () => {
    const { fetch, bearers } = watching();
    let current = 'first.token.here.sig';

    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'r-001' },
    });
    await local.init();
    const wrapper = new SyncingRepository(
      local,
      async () => current,
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-renew0001', settled: 0, subject: null }),
      { fetch },
      () => now,
    );

    await wrapper.push(true);
    expect(bearers).toEqual(['first.token.here.sig']);

    // What `renewIfDue` does: a fresh one lands in the store beside it.
    current = 'second.token.here.sig';
    tick(HOUR);
    await wrapper.push(true);
    expect(bearers[bearers.length - 1]).toBe('second.token.here.sig');
  });

  it('and a sign-out stops it rather than sending nothing to the server', async () => {
    // `getToken` answers null once the token is gone. Sending that would be a
    // 401 and a backoff for a device that has nobody to sync for.
    const { fetch, bearers } = watching();
    let current: string | null = 'a.b.c.d';

    const driver = new NodeSqliteDriver(':memory:');
    drivers.push(driver);
    const local = new SqlRepository(driver, {
      clock: { now: () => now },
      ids: { next: () => 'g-001' },
    });
    await local.init();
    const wrapper = new SyncingRepository(
      local,
      async () => current,
      memoryCursorStore({ pulled: 0, pushed: 0, device: 'device-gone00001', settled: 0, subject: null }),
      { fetch },
      () => now,
    );

    await wrapper.push(true);
    expect(bearers).toHaveLength(1);

    current = null;
    tick(HOUR);
    await wrapper.push(true);
    expect(bearers).toHaveLength(1);
    expect(wrapper.current().problem).toBeNull();
  });
});

describe('the device that only reads', () => {
  /**
   * The case every other trigger misses.
   *
   * A push is the tail of a local write and there is one pull at launch, so a
   * device that is only being read from had no way back to the server for as
   * long as the process lived. The laptop with the tab open is the ordinary
   * shape of that, and it is also the device most likely to be asking the one
   * question this feature exists to answer.
   */
  it('sees what the other one logged, on coming back to the front', async () => {
    const { fetch } = server();
    const phone = await device(fetch, 'phone');
    const laptop = await device(fetch, 'laptop');

    // The laptop takes its answer at launch, and from here on only reads.
    await laptop.push();

    const session = await startSession(phone);
    await phone.push();

    // Without this line the laptop sits on its launch answer until the tab is
    // closed, and the session is nowhere.
    tick(HOUR);
    await laptop.resume();

    const there = await laptop.getSession(session.id);
    expect(there?.id).toBe(session.id);
    expect(there?.venue?.name).toBe('Aria');
  });

  it('does not spend a request on every switch between two tabs', async () => {
    const { held, fetch } = server();
    const laptop = await device(fetch, 'laptop');

    await laptop.resume();
    const spent = held.calls;

    // Half the window, which is one alt-tab and back.
    tick(15_000);
    await laptop.resume();
    expect(held.calls).toBe(spent);

    // And past it, which is somebody returning rather than passing through.
    tick(30_000);
    await laptop.resume();
    expect(held.calls).toBeGreaterThan(spent);
  });

  it('leaves a failing server alone, however often it is opened', async () => {
    // The backoff is what stands between a server that is down and every
    // device pointed at it. Coming to the front is not a reason to skip it.
    const { held, fetch } = server();
    const laptop = await device(fetch, 'laptop');
    held.offline = true;

    await laptop.push(true);
    const spent = held.calls;

    tick(1_000);
    await laptop.resume();
    expect(held.calls).toBe(spent);

    // And asks again once the wait is over.
    tick(10 * 60_000);
    held.offline = false;
    await laptop.resume();
    expect(held.calls).toBeGreaterThan(spent);
  });

  it('does not ask at all once the token has stopped meaning anything', async () => {
    const { held, fetch } = server();
    const laptop = await device(fetch, 'laptop');
    held.unauthorized = true;

    await laptop.push(true);
    expect(laptop.current().problem).toBe('unauthorized');

    const spent = held.calls;
    tick(HOUR);
    await laptop.resume();
    expect(held.calls).toBe(spent);
  });

  it('syncs after the clock has moved backwards rather than sitting out the jump', async () => {
    // A phone that finds the network and corrects its date reads as having
    // resumed in the future. Treated as a long enough wait, on the same
    // reasoning the backoff window uses.
    const { held, fetch } = server();
    const laptop = await device(fetch, 'laptop');

    await laptop.resume();
    const spent = held.calls;

    tick(-HOUR);
    await laptop.resume();
    expect(held.calls).toBeGreaterThan(spent);
  });
});
