import { TRACK } from '../config/track.ts';
import { dist, type Dot } from '../core/math.ts';
import type { Crossing } from './validation.ts';

/** Smooth falloff: 1 at r = 0, 0 at r >= radius. */
export const softWeight = (r: number, radius: number): number => (r >= radius ? 0 : 0.5 * (1 + Math.cos((Math.PI * r) / radius)));

/** Distance between two positions along a loop of length `length`. */
export const loopDist = (a: number, b: number, length: number): number => {
  const d = Math.abs(a - b) % length;
  return Math.min(d, length - d);
};

/** Position of each dot along an open path of dots (cumulative distance). */
export function pathPositions(dots: readonly Dot[]): number[] {
  const out = [0];
  for (let i = 1; i < dots.length; i++) out.push(out[i - 1] + dist(dots[i - 1], dots[i]));
  return out;
}

/**
 * Weights for a "soft" edit of dot `i`: neighbours within `radius` metres along
 * the track move too, by a smoothly decreasing share. `closed` loops wrap round.
 */
export function softWeights(pos: readonly number[], i: number, radius: number, length: number, closed: boolean): Float32Array {
  const w = new Float32Array(pos.length);
  for (let j = 0; j < pos.length; j++) {
    const r = closed ? loopDist(pos[i], pos[j], length) : Math.abs(pos[i] - pos[j]);
    w[j] = softWeight(r, radius);
  }
  w[i] = 1;
  return w;
}

/** Rounds to the editor's height step within the allowed range. */
export const clampHeight = (h: number): number => Math.max(0, Math.min(TRACK.maxHeight, Math.round(h / TRACK.heightStep) * TRACK.heightStep));

/** Same dots with these heights (zero heights left out). */
export function withHeights(dots: readonly Dot[], hs: readonly number[]): Dot[] {
  return dots.map((d, i) => {
    const h = clampHeight(hs[i]);
    return h ? { x: d.x, y: d.y, h } : { x: d.x, y: d.y };
  });
}

/**
 * A rolling height profile round the loop: a few smooth periodic waves, scaled
 * to a random peak and kept well inside the steepest allowed grade.
 */
export function rollingHeights(pos: readonly number[], length: number, rand: () => number): number[] {
  const kMax = Math.max(1, Math.min(5, Math.floor(length / 260)));
  const waves: { k: number; a: number; p: number }[] = [];
  const count = 2 + Math.floor(rand() * 3);
  for (let w = 0; w < count; w++) waves.push({ k: 1 + Math.floor(rand() * kMax), a: 0.4 + rand(), p: rand() * Math.PI * 2 });
  const f = (s: number) => waves.reduce((sum, w) => sum + w.a * Math.sin((2 * Math.PI * w.k * s) / length + w.p), 0);
  // Range and steepest slope of the raw profile, measured finely.
  let lo = Infinity;
  let hi = -Infinity;
  let slope = 0;
  const step = 2;
  for (let s = 0; s < length; s += step) {
    const v = f(s);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    slope = Math.max(slope, Math.abs(f(s + step) - v) / step);
  }
  const peak = 6 + rand() * 16;
  let scale = peak / Math.max(1e-6, hi - lo);
  scale = Math.min(scale, (TRACK.maxGrade * 0.55) / Math.max(1e-6, slope));
  return pos.map((s) => (f(s) - lo) * scale);
}

/** Radius of the bump used to level or separate the roads at a crossing (m). */
const CROSSING_REACH = 70;

/**
 * Nudges heights so every crossing is either level or a proper bridge. The
 * crossings carry the heights measured on the built track; nearby dots move by
 * a smooth bump so the climb stays gentle.
 */
export function fitCrossings(hs: number[], pos: readonly number[], length: number, spacing: number, crossings: readonly Crossing[]): number[] {
  const out = hs.slice();
  const bump = (s: number, amount: number) => {
    pos.forEach((p, k) => (out[k] += amount * softWeight(loopDist(p, s, length), CROSSING_REACH)));
  };
  for (const x of crossings) {
    const dh = x.dh; // road j above road i
    const a = Math.abs(dh);
    if (a <= TRACK.levelCrossingTolerance * 0.5 || a >= TRACK.bridgeClearance + 0.25) continue;
    const si = x.i * spacing;
    const sj = x.j * spacing;
    if (a < 3) {
      bump(si, dh / 2);
      bump(sj, -dh / 2);
    } else {
      const need = TRACK.bridgeClearance + 0.75 - a;
      const upper = dh > 0 ? sj : si;
      const lower = dh > 0 ? si : sj;
      const upperH = Math.max(...pos.map((p, k) => (loopDist(p, upper, length) < 30 ? out[k] : -Infinity)));
      if (upperH + need <= TRACK.maxHeight) bump(upper, need);
      else bump(lower, -need);
    }
  }
  return out.map((h) => Math.max(0, h));
}

/** Gentle smoothing of dot heights along the track (each pass averages over about 60 m). */
export function smoothHeights(hs: readonly number[], pos: readonly number[], length: number, closed: boolean, passes = 2): number[] {
  let cur = hs.slice();
  for (let p = 0; p < passes; p++) {
    cur = cur.map((_, i) => {
      let sum = 0;
      let wsum = 0;
      pos.forEach((q, j) => {
        const r = closed ? loopDist(pos[i], q, length) : Math.abs(pos[i] - q);
        const w = softWeight(r, 60);
        sum += cur[j] * w;
        wsum += w;
      });
      return wsum > 0 ? sum / wsum : cur[i];
    });
  }
  return cur;
}
