import type { Track } from './track.ts';

/** Numbers about a track for the editor's stats strip and sidebar. */
export interface TrackStats {
  /** Lap length (m). */
  length: number;
  /** Corners with kerbs (the numbered corners on the map). */
  corners: number;
  /** Longest stretch gentler than a 300 m radius (m). */
  longestStraight: number;
  /** Steepest slope, in percent. */
  maxGradient: number;
  /** Highest minus lowest point of the road (m). */
  elevation: number;
  /** Tightest corner radius (m). */
  tightestRadius: number;
  /** Rough terrain description from the elevation change. */
  terrain: 'flat' | 'rolling' | 'hilly';
}

const STRAIGHT_K = 1 / 300;
const cache = new WeakMap<Track, TrackStats>();

export function trackStats(track: Track): TrackStats {
  const hit = cache.get(track);
  if (hit) return hit;
  const c = track.center;
  const n = c.points.length;
  let maxK = 0;
  let maxGrade = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    maxK = Math.max(maxK, Math.abs(c.curvature[i]));
    maxGrade = Math.max(maxGrade, Math.abs(c.grade[i]));
    lo = Math.min(lo, c.height[i]);
    hi = Math.max(hi, c.height[i]);
  }
  // Longest run of straight-ish samples, wrapping round the start line.
  let best = 0;
  let run = 0;
  for (let k = 0; k < n * 2; k++) {
    if (Math.abs(c.curvature[k % n]) < STRAIGHT_K) {
      run++;
      best = Math.max(best, Math.min(run, n));
    } else run = 0;
  }
  const elevation = hi - lo;
  const stats: TrackStats = {
    length: c.length,
    corners: track.kerbs.length,
    longestStraight: best * c.spacing,
    maxGradient: maxGrade * 100,
    elevation,
    tightestRadius: maxK > 0 ? 1 / maxK : Infinity,
    terrain: elevation < 1 ? 'flat' : elevation < 12 ? 'rolling' : 'hilly',
  };
  cache.set(track, stats);
  return stats;
}
