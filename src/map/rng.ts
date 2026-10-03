/** Tiny seeded PRNG helpers. No dependencies. */
export type Rng = () => number; // uniform in [0, 1)

/** Serializable mulberry32 state: the whole generator is this one 32-bit number. Plain JSON, safe to store. */
export interface RngState { s: number }

export const rngState = (seed: number): RngState => ({ s: seed >>> 0 });

/** Pure mulberry32 step: the next value in [0, 1) and the advanced state. Never mutates `r`. */
export function nextRandom(r: RngState): [number, RngState] {
  const a = (r.s + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, { s: a }];
}

/** mulberry32: 32-bit state, fast, good enough for game maps. Same sequence as `nextRandom`, as a closure. */
export function mulberry32(seed: number): Rng {
  let r = rngState(seed);
  return () => {
    const [v, next] = nextRandom(r);
    r = next;
    return v;
  };
}

/** FNV-1a string hash to an unsigned 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
