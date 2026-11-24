/** Small deterministic random numbers for seeded modes. Same seed, same numbers, everywhere. */

/** Mulberry32: a fast 32-bit PRNG. Returns a function giving floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable value in [0, 1) for (seed, key), independent of call order. */
export function hashUnit(seed: number, key: number): number {
  let h = (Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(key >>> 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
