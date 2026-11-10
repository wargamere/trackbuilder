import { TRACK } from '../config/track.ts';
import { crossingKind, crossingsOf } from '../editor/validation.ts';
import type { Track } from './track.ts';

/** A tunnel: the stretch of the lower road (sample indices, from..to going forwards) under the road above, and its roof height. */
export interface Tunnel {
  from: number;
  /** Number of samples it runs for. */
  count: number;
  /** Height of the underside of the roof (m). */
  roof: number;
  /** The sample of the road above where they cross. */
  upper: number;
}

const cache = new WeakMap<Track, Tunnel[]>();

/**
 * Where the track crosses itself at different heights and its crossings are
 * tunnels (TrackOptions.crossing): the lower road runs through a tunnel as
 * long as the road above and its shoulders are wide, plus a few metres.
 * Empty for bridges or level crossings.
 */
export function tunnelsOf(track: Track): Tunnel[] {
  const hit = cache.get(track);
  if (hit) return hit;
  const out: Tunnel[] = [];
  if (track.options.crossing === 'tunnel') {
    const c = track.center;
    const n = c.points.length;
    const reach = c.wallOffset + 4;
    for (const x of crossingsOf(c)) {
      if (crossingKind(x.dh) !== 'bridge') continue;
      const lower = x.dh > 0 ? x.i : x.j;
      const upper = x.dh > 0 ? x.j : x.i;
      // How far the lower road is from the road above at sample k (the nearest of its samples around the crossing).
      const under = (k: number) => {
        const p = c.points[((k % n) + n) % n];
        let best = Infinity;
        for (let o = -40; o <= 40; o++) {
          const q = c.points[(((upper + o) % n) + n) % n];
          best = Math.min(best, (p.x - q.x) ** 2 + (p.y - q.y) ** 2);
        }
        return Math.sqrt(best) < reach;
      };
      let a = lower;
      let b = lower;
      while (b - a < n / 4 && under(a - 1)) a--;
      while (b - a < n / 4 && under(b + 1)) b++;
      out.push({ from: ((a % n) + n) % n, count: b - a, roof: c.height[upper] - 1.25, upper });
    }
  }
  cache.set(track, out);
  return out;
}

/** True if sample `i` is on a road over a tunnel (within `margin` samples of where it crosses): no bridge pillars there. */
export function overTunnel(track: Track, i: number, margin = 12): boolean {
  const n = track.center.points.length;
  return tunnelsOf(track).some((t) => {
    const d = Math.abs(i - t.upper) % n;
    return Math.min(d, n - d) <= margin;
  });
}

/** Clearance under a tunnel's roof over the lower road (m), for reference. */
export const TUNNEL_CLEARANCE = TRACK.bridgeClearance - 1.25;
