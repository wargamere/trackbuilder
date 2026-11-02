import { INK, TRACK } from '../config/track.ts';
import { dist2, lerpVec, segmentsCross, type Vec2 } from '../core/math.ts';
import type { Centerline } from '../track/spline.ts';

export type TrackIssue =
  | 'too-short'
  | 'too-long'
  | 'not-closed'
  | 'shallow-crossing'
  | 'crossing-start'
  | 'too-close'
  | 'too-tight';

export type Validation = { ok: true } | { ok: false; issue: TrackIssue; at?: Vec2 };

/** A place where the centre line crosses itself (segments i and j). */
export interface Crossing {
  i: number;
  j: number;
  at: Vec2;
  /** Angle between the two roads, 0..π/2. */
  angle: number;
}

/** Every self-crossing of a closed centre line. */
export function findCrossings(c: Centerline): Crossing[] {
  const pts = c.points;
  const n = pts.length;
  const out: Crossing[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours across the wrap
      const p = pts[j];
      const q = pts[(j + 1) % n];
      if (Math.max(p.x, q.x) < minX || Math.min(p.x, q.x) > maxX) continue;
      if (Math.max(p.y, q.y) < minY || Math.min(p.y, q.y) > maxY) continue;
      if (!segmentsCross(a, b, p, q)) continue;
      const ti = c.tangents[i];
      const tj = c.tangents[j];
      const angle = Math.acos(Math.min(1, Math.abs(ti.x * tj.x + ti.y * tj.y)));
      out.push({ i, j, at: lerpVec(a, b, 0.5), angle });
    }
  }
  return out;
}

/** Circular distance between two sample indices. */
const ringDist = (a: number, b: number, n: number) => {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
};

/**
 * Checks that a closed centre line makes a drivable road. Flat crossings are
 * allowed when the roads meet steeply enough and away from the start line.
 */
export function validateCenterline(c: Centerline): Validation {
  const pts = c.points;
  const n = pts.length;

  if (c.length < TRACK.minLength) return { ok: false, issue: 'too-short', at: pts[0] };
  if (c.length > INK.max * 1.03) return { ok: false, issue: 'too-long', at: pts[Math.floor(n / 2)] };

  const maxCurv = 1 / TRACK.minRadius;
  for (let i = 0; i < n; i++) {
    if (Math.abs(c.curvature[i]) > maxCurv) return { ok: false, issue: 'too-tight', at: pts[i] };
  }

  const crossings = findCrossings(c);
  const startClear = Math.ceil(TRACK.crossingStartClearance / c.spacing);
  for (const x of crossings) {
    if (x.angle < TRACK.minCrossingAngle) return { ok: false, issue: 'shallow-crossing', at: x.at };
    if (ringDist(x.i, 0, n) < startClear || ringDist(x.j, 0, n) < startClear) {
      return { ok: false, issue: 'crossing-start', at: x.at };
    }
  }
  // Around each crossing the two roads are allowed to be close; size the zone by the angle.
  const zones = crossings.map((x) => ({
    i: x.i,
    j: x.j,
    half: Math.ceil((TRACK.roadWidth / Math.sin(x.angle) + TRACK.minSeparation) / c.spacing),
  }));
  const inCrossingZone = (a: number, b: number) =>
    zones.some(
      (z) =>
        (ringDist(a, z.i, n) <= z.half && ringDist(b, z.j, n) <= z.half) ||
        (ringDist(a, z.j, n) <= z.half && ringDist(b, z.i, n) <= z.half),
    );

  // Two unrelated parts of the road too close together. For each point, walk
  // along the track in both directions until it first gets `minSeparation` away:
  // that stretch is the point's own neighbourhood. Anything else closer than
  // `minSeparation` is a different part of the track coming back.
  const sep2 = TRACK.minSeparation * TRACK.minSeparation;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let fwd = 1;
    while (fwd < n && dist2(p, pts[(i + fwd) % n]) < sep2) fwd++;
    let back = 1;
    while (back < n && dist2(p, pts[(i - back + n) % n]) < sep2) back++;
    for (let k = fwd; k <= n - back; k++) {
      const j = (i + k) % n;
      if (dist2(p, pts[j]) < sep2 && !inCrossingZone(i, j)) return { ok: false, issue: 'too-close', at: lerpVec(p, pts[j], 0.5) };
    }
  }

  return { ok: true };
}
