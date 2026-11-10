import { WORLD } from '../config/track.ts';
import { wrap, type Vec2 } from '../core/math.ts';
import { leftOf, sampleAt, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

/**
 * Where the pit building goes (plain data, no Three.js): a row of garages and a
 * pit lane beside the start straight, behind the barrier, on whichever side
 * has room. Purely scenery: cars race past it.
 */
export interface PitLayout {
  /** +1 = left of the direction of travel, -1 = right. */
  side: 1 | -1;
  /** Track positions (m, from the start line; `from` may be negative) of the ends of the building. */
  from: number;
  to: number;
  /** Distance from the centre line (m) of the pit lane's inner and outer edge... */
  lane: [number, number];
  /** ...and of the building's front and back. */
  building: [number, number];
  /** Track position of each garage's centre. */
  doors: number[];
  /** Points over the whole footprint, for keeping trees and other scenery off it. */
  footprint: Vec2[];
}

const GARAGE = 6;
const MAX_GARAGES = 10;
const LANE_WIDTH = 7.5;
const DEPTH = 10;
/** The start straight must be gentler than this curvature (1/m)... */
const STRAIGHT = 1 / 170;
/** ...and the footprint at least this far from any other part of the track. */
const CLEAR = 8;

const cache = new WeakMap<Track, PitLayout | null>();

/** Index of the sample at track position `s` (wraps). */
const indexAt = (c: Centerline, s: number) => wrap(Math.round(s / c.spacing), c.points.length);

/** The pits for a track, or null when it has none (switched off, or no room by the start). */
export function pitLayout(track: Track): PitLayout | null {
  if (cache.has(track)) return cache.get(track) ?? null;
  const out = track.options.pits ? layout(track.center) : null;
  cache.set(track, out);
  return out;
}

function layout(c: Centerline): PitLayout | null {
  // How far the straight reaches either side of the start line.
  const reach = (dir: 1 | -1) => {
    let d = 0;
    while (d < 70 && Math.abs(c.curvature[indexAt(c, dir * (d + c.spacing))]) < STRAIGHT) d += c.spacing;
    return d;
  };
  const back = reach(-1);
  const fwd = reach(1);
  const garages = Math.min(MAX_GARAGES, Math.floor((back + fwd - 4) / GARAGE));
  if (garages < 3) return null;
  const total = garages * GARAGE + 4;
  const mid = (fwd - back) / 2;
  const from = mid - total / 2;
  const to = mid + total / 2;
  const lane: [number, number] = [c.wallOffset + 0.6, c.wallOffset + 0.6 + LANE_WIDTH];
  const building: [number, number] = [lane[1] + 0.5, lane[1] + 0.5 + DEPTH];

  // The samples the building sits beside (other parts of the track must keep clear).
  const own = new Set<number>();
  for (let s = from - 40; s <= to + 40; s += c.spacing) own.add(indexAt(c, s));
  const footprintFor = (side: 1 | -1): Vec2[] => {
    const pts: Vec2[] = [];
    for (let s = from; s <= to + 0.01; s += 4) {
      const { p, t } = sampleAt(c, s);
      const l = leftOf(t);
      for (const lat of [lane[0], (lane[1] + building[0]) / 2, building[0] + DEPTH / 2, building[1]]) {
        pts.push({ x: p.x + l.x * lat * side, y: p.y + l.y * lat * side });
      }
    }
    return pts;
  };
  const clearFor = (pts: Vec2[]): boolean => {
    const limit = c.width / 2 + CLEAR;
    for (const q of pts) {
      if (Math.abs(q.x) > WORLD.width / 2 + 60 || Math.abs(q.y) > WORLD.height / 2 + 60) return false;
      for (let i = 0; i < c.points.length; i++) {
        if (own.has(i)) continue;
        const p = c.points[i];
        if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < limit * limit) return false;
      }
    }
    return true;
  };
  // Right-hand side first (as at most circuits), else the left.
  for (const side of [-1, 1] as const) {
    const footprint = footprintFor(side);
    if (!clearFor(footprint)) continue;
    const doors = Array.from({ length: garages }, (_, k) => from + 2 + GARAGE * (k + 0.5));
    return { side, from, to, lane, building, doors, footprint };
  }
  return null;
}
