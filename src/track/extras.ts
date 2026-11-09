import { OPTION_CHOICES, TRACK, WORLD, type RunoffId } from '../config/track.ts';
import { hashString, rng } from '../core/random.ts';
import { kerbLayout } from './kerbs.ts';
import { edgeOffsets, leftOf } from './spline.ts';
import type { Track, TrackDef } from './track.ts';

/**
 * What the editor adds to a track beyond its dots and options: scenery
 * placed by hand (grandstands, garages, a tower, buildings, trees,
 * billboards, brake boards), bump kerbs, and run-off painted onto the paper.
 * All of it is in world metres, so it stays where it was put when the road
 * is reshaped (things the road now runs over are left out when the track is
 * built). Stored with the track and in its code (see track/code.ts).
 */

/** Things that can be placed. The order is the one track codes store. */
export type PlacedKind = 'grandstand' | 'garages' | 'tower' | 'building' | 'trees' | 'billboard' | 'brakeboards' | 'bump';
export const PLACED_KINDS: readonly PlacedKind[] = ['grandstand', 'garages', 'tower', 'building', 'trees', 'billboard', 'brakeboards', 'bump'];

/** One placed thing: its middle (m, 0.5 m steps) and which way its length runs (radians, in 1/64 turns). */
export interface Placed {
  kind: PlacedKind;
  x: number;
  y: number;
  rot: number;
}

export interface TrackExtras {
  placed?: Placed[];
  /** Painted run-off: the paint grid (PAINT) run-length coded, [run, kind, run, kind, ...] in rows from the top left. */
  paint?: number[];
}

/**
 * Sizes (m): how long and deep each thing is and how tall, how far from the
 * road it must stand (from the centre line: 'kerb' = just past the kerbs,
 * 'barrier' = behind the barrier line), and whether a car can hit it.
 */
export const PLACED_SPEC: Record<PlacedKind, { w: number; d: number; h: number; clear: 'kerb' | 'barrier'; solid: boolean }> = {
  grandstand: { w: 32, d: 10, h: 9, clear: 'barrier', solid: true },
  garages: { w: 30, d: 10, h: 5, clear: 'barrier', solid: true },
  tower: { w: 8, d: 8, h: 22, clear: 'barrier', solid: true },
  building: { w: 12, d: 12, h: 18, clear: 'barrier', solid: true },
  trees: { w: 12, d: 12, h: 7, clear: 'barrier', solid: true },
  billboard: { w: 12, d: 1, h: 7, clear: 'kerb', solid: true },
  brakeboards: { w: 24, d: 1, h: 2.4, clear: 'kerb', solid: true },
  bump: { w: 3, d: 0.6, h: 0.16, clear: 'kerb', solid: false },
};

/** Rotations are stored in this many steps per turn. */
export const ROT_STEPS = 64;
export const quantizeRot = (a: number): number => {
  const k = ((Math.round((a / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS) + ROT_STEPS) % ROT_STEPS;
  return (k * Math.PI * 2) / ROT_STEPS;
};

/** The run-off paint grid: square cells over the paper. */
export const PAINT = { cell: 4, cols: Math.ceil(WORLD.width / 4), rows: Math.ceil(WORLD.height / 4) } as const;
/** Paint values: 0 = as the track (its run-off option), then grass, gravel, tarmac. */
export const PAINT_KINDS: readonly (RunoffId | null)[] = [null, 'grass', 'gravel', 'tarmac'];

/** The paint grid cell holding world point (x, y), or -1 off the paper. */
export function paintCell(x: number, y: number): number {
  const cx = Math.floor((x + WORLD.width / 2) / PAINT.cell);
  const cy = Math.floor((y + WORLD.height / 2) / PAINT.cell);
  return cx < 0 || cy < 0 || cx >= PAINT.cols || cy >= PAINT.rows ? -1 : cy * PAINT.cols + cx;
}

/** World centre of a paint cell. */
export function cellCentre(k: number): { x: number; y: number } {
  return { x: ((k % PAINT.cols) + 0.5) * PAINT.cell - WORLD.width / 2, y: (Math.floor(k / PAINT.cols) + 0.5) * PAINT.cell - WORLD.height / 2 };
}

const grids = new WeakMap<number[], Uint8Array>();

/** The paint grid from its run-length code (all "as the track" without one). */
export function paintGrid(rle: readonly number[] | undefined): Uint8Array {
  const size = PAINT.cols * PAINT.rows;
  if (!rle?.length) return new Uint8Array(size);
  const hit = grids.get(rle as number[]);
  if (hit) return hit;
  const g = new Uint8Array(size);
  let at = 0;
  for (let i = 0; i + 1 < rle.length && at < size; i += 2) {
    const run = Math.max(0, Math.floor(rle[i]));
    const kind = rle[i + 1] & 3;
    if (kind) g.fill(kind, at, Math.min(size, at + run));
    at += run;
  }
  grids.set(rle as number[], g);
  return g;
}

/** Run-length code of a paint grid, or undefined if nothing is painted. */
export function paintCode(g: Uint8Array): number[] | undefined {
  if (!g.some((v) => v !== 0)) return undefined;
  const out: number[] = [];
  let i = 0;
  while (i < g.length) {
    let j = i + 1;
    while (j < g.length && g[j] === g[i]) j++;
    // A trailing run of "as the track" needs no entry.
    if (j === g.length && g[i] === 0) break;
    out.push(j - i, g[i]);
    i = j;
  }
  return out;
}

/** True if there's nothing in the extras. */
export const emptyExtras = (e: TrackExtras | undefined): boolean => !e || (!e.placed?.length && !e.paint?.length);

/** A copy with placed things rounded the way codes store them (0.5 m, 1/64 turn) and no empty parts; undefined if empty. */
export function cleanExtras(e: TrackExtras | undefined): TrackExtras | undefined {
  if (emptyExtras(e)) return undefined;
  const out: TrackExtras = {};
  const q = TRACK.quantize;
  if (e?.placed?.length) out.placed = e.placed.map((p) => ({ kind: p.kind, x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q, rot: quantizeRot(p.rot) }));
  if (e?.paint?.length) out.paint = [...e.paint];
  return out;
}

/** Text that changes whenever the extras do (for the track's content id). */
export function extrasKey(e: TrackExtras | undefined): string {
  if (emptyExtras(e)) return '';
  const placed = (e?.placed ?? []).map((p) => `${p.kind}@${p.x},${p.y},${Math.round((p.rot / (Math.PI * 2)) * ROT_STEPS)}`).join(';');
  return `${placed}#${(e?.paint ?? []).join(',')}`;
}

// ------------------------------------------------------------- footprints

/** Unit vectors along a placed thing's length and across it (towards its front). */
export function axes(p: Placed): { ax: number; ay: number; nx: number; ny: number } {
  const ax = Math.cos(p.rot);
  const ay = Math.sin(p.rot);
  return { ax, ay, nx: -ay, ny: ax };
}

/** Points around and inside a placed thing's footprint (for clearance checks). */
function footprintPoints(p: Placed): { x: number; y: number }[] {
  const s = PLACED_SPEC[p.kind];
  const { ax, ay, nx, ny } = axes(p);
  const out: { x: number; y: number }[] = [];
  const nw = Math.max(1, Math.ceil(s.w / 4));
  const nd = Math.max(1, Math.ceil(s.d / 4));
  for (let i = 0; i <= nw; i++) {
    for (let j = 0; j <= nd; j++) {
      const u = (i / nw - 0.5) * s.w;
      const v = (j / nd - 0.5) * s.d;
      out.push({ x: p.x + ax * u + nx * v, y: p.y + ay * u + ny * v });
    }
  }
  return out;
}

/** How close to the centre line a thing of this kind may come on `track`. */
export function clearanceFor(track: Track, kind: PlacedKind): number {
  if (kind === 'bump') return track.center.width / 2 + 0.2;
  return PLACED_SPEC[kind].clear === 'barrier' ? track.center.wallOffset + 1.5 : track.center.width / 2 + TRACK.kerbWidth + 1;
}

/** Nearest centre-line distance from (x, y) (brute force over every 2nd sample, then refined). */
export function roadDistance(track: Track, x: number, y: number): { d: number; i: number } {
  const pts = track.center.points;
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  for (const i of [bi - 1, bi + 1]) {
    const k = (i + pts.length) % pts.length;
    const d = (pts[k].x - x) ** 2 + (pts[k].y - y) ** 2;
    if (d < best) {
      best = d;
      bi = k;
    }
  }
  return { d: Math.sqrt(best), i: bi };
}

/** True if nothing of `p` is on (or, for most things, inside the barriers of) the road. */
export function placedClear(track: Track, p: Placed): boolean {
  const clear = clearanceFor(track, p.kind);
  if (p.kind === 'bump') {
    // A bump kerb lies just past the kerb: off the road, but inside the barriers.
    const d = roadDistance(track, p.x, p.y).d;
    return d >= clear && d <= track.center.wallOffset;
  }
  return footprintPoints(p).every((q) => roadDistance(track, q.x, q.y).d >= clear);
}

const usable = new WeakMap<Track, Placed[]>();

/** The placed things that are clear of the road as it is now (the rest are left out). */
export function placedOn(track: Track): Placed[] {
  const hit = usable.get(track);
  if (hit) return hit;
  const list = (track.def.extras?.placed ?? []).filter((p) => placedClear(track, p));
  usable.set(track, list);
  return list;
}

/** The trees of a "trees" clump: 3 to 5, scattered about its middle, the same every time. */
export function clumpTrees(p: Placed): { x: number; y: number; scale: number; kind: 0 | 1 }[] {
  const rand = rng(hashString(`${p.x},${p.y}`));
  const n = 3 + Math.floor(rand() * 3);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rand();
    const r = i === 0 ? 0 : 2.5 + rand() * 3;
    return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, scale: 0.8 + rand() * 0.6, kind: rand() < 0.6 ? 0 : 1 };
  });
}

/** Circles a car can hit (x, z, radius), for the physics. */
export function placedObstacles(track: Track): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const p of placedOn(track)) {
    const s = PLACED_SPEC[p.kind];
    if (!s.solid) continue;
    const { ax, ay } = axes(p);
    if (p.kind === 'trees') {
      for (const t of clumpTrees(p)) out.push({ x: t.x, z: t.y, r: 0.5 * t.scale });
    } else if (p.kind === 'billboard') {
      for (const u of [-4.5, 4.5]) out.push({ x: p.x + ax * u, z: p.y + ay * u, r: 0.35 });
    } else if (p.kind === 'brakeboards') {
      for (const u of BRAKE_BOARDS) out.push({ x: p.x + ax * u, z: p.y + ay * u, r: 0.4 });
    } else {
      // A row of circles along its length, as wide as it's deep.
      const r = s.d / 2;
      const n = Math.max(1, Math.round(s.w / s.d));
      for (let i = 0; i < n; i++) {
        const u = ((i + 0.5) / n - 0.5) * s.w;
        out.push({ x: p.x + ax * u, z: p.y + ay * u, r: r * 1.05 });
      }
    }
  }
  return out;
}

/** Where along a set of brake boards (m from its middle) the three boards stand: 300, 200, 100 m to go. */
export const BRAKE_BOARDS = [-10, 0, 10] as const;

// ------------------------------------------------------------ bump kerbs

/** A bump kerb on the inside of numbered corner `i` of `track`, just past the kerb at its apex. */
export function bumpFor(track: Track, i: number): Placed | null {
  const k = track.kerbs[i];
  if (!k) return null;
  const c = track.center;
  const inside: 1 | -1 = k.sign > 0 ? -1 : 1;
  const { left, right } = edgeOffsets(c);
  const lay = kerbLayout(track);
  const a = k.apex;
  const edge = inside === 1 ? left[a] : right[a];
  const kerbOuter = inside === 1 ? lay.outerL[a] : lay.outerR[a];
  const lat = Math.max(edge, kerbOuter) + 0.6;
  // Not if the corner's too tight for it to sit inside.
  if (Math.abs(c.curvature[a]) * (lat + 0.5) > 0.9) return null;
  const l = leftOf(c.tangents[a]);
  const q = TRACK.quantize;
  const t = c.tangents[a];
  return { kind: 'bump', x: Math.round((c.points[a].x + l.x * lat * inside) / q) * q, y: Math.round((c.points[a].y + l.y * lat * inside) / q) * q, rot: quantizeRot(Math.atan2(t.y, t.x)) };
}

/** Numbered corners that are part of a chicane: a corner one way, then soon after one the other way. */
export function chicaneCorners(track: Track): number[] {
  const ks = track.kerbs;
  const n = track.center.points.length;
  const out = new Set<number>();
  for (let i = 0; i < ks.length; i++) {
    const a = ks[i];
    const j = (i + 1) % ks.length;
    if (j === i) continue;
    const b = ks[j];
    const gap = (((b.start - (a.start + a.count)) % n) + n) % n;
    if (Math.sign(a.sign) !== Math.sign(b.sign) && gap * track.center.spacing < 45) {
      out.add(i);
      out.add(j);
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** The bump kerb (if any) near corner `i`'s spot, by index in `placed`. */
export function bumpNear(placed: readonly Placed[], spot: Placed): number {
  return placed.findIndex((p) => p.kind === 'bump' && Math.hypot(p.x - spot.x, p.y - spot.y) < 4);
}

// ------------------------------------------------------------ run-off

export interface RunoffLayout {
  /** Run-off kind index (OPTION_CHOICES.runoff) on the left and right of every centre-line sample. */
  left: Uint8Array;
  right: Uint8Array;
}

const runoffs = new WeakMap<Track, RunoffLayout>();
const RUNOFF_IDS = OPTION_CHOICES.runoff as readonly RunoffId[];

/**
 * The run-off beside every stretch of road: the track's own, unless it's
 * painted (from a corner's run-off choice or the brush) where it meets the
 * road. Shared by the physics, the 3D run-off and the editor's map.
 */
export function runoffLayout(track: Track): RunoffLayout {
  const hit = runoffs.get(track);
  if (hit) return hit;
  const c = track.center;
  const n = c.points.length;
  const base = Math.max(0, RUNOFF_IDS.indexOf(track.options.runoff));
  const out: RunoffLayout = { left: new Uint8Array(n).fill(base), right: new Uint8Array(n).fill(base) };
  const g = paintGrid(track.def.extras?.paint);
  if (track.def.extras?.paint?.length) {
    const { left, right } = edgeOffsets(c);
    for (let i = 0; i < n; i++) {
      const l = leftOf(c.tangents[i]);
      const p = c.points[i];
      for (const side of [1, -1] as const) {
        const edge = side === 1 ? left[i] : right[i];
        // Just past the edge, then halfway out to the barrier.
        for (const lat of [edge + 1.5, (edge + c.wallOffset) / 2 + 0.75]) {
          const k = paintCell(p.x + l.x * lat * side, p.y + l.y * lat * side);
          const v = k >= 0 ? g[k] : 0;
          if (!v) continue;
          const id = RUNOFF_IDS.indexOf(PAINT_KINDS[v] as RunoffId);
          (side === 1 ? out.left : out.right)[i] = id;
          break;
        }
      }
    }
  }
  runoffs.set(track, out);
  return out;
}

/** Paints the run-off beside numbered corner `i` (both sides, the length of the corner and a little more) with paint value `v`. */
export function paintCorner(g: Uint8Array, track: Track, i: number, v: number): void {
  const k = track.kerbs[i];
  if (!k) return;
  const c = track.center;
  const n = c.points.length;
  const { left, right } = edgeOffsets(c);
  for (let o = -6; o <= k.count + 6; o++) {
    const s = (((k.start + o) % n) + n) % n;
    const l = leftOf(c.tangents[s]);
    const p = c.points[s];
    for (const side of [1, -1] as const) {
      const edge = side === 1 ? left[s] : right[s];
      for (let lat = edge + 0.5; lat <= c.wallOffset + 2; lat += 1.5) {
        const cell = paintCell(p.x + l.x * lat * side, p.y + l.y * lat * side);
        if (cell >= 0) g[cell] = v;
      }
    }
  }
}

/** Paints a round dab of paint value `v`, `radius` m across, at (x, y). */
export function paintDab(g: Uint8Array, x: number, y: number, radius: number, v: number): void {
  const r = Math.max(PAINT.cell / 2, radius);
  for (let yy = y - r; yy <= y + r + 1e-6; yy += PAINT.cell / 2) {
    for (let xx = x - r; xx <= x + r + 1e-6; xx += PAINT.cell / 2) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      const k = paintCell(xx, yy);
      if (k >= 0) g[k] = v;
    }
  }
}

/** The extras with a new paint grid. */
export const withPaint = (e: TrackExtras | undefined, g: Uint8Array): TrackExtras => ({ ...e, paint: paintCode(g) });

/** A TrackDef's extras, never undefined. */
export const extrasOf = (def: Pick<TrackDef, 'extras'>): TrackExtras => def.extras ?? {};
