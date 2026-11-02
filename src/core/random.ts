/** Small seeded PRNG (mulberry32) so scenery is identical every time a track loads. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a hash of a string, for seeding. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Smooth 2D value noise in [0, 1], from a fixed hash (no state). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * u;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * u;
  return a + (b - a) * v;
}
