import { PIT_LANE } from '../config/race.ts';
import { clamp, wrap } from '../core/math.ts';
import { pitLayout } from './pits.ts';
import { leftOf, sampleAt, surfaceY, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

/**
 * The pit lane (plain data): off the track over a ramp before the garages,
 * behind a pit wall past them, and back onto the track over a ramp after.
 * Distances across are metres out from the centre line on the pit side
 * (`side`); along, track positions unwrapped from `entry` (which may be
 * negative) to `exit`.
 */
export interface PitLane {
  side: 1 | -1;
  /** The track's length (m). */
  length: number;
  /** Where the entry ramp leaves the track and the exit ramp joins it again. */
  entry: number;
  exit: number;
  /** The pit wall (and the speed limit) runs from `wallFrom` to `wallTo`. */
  wallFrom: number;
  wallTo: number;
  /** Across: the road's edge (where the ramps' paving starts), the pit wall's two faces, the fast lane's middle, the boxes' middle and the lane's outer edge. */
  edge: number;
  wall: number;
  inner: number;
  fast: number;
  box: number;
  outer: number;
  /** Track position of each box (in front of a garage), the one nearest the middle first. */
  boxes: number[];
}

const cache = new WeakMap<Track, PitLane | null>();

/** Index of the sample at track position `s` (wraps). */
const indexAt = (c: Centerline, s: number) => wrap(Math.round(s / c.spacing), c.points.length);

const smooth = (u: number) => u * u * (3 - 2 * u);

/** The track's pit lane, or null when it has none (no pits, or no room for the ramps). */
export function pitLane(track: Track): PitLane | null {
  if (cache.has(track)) return cache.get(track) ?? null;
  const out = build(track);
  cache.set(track, out);
  return out;
}

function build(track: Track): PitLane | null {
  const pits = pitLayout(track);
  if (!pits) return null;
  const P = PIT_LANE;
  const c = track.center;
  const L = c.length;
  const wall = c.wallOffset;
  const inner = wall + P.wallThick;
  const doors = pits.doors;
  // Ramps beyond the ends of the building if there's room; if a bend comes too soon after it,
  // a ramp in front of the end garages instead (their boxes not used). The most boxes that fit.
  const options: { a: number; b: number }[] = [];
  for (let a = 0; a < doors.length; a++) for (let b = 0; a + b <= doors.length - 2; b++) options.push({ a, b });
  options.sort((x, y) => x.a + x.b - (y.a + y.b) || Math.abs(x.a - x.b) - Math.abs(y.a - y.b));
  for (const { a, b } of options) {
    const used = doors.slice(a, doors.length - b);
    const from = a ? used[0] - 3 : pits.from;
    const to = b ? used[used.length - 1] + 3 : pits.to;
    const entry = from - P.ramp;
    const exit = to + P.ramp;
    if (exit - entry > L / 2) continue;
    const mid = (from + to) / 2;
    const lane: PitLane = {
      side: pits.side,
      length: L,
      entry,
      exit,
      wallFrom: entry + P.ramp * P.wallAt,
      wallTo: exit - P.ramp * P.wallAt,
      edge: c.width / 2,
      wall,
      inner,
      fast: inner + P.fast,
      box: inner + P.box,
      outer: pits.lane[1],
      boxes: [...used].sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid)),
    };
    if (roomFor(c, lane)) return lane;
  }
  return null;
}

/**
 * Room for the ramps: the road gentle enough along them that the lane
 * doesn't fold over on the inside of a bend, and no other part of the track
 * in the way (the garages themselves are checked by pitLayout).
 */
function roomFor(c: Centerline, lane: PitLane): boolean {
  const n = c.points.length;
  const own = new Set<number>();
  for (let s = lane.entry - 30; s <= lane.exit + 30; s += c.spacing) own.add(indexAt(c, s));
  const limit = c.width / 2 + 4;
  for (let s = lane.entry; s <= lane.exit + 0.01; s += 2) {
    const o = outerAt(lane, s) ?? lane.wall;
    // (Where the ramp has barely left the barrier line it's no worse off than the barrier.)
    if (o > lane.wall + 1 && Math.abs(c.curvature[indexAt(c, s)]) * (o + 2) > 0.5) return false;
    const { p, t } = sampleAt(c, s);
    const l = leftOf(t);
    const lat = (o + 1) * lane.side;
    const qx = p.x + l.x * lat;
    const qy = p.y + l.y * lat;
    for (let i = 0; i < n; i++) {
      if (own.has(i)) continue;
      const q = c.points[i];
      if ((q.x - qx) ** 2 + (q.y - qy) ** 2 < limit * limit) return false;
    }
  }
  return true;
}

/** How far past the entry `s` is (m), or -1 if it isn't beside the lane. */
export function laneU(lane: PitLane, s: number): number {
  const u = wrap(s - lane.entry, lane.length);
  return u <= lane.exit - lane.entry ? u : -1;
}

/**
 * The lane's outer edge at `s` (m out): at the barrier line where the ramps
 * meet the track, out to the full lane past the garages. Null away from the lane.
 */
export function outerAt(lane: PitLane, s: number): number | null {
  const u = laneU(lane, s);
  if (u < 0) return null;
  const ramp = PIT_LANE.ramp;
  const span = lane.exit - lane.entry;
  const a = smooth(clamp(u / ramp, 0, 1)) * smooth(clamp((span - u) / ramp, 0, 1));
  return lane.wall + (lane.outer - lane.wall) * a;
}

/** The pit wall stands beside `s`. */
export function pitWallAt(lane: PitLane, s: number): boolean {
  const u = laneU(lane, s);
  return u >= lane.wallFrom - lane.entry && u <= lane.wallTo - lane.entry;
}

/** On the lane's paving (`lateral` m left of the centre line): beyond the road's edge on a ramp, beyond the pit wall beside it. */
export function onLane(lane: PitLane, s: number, lateral: number): boolean {
  const o = outerAt(lane, s);
  if (o === null) return false;
  const m = lateral * lane.side;
  return m <= o + 0.05 && m >= (pitWallAt(lane, s) ? lane.inner - 0.05 : lane.edge);
}

/** In the pit lane proper: beside the pit wall, on the garages' side of it (where the speed limit holds). */
export function inPitLane(lane: PitLane, s: number, lateral: number): boolean {
  return pitWallAt(lane, s) && lateral * lane.side > (lane.wall + lane.inner) / 2;
}

/** Car `k`'s box (0 = you): track position of its middle (garages shared round when there are more cars). */
export function boxFor(lane: PitLane, k: number): number {
  return lane.boxes[((k % lane.boxes.length) + lane.boxes.length) % lane.boxes.length];
}

/** Signed distance (m) from `from` forward to `to` along the lane's stretch (unwrapped from its entry). */
export function laneAlong(lane: PitLane, from: number, to: number): number {
  const a = wrap(from - lane.entry, lane.length);
  const b = wrap(to - lane.entry, lane.length);
  return b - a;
}

/** How far the lane's paving stands above the road's edge (m). */
export const PAVE_Y = 0.03;

/**
 * Height of the lane's paving at track position `s`, `m` m out on the pit
 * side: level across from the barrier line out (at the road's height there),
 * following the road's own slope between its edge and the barrier line.
 */
export function paveY(track: Track, lane: PitLane, s: number, m: number): number {
  const c = track.center;
  const n = c.points.length;
  const f = wrap(s, c.length) / c.spacing;
  const i = Math.floor(f) % n;
  const u = f - Math.floor(f);
  const lat = Math.min(m, lane.wall) * lane.side;
  return surfaceY(c, i, lat) * (1 - u) + surfaceY(c, (i + 1) % n, lat) * u + PAVE_Y;
}
