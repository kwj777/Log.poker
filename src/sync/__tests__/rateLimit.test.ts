/**
 * How often one person may ask.
 *
 * The policy is pure and lives apart from the endpoint that applies it, so
 * everything about the rule is decided here and everything about the answer is
 * decided in `endpoint.test.ts`.
 */

import {
  RATE_LIMIT,
  RATE_WINDOW_MS,
  freshWindow,
  rateCheck,
  readWindow,
} from '../rateLimit';

const T0 = 1_700_000_000_000;

describe('inside the budget', () => {
  it('lets a first request through and opens a window on it', () => {
    const decision = rateCheck(freshWindow(), T0);
    expect(decision.allowed).toBe(true);
    expect(decision.next).toEqual({ since: T0, count: 1 });
  });

  it('counts each one that follows, without moving the window', () => {
    const decision = rateCheck({ since: T0, count: 7 }, T0 + 1_000);
    expect(decision.allowed).toBe(true);
    expect(decision.next).toEqual({ since: T0, count: 8 });
  });

  it('allows the last request the budget covers', () => {
    const decision = rateCheck({ since: T0, count: RATE_LIMIT - 1 }, T0 + 1_000);
    expect(decision.allowed).toBe(true);
    expect(decision.next.count).toBe(RATE_LIMIT);
  });
});

describe('over it', () => {
  it('refuses the one after that', () => {
    const decision = rateCheck({ since: T0, count: RATE_LIMIT }, T0 + 1_000);
    expect(decision.allowed).toBe(false);
  });

  it('leaves the window where it was, so refusing does not extend it', () => {
    // A refused request that pushed the count up would make a client in a loop
    // hold its own door shut for as long as it kept knocking.
    const window = { since: T0, count: RATE_LIMIT + 5 };
    expect(rateCheck(window, T0 + 1_000).next).toEqual(window);
  });

  it('says how long until it reopens, in whole seconds', () => {
    const decision = rateCheck({ since: T0, count: RATE_LIMIT }, T0 + 20_000);
    expect(decision.retryAfter).toBe(40);
  });

  it('and never says zero, which reads as "now" and would send them back', () => {
    const decision = rateCheck({ since: T0, count: RATE_LIMIT }, T0 + RATE_WINDOW_MS - 1);
    expect(decision.retryAfter).toBe(1);
  });

  it('opens the door again once the window has run out', () => {
    const decision = rateCheck({ since: T0, count: RATE_LIMIT * 10 }, T0 + RATE_WINDOW_MS);
    expect(decision.allowed).toBe(true);
    expect(decision.next).toEqual({ since: T0 + RATE_WINDOW_MS, count: 1 });
  });
});

describe('a clock that is not where it was', () => {
  it('starts a new window when time has gone backwards', () => {
    // Functions run on many machines whose clocks agree to within
    // milliseconds, not exactly. Nobody may be locked out for an hour because
    // one machine was an hour fast.
    const decision = rateCheck({ since: T0 + 3_600_000, count: RATE_LIMIT * 10 }, T0);
    expect(decision.allowed).toBe(true);
    expect(decision.next).toEqual({ since: T0, count: 1 });
  });
});

describe('reading a window off a stored bundle', () => {
  it('takes one that is there', () => {
    expect(readWindow({ since: T0, count: 4 })).toEqual({ since: T0, count: 4 });
  });

  it('and treats anything it cannot read as a fresh one', () => {
    // A corrupt field locking somebody out of their own sync is a far worse
    // failure than one unmetered minute.
    for (const bad of [null, undefined, 'nonsense', 42, {}, { since: 'x', count: 1 },
      { since: T0, count: 'x' }, { since: -1, count: 1 }, { since: T0, count: -1 },
      { since: Number.NaN, count: 1 }]) {
      expect(readWindow(bad)).toEqual({ since: 0, count: 0 });
    }
  });

  it('and a fresh window lets the next request through', () => {
    expect(rateCheck(readWindow('nonsense'), T0).allowed).toBe(true);
  });
});

describe('the limit itself', () => {
  it('is far above what a client doing its job asks for', () => {
    // A device pushes after a write and pulls on coming to the front, throttled
    // to once every thirty seconds. A first sync draining five years is bounded
    // by the push size at half a megabyte a request: single figures, not
    // hundreds. This is the line only a loop crosses.
    expect(RATE_LIMIT).toBeGreaterThanOrEqual(100);
    expect(RATE_WINDOW_MS).toBe(60_000);
  });
});
