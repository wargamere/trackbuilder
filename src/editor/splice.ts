import { DOTS, SMOOTHING, TRACK, type SmoothingLevel } from '../config/track.ts';
import { dist, polylineLength, wrap, type Dot, type Vec2 } from '../core/math.ts';
import { resampleClosed, type Centerline } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { dedupe, quantizeControl, relaxTightCorners } from './smoothing.ts';

/** Nearest centre-line sample to `p` and how far away it is. */
export function nearestSample(c: Centerline, p: Vec2): { index: number; d: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < c.points.length; i++) {
    const q = c.points[i];
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, d: Math.sqrt(bestD) };
}

/** Evenly re-spaces an open polyline (both ends kept). */
export function resampleOpen(pts: readonly Vec2[], step: number): Vec2[] {
  const total = polylineLength(pts);
  const n = Math.max(1, Math.round(total / step));
  const out: Vec2[] = [{ x: pts[0].x, y: pts[0].y }];
  let seg = 0;
  let segStart = 0;
  for (let k = 1; k < n; k++) {
    const target = (k * total) / n;
    while (seg < pts.length - 2 && segStart + dist(pts[seg], pts[seg + 1]) < target) {
      segStart += dist(pts[seg], pts[seg + 1]);
      seg++;
    }
    const a = pts[seg];
    const b = pts[seg + 1];
    const l = dist(a, b) || 1;
    const t = Math.min(1, (target - segStart) / l);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out;
}

/** Taubin smoothing of an open polyline whose two ends stay put. */
export function taubinOpen(pts: readonly Vec2[], iterations: number, lambda = 0.5, mu = -0.53): Vec2[] {
  let cur = pts.map((p) => ({ x: p.x, y: p.y }));
  const pass = (src: Vec2[], f: number): Vec2[] =>
    src.map((p, i) => {
      if (i === 0 || i === src.length - 1) return p;
      const a = src[i - 1];
      const b = src[i + 1];
      return { x: p.x + f * ((a.x + b.x) / 2 - p.x), y: p.y + f * ((a.y + b.y) / 2 - p.y) };
    });
  for (let k = 0; k < iterations; k++) cur = pass(pass(cur, lambda), mu);
  return cur;
}

/** Douglas-Peucker on an open polyline, keeping both ends; long gaps get extra points. */
export function simplifyOpen(pts: readonly Dot[], tolerance: number = DOTS.tolerance, maxSpacing: number = DOTS.maxSpacing): Dot[] {
  const n = pts.length;
  if (n <= 2) return pts.map((p) => ({ ...p }));
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const dp = (a: number, b: number) => {
    let best = -1;
    let bestD = tolerance;
    const p = pts[a];
    const q = pts[b];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const r = pts[i];
      const d = Math.abs((r.x - p.x) * dy - (r.y - p.y) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      dp(a, best);
      dp(best, b);
    }
  };
  dp(0, n - 1);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  const out: Dot[] = [];
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k];
    out.push({ ...pts[a] });
    if (k + 1 === idx.length) break;
    const b = idx[k + 1];
    let arc = 0;
    for (let i = a; i < b; i++) arc += dist(pts[i], pts[i + 1]);
    const extra = Math.max(0, Math.ceil(arc / maxSpacing) - 1);
    for (let e = 1; e <= extra; e++) out.push({ ...pts[a + Math.round(((b - a) * e) / (extra + 1))] });
  }
  return out;
}

/** Margin of old road either side of a redrawn section that is reshaped to blend in (m). */
const BLEND_MARGIN = 15;
/** Length over which the ends of the new line are eased onto the road's centre (m). */
const END_EASE = 20;

export interface SectionPlan {
  /** Driving-direction start and end samples of the replaced stretch. */
  from: number;
  to: number;
  /** True if the stroke was drawn against the direction of travel. */
  reversed: boolean;
}

/**
 * Which stretch a stroke from the road back to the road replaces. Drawing with
 * the direction of travel replaces the road from the start of the stroke
 * forwards to its end; drawing against it replaces the stretch behind.
 */
export function planSection(c: Centerline, stroke: readonly Vec2[]): SectionPlan | null {
  if (stroke.length < 2) return null;
  const a = nearestSample(c, stroke[0]).index;
  const b = nearestSample(c, stroke[stroke.length - 1]).index;
  let k = 1;
  while (k < stroke.length - 1 && dist(stroke[0], stroke[k]) < 12) k++;
  const ta = c.tangents[a];
  const forward = (stroke[k].x - stroke[0].x) * ta.x + (stroke[k].y - stroke[0].y) * ta.y >= 0;
  return forward ? { from: a, to: b, reversed: false } : { from: b, to: a, reversed: true };
}

export type SpliceResult = { ok: true; dots: Dot[] } | { ok: false; whole: boolean };

/**
 * Replaces a stretch of a closed track with a freehand stroke that starts and
 * ends on the road. The dots outside the stretch stay exactly where they were;
 * the new stretch gets dots of its own and heights eased between its two ends.
 * `whole` is set when the stroke would replace (nearly) the whole track.
 */
export function spliceSection(
  track: Track,
  dots: readonly Dot[],
  dotSamples: readonly number[],
  rawStroke: readonly Vec2[],
  level: SmoothingLevel = 'normal',
): SpliceResult {
  const c = track.center;
  const n = c.points.length;
  const sp = c.spacing;
  const raw = dedupe(rawStroke, 1);
  if (raw.length < 3 || polylineLength(raw) < 15) return { ok: false, whole: false };
  const plan = planSection(c, raw);
  if (!plan) return { ok: false, whole: false };
  const stroke = plan.reversed ? [...raw].reverse() : raw;
  const A = plan.from;
  const B = plan.to;
  const M = Math.round(BLEND_MARGIN / sp);
  const A0 = wrap(A - M, n);
  const B1 = wrap(B + M, n);
  const replaced = wrap(B1 - A0, n);
  const keptCount = n - replaced;
  if (keptCount * sp < 40 || replaced === 0) return { ok: false, whole: true };

  // The new line: evenly spaced, de-jittered, and eased onto the road at both ends.
  let s = resampleOpen(stroke, TRACK.controlSpacing);
  s = taubinOpen(s, SMOOTHING[level].jitter);
  const ease = (pts: Vec2[], target: Vec2) => {
    const ox = target.x - pts[0].x;
    const oy = target.y - pts[0].y;
    let d = 0;
    for (let i = 0; i < pts.length && d < END_EASE; i++) {
      if (i > 0) d += dist(pts[i - 1], pts[i]);
      const w = 0.5 * (1 + Math.cos((Math.PI * Math.min(d, END_EASE)) / END_EASE));
      pts[i] = { x: pts[i].x + ox * w, y: pts[i].y + oy * w };
    }
  };
  ease(s, c.points[A]);
  s.reverse();
  ease(s, c.points[B]);
  s.reverse();
  const sLen = polylineLength(s);
  const hA = c.height[A];
  const hB = c.height[B];

  // Dense loop: blend margin before, the new line, blend margin after, then the kept road.
  const at = (i: number): Dot => ({ x: c.points[i].x, y: c.points[i].y, h: c.height[i] });
  const D: Dot[] = [];
  for (let k = 0; k < M; k++) D.push(at(wrap(A0 + k, n)));
  let acc = 0;
  s.forEach((p, i) => {
    if (i > 0) acc += dist(s[i - 1], p);
    const t = sLen > 0 ? acc / sLen : 0;
    D.push({ x: p.x, y: p.y, h: hA + (hB - hA) * t });
  });
  for (let k = 1; k <= M; k++) D.push(at(wrap(B + k, n)));
  const newLen = polylineLength(D);
  for (let k = 1; k < keptCount; k++) D.push(at(wrap(B1 + k, n)));

  const { points, length } = resampleClosed(D, TRACK.controlSpacing);
  const step = length / points.length;
  const relaxed = relaxTightCorners(points, SMOOTHING[level].radius);
  const kEnd = Math.min(relaxed.length - 1, Math.round(newLen / step));
  const fresh = simplifyOpen(relaxed.slice(0, kEnd + 1));

  // Old dots on the kept stretch, in driving order, clear of the joins.
  const pad = Math.ceil(8 / sp);
  const kept = dots
    .map((d, j) => ({ d, off: wrap(dotSamples[j] - B1, n), j }))
    .filter((k) => k.off > pad && k.off < keptCount - pad)
    .sort((x, y) => x.off - y.off);
  let loop: Dot[] = [...fresh, ...kept.map((k) => ({ ...k.d }))];
  // Keep the start line where it was if its dot survived; otherwise the nearest dot takes over.
  const startKept = kept.findIndex((k) => k.j === 0);
  let first = startKept >= 0 ? fresh.length + startKept : 0;
  if (startKept < 0) {
    let bestD = Infinity;
    loop.forEach((p, i) => {
      const d = dist(p, c.points[0]);
      if (d < bestD) {
        bestD = d;
        first = i;
      }
    });
  }
  loop = [...loop.slice(first), ...loop.slice(0, first)];
  const q = quantizeControl(loop);
  return q.length >= 3 ? { ok: true, dots: q } : { ok: false, whole: false };
}
