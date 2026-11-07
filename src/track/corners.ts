import type { Centerline } from './spline.ts';

/** A run of the centre line that bends harder than some radius. */
export interface Corner {
  /** First centre-line index of the run. */
  start: number;
  /** Number of samples in the run (it may wrap past the end of the loop). */
  count: number;
  /** +1 right-hander, -1 left-hander. */
  sign: 1 | -1;
  /** Total turning angle in radians (always positive). */
  turn: number;
  /** Index of the tightest point. */
  apex: number;
}

/**
 * Finds every run of road tighter than `radius` that turns at least `minTurn`.
 * Used for track statistics and placing kerbs on the outside of corners.
 */
export function findCorners(c: Centerline, radius: number, minTurn: number): Corner[] {
  const n = c.points.length;
  const limit = 1 / radius;
  const sign = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const k = c.curvature[i];
    sign[i] = k > limit ? 1 : k < -limit ? -1 : 0;
  }
  // Start scanning just after a straight-ish sample so no run is split by the wrap.
  let origin = sign.indexOf(0);
  if (origin < 0) origin = 0;

  const runs: { start: number; count: number; sign: 1 | -1 }[] = [];
  const maxGap = 3; // short wobbles inside one corner don't split it
  let i = 0;
  while (i < n) {
    const idx = (origin + i) % n;
    const s = sign[idx];
    if (s === 0) {
      i++;
      continue;
    }
    let count = 0;
    let gap = 0;
    while (i + count + gap < n) {
      const s2 = sign[(origin + i + count + gap) % n];
      if (s2 === s) {
        count += gap + 1;
        gap = 0;
      } else if (s2 === 0 && gap < maxGap) {
        gap++;
      } else break;
    }
    runs.push({ start: idx, count, sign: s as 1 | -1 });
    i += count + gap;
  }

  const corners: Corner[] = [];
  for (const r of runs) {
    let turn = 0;
    let apex = r.start;
    let best = 0;
    for (let j = 0; j < r.count; j++) {
      const idx = (r.start + j) % n;
      const k = Math.abs(c.curvature[idx]);
      turn += k * c.spacing;
      if (k > best) {
        best = k;
        apex = idx;
      }
    }
    if (turn >= minTurn) corners.push({ start: r.start, count: r.count, sign: r.sign, turn, apex });
  }
  return corners;
}
