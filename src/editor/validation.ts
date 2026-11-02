import { TRACK } from '../config/track.ts';
import { dist2, lerpVec, segmentsCross, type Vec2 } from '../core/math.ts';
import type { Centerline } from '../track/spline.ts';

export type TrackIssue = 'too-short' | 'not-closed' | 'crossing' | 'too-close' | 'too-tight';

export type Validation = { ok: true } | { ok: false; issue: TrackIssue; at?: Vec2 };

/** Checks that a closed centre line makes a drivable, non-overlapping road. */
export function validateCenterline(c: Centerline): Validation {
  const pts = c.points;
  const n = pts.length;

  if (c.length < TRACK.minLength) return { ok: false, issue: 'too-short', at: pts[0] };

  // Corners that relaxation could not open up. A little slack for quantisation.
  const maxCurv = 1 / (TRACK.minRadius * 0.85);
  for (let i = 0; i < n; i++) {
    if (Math.abs(c.curvature[i]) > maxCurv) return { ok: false, issue: 'too-tight', at: pts[i] };
  }

  // Centre line crossing itself (figure-eights would need a bridge).
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours across the wrap
      const p = pts[j];
      const q = pts[(j + 1) % n];
      // cheap bounding-box reject
      if (Math.max(p.x, q.x) < Math.min(a.x, b.x) || Math.min(p.x, q.x) > Math.max(a.x, b.x)) continue;
      if (Math.max(p.y, q.y) < Math.min(a.y, b.y) || Math.min(p.y, q.y) > Math.max(a.y, b.y)) continue;
      if (segmentsCross(a, b, p, q)) return { ok: false, issue: 'crossing', at: lerpVec(a, b, 0.5) };
    }
  }

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
      const q = pts[(i + k) % n];
      if (dist2(p, q) < sep2) return { ok: false, issue: 'too-close', at: lerpVec(p, q, 0.5) };
    }
  }

  return { ok: true };
}
