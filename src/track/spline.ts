import { TRACK } from '../config/track.ts';
import { cross, dist, dot, normalize, sub, wrap, type Vec2 } from '../core/math.ts';

/**
 * The evenly sampled centre line of a closed track. Index 0 is the start/finish
 * line and the race runs towards increasing indices. Physics, lap timing,
 * checkpoints, kerbs and the ghost all work off this.
 */
export interface Centerline {
  /** Evenly spaced points around the loop (the last one does NOT repeat the first). */
  points: Vec2[];
  /** Unit direction of travel at each point. */
  tangents: Vec2[];
  /** Signed curvature in 1/m. Positive = right-hand turn for the driver. */
  curvature: Float32Array;
  /** Distance from the start line to each point. */
  dist: Float32Array;
  length: number;
  spacing: number;
}

/** Left-hand side normal for a direction of travel (x east, y south). */
export const leftOf = (t: Vec2): Vec2 => ({ x: t.y, y: -t.x });

/**
 * Samples a closed centripetal Catmull-Rom spline through `ctrl` densely
 * (about every `step` metres). Centripetal parametrisation never forms cusps or
 * self-loops inside a segment, which uniform Catmull-Rom can.
 */
export function sampleClosedCatmullRom(ctrl: readonly Vec2[], step = 1): Vec2[] {
  const n = ctrl.length;
  const out: Vec2[] = [];
  const knot = (a: Vec2, b: Vec2) => Math.max(1e-4, Math.sqrt(dist(a, b)));
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[wrap(i - 1, n)];
    const p1 = ctrl[i];
    const p2 = ctrl[wrap(i + 1, n)];
    const p3 = ctrl[wrap(i + 2, n)];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const steps = Math.max(4, Math.ceil(dist(p1, p2) / step));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const a1x = ((t1 - t) * p0.x + (t - t0) * p1.x) / (t1 - t0);
      const a1y = ((t1 - t) * p0.y + (t - t0) * p1.y) / (t1 - t0);
      const a2x = ((t2 - t) * p1.x + (t - t1) * p2.x) / (t2 - t1);
      const a2y = ((t2 - t) * p1.y + (t - t1) * p2.y) / (t2 - t1);
      const a3x = ((t3 - t) * p2.x + (t - t2) * p3.x) / (t3 - t2);
      const a3y = ((t3 - t) * p2.y + (t - t2) * p3.y) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);
      out.push({
        x: ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1),
        y: ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1),
      });
    }
  }
  return out;
}

/** Re-samples a closed polyline to `n` points spaced exactly evenly along its length. */
export function resampleClosed(pts: readonly Vec2[], spacing: number): { points: Vec2[]; length: number } {
  const m = pts.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) cum[i + 1] = cum[i] + dist(pts[i], pts[(i + 1) % m]);
  const length = cum[m];
  const n = Math.max(8, Math.round(length / spacing));
  const step = length / n;
  const points: Vec2[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < m - 1 && cum[seg + 1] < target) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % m];
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 1e-9 ? (target - cum[seg]) / segLen : 0;
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return { points, length };
}

/** Builds the evenly sampled centre line through a closed loop of control points. */
export function buildCenterline(ctrl: readonly Vec2[], spacing: number = TRACK.centerSpacing): Centerline {
  const dense = sampleClosedCatmullRom(ctrl, 1);
  const { points, length } = resampleClosed(dense, spacing);
  const n = points.length;
  const realSpacing = length / n;
  const tangents: Vec2[] = new Array(n);
  const curvature = new Float32Array(n);
  const distArr = new Float32Array(n);
  const k = 2; // curvature window, in samples on each side
  for (let i = 0; i < n; i++) {
    const prev = points[wrap(i - 1, n)];
    const next = points[wrap(i + 1, n)];
    tangents[i] = normalize(sub(next, prev));
    const a = sub(points[i], points[wrap(i - k, n)]);
    const b = sub(points[wrap(i + k, n)], points[i]);
    curvature[i] = Math.atan2(cross(a, b), dot(a, b)) / (k * realSpacing);
    distArr[i] = i * realSpacing;
  }
  return { points, tangents, curvature, dist: distArr, length, spacing: realSpacing };
}

/** Position and direction at distance `s` along the loop (wraps; linearly interpolated). */
export function sampleAt(c: Centerline, s: number): { p: Vec2; t: Vec2 } {
  const n = c.points.length;
  const u = (((s % c.length) + c.length) % c.length) / c.spacing;
  const i = Math.floor(u) % n;
  const j = (i + 1) % n;
  const f = u - Math.floor(u);
  const a = c.points[i];
  const b = c.points[j];
  const ta = c.tangents[i];
  const tb = c.tangents[j];
  return {
    p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
    t: normalize({ x: ta.x + (tb.x - ta.x) * f, y: ta.y + (tb.y - ta.y) * f }),
  };
}

/** Smooth preview of an open chain of dots (ends padded by reflection). */
export function sampleOpenCatmullRom(dots: readonly Vec2[], step = 2): Vec2[] {
  if (dots.length < 3) return dots.map((p) => ({ ...p }));
  const a = dots[0];
  const b = dots[dots.length - 1];
  const padStart = { x: 2 * a.x - dots[1].x, y: 2 * a.y - dots[1].y };
  const padEnd = { x: 2 * b.x - dots[dots.length - 2].x, y: 2 * b.y - dots[dots.length - 2].y };
  // Sample the padded chain as a loop and drop the segments that wrap around.
  const ring = [padStart, ...dots, padEnd];
  const all = sampleClosedCatmullRom(ring, step);
  const out: Vec2[] = [];
  let k = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    // Same step count as sampleClosedCatmullRom uses for this segment.
    const steps = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    if (i >= 1 && i < ring.length - 2) for (let s = 0; s < steps; s++) out.push(all[k + s]);
    k += steps;
  }
  out.push({ ...b });
  return out;
}
