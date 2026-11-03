import { TRACK } from '../config/track.ts';
import { cross, dist, dot, normalize, sub, wrap, type Dot, type Vec2 } from '../core/math.ts';

/**
 * The evenly sampled centre line of a closed track. Index 0 is the start/finish
 * line and the race runs towards increasing indices. Physics, lap timing,
 * checkpoints, kerbs, walls and the ghost all work off this.
 */
export interface Centerline {
  /** Evenly spaced points around the loop (the last one does NOT repeat the first). */
  points: Vec2[];
  /** Unit direction of travel at each point. */
  tangents: Vec2[];
  /** Signed curvature in 1/m. Positive = right-hand turn for the driver. */
  curvature: Float32Array;
  /** Road height (m) at each point. */
  height: Float32Array;
  /** Slope along the direction of travel (dh/ds); 0.1 = 10 % uphill. Never steeper than TRACK.maxGrade. */
  grade: Float32Array;
  /** Largest change (m) made to the dots' heights to keep slopes drivable (0 = none). */
  eased: number;
  /** Banking angle (rad). Positive raises the left side, i.e. leans into a right-hander. */
  bank: Float32Array;
  /** Distance from the start line to each point. */
  dist: Float32Array;
  length: number;
  spacing: number;
  /** Road width (m), and how far from the centre the barriers stand. */
  width: number;
  wallOffset: number;
}

/** Left-hand side normal for a direction of travel (x east, y south). */
export const leftOf = (t: Vec2): Vec2 => ({ x: t.y, y: -t.x });

/** Height of the road surface at sample `i`, `lateral` metres left (+) or right (-) of the centre. */
export const surfaceY = (c: Centerline, i: number, lateral: number): number => c.height[i] + lateral * Math.tan(c.bank[i]);

/**
 * Samples a closed centripetal Catmull-Rom spline through `ctrl` densely
 * (about every `step` metres). Centripetal parametrisation never forms cusps or
 * self-loops inside a segment, which uniform Catmull-Rom can. Heights are
 * interpolated with the same weights (the parametrisation uses the ground
 * distance only, so a track's outline doesn't depend on its heights).
 */
export function sampleClosedCatmullRom(ctrl: readonly Dot[], step = 1): Dot[] {
  const n = ctrl.length;
  const out: Dot[] = [];
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
    const h0 = p0.h ?? 0;
    const h1 = p1.h ?? 0;
    const h2 = p2.h ?? 0;
    const h3 = p3.h ?? 0;
    const steps = Math.max(4, Math.ceil(dist(p1, p2) / step));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      // Barry-Goldman pyramid, written out for x, y and h.
      const w = (ta: number, tb: number) => [(tb - t) / (tb - ta), (t - ta) / (tb - ta)];
      const [a1a, a1b] = w(t0, t1);
      const [a2a, a2b] = w(t1, t2);
      const [a3a, a3b] = w(t2, t3);
      const [b1a, b1b] = w(t0, t2);
      const [b2a, b2b] = w(t1, t3);
      const [ca, cb] = w(t1, t2);
      const lerp3 = (v0: number, v1: number, v2: number, v3: number) => {
        const a1 = a1a * v0 + a1b * v1;
        const a2 = a2a * v1 + a2b * v2;
        const a3 = a3a * v2 + a3b * v3;
        const b1 = b1a * a1 + b1b * a2;
        const b2 = b2a * a2 + b2b * a3;
        return ca * b1 + cb * b2;
      };
      out.push({
        x: lerp3(p0.x, p1.x, p2.x, p3.x),
        y: lerp3(p0.y, p1.y, p2.y, p3.y),
        h: lerp3(h0, h1, h2, h3),
      });
    }
  }
  return out;
}

/** Re-samples a closed polyline to points spaced exactly evenly along its length (heights carried along). */
export function resampleClosed(pts: readonly Dot[], spacing: number): { points: Dot[]; length: number } {
  const m = pts.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) cum[i + 1] = cum[i] + dist(pts[i], pts[(i + 1) % m]);
  const length = cum[m];
  const n = Math.max(8, Math.round(length / spacing));
  const step = length / n;
  const points: Dot[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (seg < m - 1 && cum[seg + 1] < target) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % m];
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 1e-9 ? (target - cum[seg]) / segLen : 0;
    const ha = a.h ?? 0;
    const hb = b.h ?? 0;
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: ha + (hb - ha) * t });
  }
  return { points, length };
}

/** Moving average over ±r samples on a closed loop. */
function smoothLoop(src: Float32Array, r: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += src[wrap(k, n)];
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * r + 1);
    sum += src[wrap(i + r + 1, n)] - src[wrap(i - r, n)];
  }
  return out;
}

/**
 * Limits the slope of a closed height profile to `maxStep` metres per sample,
 * changing it as little as possible: the average of the profile with its peaks
 * cut down and with its valleys filled in (both are exactly slope-limited, so
 * their average is too). Where the profile is already gentle it is unchanged.
 */
export function limitSlope(h: Float32Array, maxStep: number): Float32Array {
  const n = h.length;
  const lo = Float32Array.from(h); // peaks cut
  const hi = Float32Array.from(h); // valleys filled
  // Two laps each way are enough for any limit to travel all the way round.
  for (let lap = 0; lap < 2; lap++) {
    for (let k = 0; k < n; k++) {
      const i = k;
      const p = wrap(k - 1, n);
      lo[i] = Math.min(lo[i], lo[p] + maxStep);
      hi[i] = Math.max(hi[i], hi[p] - maxStep);
    }
    for (let k = n - 1; k >= 0; k--) {
      const i = k;
      const q = wrap(k + 1, n);
      lo[i] = Math.min(lo[i], lo[q] + maxStep);
      hi[i] = Math.max(hi[i], hi[q] - maxStep);
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (lo[i] + hi[i]) / 2;
  return out;
}

/** Banking levels: maximum bank angle (reached at radius ≤ TRACK.bankRadius). */
export const BANK_LEVELS = [0, (7 * Math.PI) / 180, (15 * Math.PI) / 180] as const;

/** Barrier distance from the centre line for a road `width` wide. */
export const wallOffsetFor = (width: number): number => width / 2 + TRACK.kerbWidth + TRACK.wallGap;

/** Builds the evenly sampled centre line through a closed loop of dots. `banking` is 0 (off), 1 or 2. */
export function buildCenterline(ctrl: readonly Dot[], banking = 0, spacing: number = TRACK.centerSpacing, width: number = TRACK.roadWidth): Centerline {
  const dense = sampleClosedCatmullRom(ctrl, 1);
  const { points: pts, length } = resampleClosed(dense, spacing);
  const n = pts.length;
  const realSpacing = length / n;
  const points: Vec2[] = new Array(n);
  const tangents: Vec2[] = new Array(n);
  const curvature = new Float32Array(n);
  const raw = new Float32Array(n);
  const grade = new Float32Array(n);
  const distArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = { x: pts[i].x, y: pts[i].y };
    raw[i] = Math.max(0, pts[i].h ?? 0);
  }
  // Climbs steeper than the limit are eased out (a little lower at the top, a
  // little higher at the bottom) instead of making the track unusable.
  const height = limitSlope(raw, TRACK.maxGrade * realSpacing * 0.999);
  let eased = 0;
  for (let i = 0; i < n; i++) eased = Math.max(eased, Math.abs(height[i] - raw[i]));
  const k = 2; // curvature window, in samples on each side
  for (let i = 0; i < n; i++) {
    const prev = points[wrap(i - 1, n)];
    const next = points[wrap(i + 1, n)];
    tangents[i] = normalize(sub(next, prev));
    const a = sub(points[i], points[wrap(i - k, n)]);
    const b = sub(points[wrap(i + k, n)], points[i]);
    curvature[i] = Math.atan2(cross(a, b), dot(a, b)) / (k * realSpacing);
    grade[i] = (height[wrap(i + 1, n)] - height[wrap(i - 1, n)]) / (2 * realSpacing);
    distArr[i] = i * realSpacing;
  }
  // Banking: leans into corners in proportion to curvature, smoothed so it rolls in and out.
  const maxBank = BANK_LEVELS[Math.max(0, Math.min(2, banking))];
  const rawBank = new Float32Array(n);
  if (maxBank > 0) {
    for (let i = 0; i < n; i++) rawBank[i] = Math.sign(curvature[i]) * maxBank * Math.min(1, Math.abs(curvature[i]) * TRACK.bankRadius);
  }
  const r = Math.max(1, Math.round(12 / realSpacing));
  const bank = maxBank > 0 ? smoothLoop(smoothLoop(rawBank, r), r) : rawBank;
  return { points, tangents, curvature, height, grade, eased, bank, dist: distArr, length, spacing: realSpacing, width, wallOffset: wallOffsetFor(width) };
}

/** Position and direction at distance `s` along the loop (wraps; linearly interpolated). */
export function sampleAt(c: Centerline, s: number): { p: Vec2; t: Vec2; h: number } {
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
    h: c.height[i] + (c.height[j] - c.height[i]) * f,
  };
}

/** Smooth preview of an open chain of dots (ends padded by reflection). */
export function sampleOpenCatmullRom(dots: readonly Dot[], step = 2): Dot[] {
  if (dots.length < 3) return dots.map((p) => ({ ...p }));
  const a = dots[0];
  const b = dots[dots.length - 1];
  const padStart = { x: 2 * a.x - dots[1].x, y: 2 * a.y - dots[1].y, h: a.h };
  const padEnd = { x: 2 * b.x - dots[dots.length - 2].x, y: 2 * b.y - dots[dots.length - 2].y, h: b.h };
  // Sample the padded chain as a loop and drop the segments that wrap around.
  const ring = [padStart, ...dots, padEnd];
  const all = sampleClosedCatmullRom(ring, step);
  const out: Dot[] = [];
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

/**
 * Half-widths of the road on each side. On the inside of a hairpin tighter than
 * half the road width the inner edge would fold back on itself, so it is pulled
 * in to just inside the corner's radius (the road narrows slightly there).
 */
export function edgeOffsets(c: Centerline): { left: Float32Array; right: Float32Array } {
  const n = c.points.length;
  const hw = c.width / 2;
  const left = new Float32Array(n).fill(hw);
  const right = new Float32Array(n).fill(hw);
  const win = 3;
  for (let i = 0; i < n; i++) {
    let kMax = 0; // tightest signed curvature nearby
    for (let o = -win; o <= win; o++) {
      const k = c.curvature[wrap(i + o, n)];
      if (Math.abs(k) > Math.abs(kMax)) kMax = k;
    }
    const limit = 0.9 / Math.max(Math.abs(kMax), 1e-6);
    if (limit >= hw) continue;
    // Positive curvature = right-hander: the inside is the right edge.
    if (kMax > 0) right[i] = Math.max(0.5, limit);
    else left[i] = Math.max(0.5, limit);
  }
  return { left, right };
}
