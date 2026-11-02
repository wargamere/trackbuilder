import { TRACK } from '../config/track.ts';
import { dist, polylineLength, wrap, type Vec2 } from '../core/math.ts';
import { buildCenterline, resampleClosed, sampleClosedCatmullRom } from '../track/spline.ts';

export type StrokeResult =
  | { ok: true; control: Vec2[] }
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
 * Turns a raw hand-drawn stroke into a closed loop of smooth control points:
 *  1. find where the stroke comes back to its start and trim any overshoot,
 *  2. resample evenly every `TRACK.controlSpacing` metres,
 *  3. Taubin-smooth away hand jitter (unlike plain averaging, it doesn't shrink the loop).
 * Direction of travel follows the drawing direction; the start line is where the pen went down.
 */
export function strokeToControl(raw: readonly Vec2[]): StrokeResult {
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
  if (closeAt < 0) return { ok: false, issue: 'not-closed', at: pts[pts.length - 1] };

  // Drop tail points that sit on top of the start; the loop closes back to pts[0].
  let end = closeAt;
  while (end > 2 && dist(pts[end], start) < TRACK.controlSpacing * 0.5) end--;
  const loop = pts.slice(0, end + 1);
  if (polylineLength(loop) + dist(loop[loop.length - 1], start) < TRACK.minLength * 0.5) {
    return { ok: false, issue: 'too-short', at: start };
  }

  const { points } = resampleClosed(loop, TRACK.controlSpacing);
  return { ok: true, control: taubin(points, 4) };
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
 * Opens up corners tighter than `TRACK.minRadius` by locally smoothing the control
 * points around them until they are drivable (or until it gives up, in which case
 * validation reports the corner).
 */
export function relaxTightCorners(control: readonly Vec2[], maxIterations = 40): Vec2[] {
  let cur = control.map((p) => ({ x: p.x, y: p.y }));
  const n = cur.length;
  const limit = 1 / TRACK.minRadius;
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
      return { x: p.x + 0.5 * ((a.x + b.x) / 2 - p.x), y: p.y + 0.5 * ((a.y + b.y) / 2 - p.y) };
    });
  }
  return cur;
}

/** Rounds control points to the quantisation grid so tracks rebuild bit-identically. */
export function quantizeControl(control: readonly Vec2[]): Vec2[] {
  const q = TRACK.quantize;
  const out: Vec2[] = [];
  for (const p of control) {
    const r = { x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q };
    if (out.length === 0 || dist(out[out.length - 1], r) > 1e-6) out.push(r);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

/** Re-spaces a hand-authored control loop evenly along its spline (for sample tracks). */
export function evenControl(control: readonly Vec2[]): Vec2[] {
  return resampleClosed(sampleClosedCatmullRom(control, 1), TRACK.controlSpacing).points;
}

/** Final clean-up of a control loop before it becomes a TrackDef. */
export const prepareControl = (control: readonly Vec2[]): Vec2[] => quantizeControl(relaxTightCorners(control));
