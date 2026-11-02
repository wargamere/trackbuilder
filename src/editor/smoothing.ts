import { DOTS, SMOOTHING, TRACK, type SmoothingLevel } from '../config/track.ts';
import { dist, polylineLength, wrap, type Dot, type Vec2 } from '../core/math.ts';
import { buildCenterline, resampleClosed, sampleClosedCatmullRom } from '../track/spline.ts';

export type StrokeResult =
  | { ok: true; control: Vec2[]; autoClosed?: boolean }
  | { ok: false; issue: 'too-short' | 'not-closed'; at?: Vec2 };

/** Drops points closer than `minStep` to the previously kept point. */
export function dedupe(raw: readonly Vec2[], minStep: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of raw) {
    if (out.length === 0 || dist(out[out.length - 1], p) >= minStep) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Turns a raw hand-drawn stroke into a closed loop of smooth, dense points:
 *  1. find where the stroke comes back to its start and trim any overshoot,
 *  2. resample evenly every `TRACK.controlSpacing` metres,
 *  3. Taubin-smooth away hand jitter (unlike plain averaging, it doesn't shrink the loop).
 * Direction of travel follows the drawing direction; the start line is where the pen went down.
 */
export function strokeToControl(raw: readonly Vec2[], level: SmoothingLevel = 'normal'): StrokeResult {
  const pts = dedupe(raw, 1);
  const total = polylineLength(pts);
  if (pts.length < 3 || total < TRACK.minLength * 0.5) return { ok: false, issue: 'too-short', at: pts[0] };

  // Walk back from the end to the most recent visit near the start point. Allow
  // an overshoot past the start of up to 25% of the stroke (or 150 m).
  const start = pts[0];
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i]);
  const maxOvershoot = Math.min(150, total * 0.25);
  let closeAt = -1;
  let best = Infinity;
  for (let i = pts.length - 1; i > 0 && cum[i] > total * 0.5; i--) {
    const d = dist(pts[i], start);
    if (d <= TRACK.closeRadius) {
      if (d < best) {
        best = d;
        closeAt = i;
      }
    } else if (closeAt >= 0) {
      break; // left the start area again, going backwards: this visit is the one
    }
    if (closeAt < 0 && total - cum[i] > maxOvershoot) break;
  }
  let autoClosed = false;
  if (closeAt < 0) {
    // Didn't come back to the start: close the gap ourselves unless it's huge.
    if (dist(pts[pts.length - 1], start) > total * 0.35) return { ok: false, issue: 'not-closed', at: pts[pts.length - 1] };
    closeAt = pts.length - 1;
    autoClosed = true;
  }

  // Drop tail points that sit on top of the start; the loop closes back to pts[0].
  let end = closeAt;
  while (end > 2 && dist(pts[end], start) < TRACK.controlSpacing * 0.5) end--;
  const loop = pts.slice(0, end + 1);
  if (polylineLength(loop) + dist(loop[loop.length - 1], start) < TRACK.minLength * 0.5) {
    return { ok: false, issue: 'too-short', at: start };
  }

  const { points } = resampleClosed(loop, TRACK.controlSpacing);
  return { ok: true, control: taubin(points, SMOOTHING[level].jitter), autoClosed };
}

/** Taubin λ|μ smoothing on a closed polygon: removes noise with almost no shrinkage. */
export function taubin(pts: readonly Vec2[], iterations: number, lambda = 0.5, mu = -0.53): Vec2[] {
  let cur = pts.map((p) => ({ x: p.x, y: p.y }));
  const n = cur.length;
  const pass = (src: Vec2[], f: number): Vec2[] =>
    src.map((p, i) => {
      const a = src[wrap(i - 1, n)];
      const b = src[wrap(i + 1, n)];
      return { x: p.x + f * ((a.x + b.x) / 2 - p.x), y: p.y + f * ((a.y + b.y) / 2 - p.y) };
    });
  for (let k = 0; k < iterations; k++) cur = pass(pass(cur, lambda), mu);
  return cur;
}

/**
 * Opens up corners tighter than `radius` by locally smoothing the dense points
 * around them (or until it gives up, in which case validation reports the corner).
 */
export function relaxTightCorners(control: readonly Dot[], radius: number, maxIterations = 60): Dot[] {
  let cur = control.map((p) => ({ ...p }));
  const n = cur.length;
  const limit = 1 / radius;
  for (let iter = 0; iter < maxIterations; iter++) {
    const c = buildCenterline(cur);
    const marked = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < c.points.length; i++) {
      if (Math.abs(c.curvature[i]) <= limit) continue;
      any = true;
      // Mark the nearest control point and its neighbours.
      let bestJ = 0;
      let bestD = Infinity;
      for (let j = 0; j < n; j++) {
        const d = dist(cur[j], c.points[i]);
        if (d < bestD) {
          bestD = d;
          bestJ = j;
        }
      }
      for (let o = -2; o <= 2; o++) marked[wrap(bestJ + o, n)] = 1;
    }
    if (!any) break;
    cur = cur.map((p, j) => {
      if (!marked[j]) return p;
      const a = cur[wrap(j - 1, n)];
      const b = cur[wrap(j + 1, n)];
      return { ...p, x: p.x + 0.5 * ((a.x + b.x) / 2 - p.x), y: p.y + 0.5 * ((a.y + b.y) / 2 - p.y) };
    });
  }
  return cur;
}

/** Rounds a height to the allowed range and step. */
export const quantizeHeight = (h: number): number =>
  Math.max(0, Math.min(TRACK.maxHeight, Math.round(h / TRACK.heightStep) * TRACK.heightStep));

/** Rounds dots to the quantisation grid so tracks rebuild bit-identically (zero heights are left out). */
export function quantizeControl(control: readonly Dot[]): Dot[] {
  const q = TRACK.quantize;
  const out: Dot[] = [];
  for (const p of control) {
    const h = quantizeHeight(p.h ?? 0);
    const r: Dot = h ? { x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q, h } : { x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q };
    if (out.length === 0 || dist(out[out.length - 1], r) > 1e-6) out.push(r);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

/**
 * Douglas-Peucker on a closed loop: keeps the fewest points that stay within
 * `tolerance` of the original, so corners keep several dots and straights few.
 * Long gaps get extra dots (at most `maxSpacing` apart along the loop) so every
 * stretch stays easy to grab and edit. Point 0 (the start) is always kept.
 */
export function simplifyLoop(pts: readonly Dot[], tolerance: number = DOTS.tolerance, maxSpacing: number = DOTS.maxSpacing): Dot[] {
  const n = pts.length;
  if (n < 4) return pts.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  let far = 0;
  for (let i = 1; i < n; i++) if (dist(pts[i], pts[0]) > dist(pts[far], pts[0])) far = i;
  keep[far] = 1;
  const at = (i: number) => pts[i % n];
  const dp = (a: number, b: number) => {
    let best = -1;
    let bestD = tolerance;
    const p = at(a);
    const q = at(b);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const r = at(i);
      const d = Math.abs((r.x - p.x) * dy - (r.y - p.y) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best % n] = 1;
      dp(a, best);
      dp(best, b);
    }
  };
  dp(0, far);
  dp(far, n);
  // Cap the spacing between kept points.
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  const out: Dot[] = [];
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k];
    const b = k + 1 < idx.length ? idx[k + 1] : idx[0] + n;
    let arc = 0;
    for (let i = a; i < b; i++) arc += dist(at(i), at(i + 1));
    const extra = Math.max(0, Math.ceil(arc / maxSpacing) - 1);
    out.push({ ...at(a) });
    for (let e = 1; e <= extra; e++) out.push({ ...at(a + Math.round(((b - a) * e) / (extra + 1))) });
  }
  return out;
}

/** Re-spaces a hand-authored control loop evenly along its spline. */
export function evenControl(control: readonly Dot[]): Dot[] {
  return resampleClosed(sampleClosedCatmullRom(control, 1), TRACK.controlSpacing).points;
}

/** Dense smoothed loop -> drivable, editable, quantised dots. */
export const denseToDots = (dense: readonly Dot[], level: SmoothingLevel = 'normal'): Dot[] =>
  quantizeControl(simplifyLoop(relaxTightCorners(dense, SMOOTHING[level].radius)));

/** Snaps a dot to the quantisation grid (and optionally the coarse editing grid). */
export function snapDot(p: Dot, grid = 0): Dot {
  const q = grid > 0 ? grid : TRACK.quantize;
  const r: Dot = { x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q };
  if (p.h) r.h = quantizeHeight(p.h);
  return r;
}

/** Same loop and start line, driven the other way round. */
export function reverseDots(dots: readonly Dot[]): Dot[] {
  return [dots[0], ...dots.slice(1).reverse()].map((p) => ({ ...p }));
}

/** Moves the start line to dot `k`. */
export function rotateDots(dots: readonly Dot[], k: number): Dot[] {
  const n = dots.length;
  const i = ((k % n) + n) % n;
  return [...dots.slice(i), ...dots.slice(0, i)].map((p) => ({ ...p }));
}
