import { TRACK } from '../config/track.ts';
import { wrap, type Vec2 } from '../core/math.ts';
import { leftOf, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

/** Where a point is relative to the track. */
export interface TrackPos {
  /** Centre-line segment the point projects onto (segment index → index + 1). */
  index: number;
  /** Distance along the track from the start line, 0..length. */
  s: number;
  /** Signed distance from the centre line; positive = left of the direction of travel. */
  lateral: number;
}

/**
 * Projects points onto the centre line. Searches near the previous index first,
 * which is cheap and keeps a car "on its own part" of the track where two
 * stretches run close together. It falls back to a full search when far off.
 */
export class TrackLocator {
  readonly center: Centerline;
  /**
   * For each centre-line sample: +1 if the left edge has a kerb, -1 the right
   * edge, 0 none. Kerbs count as road for grip.
   */
  readonly kerbSide: Int8Array;

  constructor(track: Track) {
    this.center = track.center;
    const n = track.center.points.length;
    this.kerbSide = new Int8Array(n);
    if (track.options.kerbs !== 'none') {
      for (const k of track.kerbs) {
        for (let j = -3; j < k.count + 3; j++) this.kerbSide[wrap(k.start + j, n)] = k.sign > 0 ? 1 : -1;
      }
    }
  }

  /** Projection of `p` onto segment `i`. */
  private onSegment(p: Vec2, i: number): { d2: number; t: number } {
    const c = this.center;
    const a = c.points[i];
    const b = c.points[(i + 1) % c.points.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = p.x - (a.x + abx * t);
    const dy = p.y - (a.y + aby * t);
    return { d2: dx * dx + dy * dy, t };
  }

  locate(p: Vec2, hint = -1, window = 24): TrackPos {
    const n = this.center.points.length;
    let best = -1;
    let bestD2 = Infinity;
    let bestT = 0;
    const scan = (from: number, count: number) => {
      for (let k = 0; k < count; k++) {
        const i = wrap(from + k, n);
        const r = this.onSegment(p, i);
        if (r.d2 < bestD2) {
          bestD2 = r.d2;
          best = i;
          bestT = r.t;
        }
      }
    };
    if (hint >= 0) scan(hint - window, window * 2 + 1);
    // Off the local stretch (or no hint): search everything.
    if (best < 0 || bestD2 > (this.center.width * 2) ** 2) scan(0, n);
    const c = this.center;
    const a = c.points[best];
    const l = leftOf(c.tangents[best]);
    const lateral = (p.x - a.x) * l.x + (p.y - a.y) * l.y;
    const s = (best + bestT) * c.spacing;
    return { index: best, s: s >= c.length ? s - c.length : s, lateral };
  }

  /** How far the road (including any kerb) reaches on one side at sample `i`. */
  edge(i: number, side: 1 | -1): number {
    const hw = this.center.width / 2;
    return this.kerbSide[i] === side ? hw + TRACK.kerbWidth : hw + 0.2;
  }
}

const cache = new WeakMap<Track, TrackLocator>();
export function locatorFor(track: Track): TrackLocator {
  let l = cache.get(track);
  if (!l) {
    l = new TrackLocator(track);
    cache.set(track, l);
  }
  return l;
}
