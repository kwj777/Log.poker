/**
 * A seeded pseudo-random generator, and the reason there is one at all.
 *
 * Two things here need randomness and neither wants it to be random between
 * runs. The demo seeder builds the same dataset every time, so screenshots stay
 * stable and a test can assert on the result. The tournament bootstrap resamples
 * a player's own results to put an interval around their ROI, and that number
 * has to be the same every time the screen renders: a confidence interval that
 * shifts when you switch tabs and back is not one anybody should believe, even
 * when every version of it is technically correct.
 *
 * So both draw from here, seeded, rather than from `Math.random`.
 */

export interface Random {
  (): number;
}

/**
 * mulberry32: small, fast, and identical across every JS engine we ship to,
 * which is the property that matters. A generator that produced a different
 * stream on Hermes than on V8 would give the same player a different interval
 * on their phone than on the web.
 */
export const makeRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
