import { TRACK, WORLD } from '../config/track.ts';
import { wrap } from '../core/math.ts';
import { kerbAt, kerbLayout, type KerbLayout } from './kerbs.ts';
import { pitLayout, type PitLayout } from './pits.ts';
import { edgeOffsets, leftOf, sampleAt, surfaceY, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

/**
 * Everything about the ground a track sits on, shared by physics and rendering
 * (plain data, no Three.js):
 *  - a terrain heightfield that rises and falls with the road and fades back to
 *    flat ground further away,
 *  - which stretches of road are raised decks (bridges) and where they need pillars,
 *  - where the barriers go, with gaps where the track crosses itself.
 */
export interface Terrain {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  /** Heights, row-major (z rows of x). */
  h: Float32Array;
}

export interface TrackSurface {
  terrain: Terrain;
  /** Per centre-line sample: 1 if the road there is a raised deck. */
  deck: Uint8Array;
  /** Per sample: 1 if there is a barrier on the left / right edge. */
  wallL: Uint8Array;
  wallR: Uint8Array;
  /** Bridge pillars: ground position and the height of the deck above. */
  pillars: { x: number; z: number; y0: number; y1: number }[];
}

const TERRAIN_STEP = 5;
/** How far from the road the ground takes to blend back to flat. */
const BLEND = 55;
/**
 * The heightfield covers the drawable area plus this margin, which is more than
 * the road's reach (barrier line + blend), so its border is always flat (0) and
 * meets the flat ground outside it without a seam.
 */
const TERRAIN_MARGIN = 90;

/** Extent of the terrain grid (world x, z); the renderer puts flat ground around it. */
export const TERRAIN_RECT = {
  x0: -WORLD.width / 2 - TERRAIN_MARGIN,
  z0: -WORLD.height / 2 - TERRAIN_MARGIN,
  x1: -WORLD.width / 2 - TERRAIN_MARGIN + Math.ceil((WORLD.width + TERRAIN_MARGIN * 2) / TERRAIN_STEP) * TERRAIN_STEP,
  z1: -WORLD.height / 2 - TERRAIN_MARGIN + Math.ceil((WORLD.height + TERRAIN_MARGIN * 2) / TERRAIN_STEP) * TERRAIN_STEP,
} as const;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Centre-line samples bucketed on a grid for neighbourhood queries. */
class SampleGrid {
  private readonly cell: number;
  private readonly map = new Map<number, number[]>();
  constructor(c: Centerline, cell: number) {
    this.cell = cell;
    c.points.forEach((p, i) => {
      const k = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      const list = this.map.get(k);
      if (list) list.push(i);
      else this.map.set(k, [i]);
    });
  }
  private key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }
  /** Sample indices within roughly `r` of (x, z), unsorted. */
  near(x: number, z: number, r: number, out: number[]): number[] {
    out.length = 0;
    const c = this.cell;
    const rc = Math.ceil(r / c);
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    for (let i = -rc; i <= rc; i++) {
      for (let j = -rc; j <= rc; j++) {
        const list = this.map.get(this.key(cx + i, cz + j));
        if (list) for (const k of list) out.push(k);
      }
    }
    return out;
  }
}

/**
 * Splits nearby samples into separate passes of the track (runs of consecutive
 * indices) and returns the nearest sample of each pass.
 */
function nearestPerPass(c: Centerline, x: number, z: number, idx: number[], maxD: number): { i: number; d: number }[] {
  const n = c.points.length;
  const r2 = maxD * maxD;
  const close = idx.filter((i) => {
    const p = c.points[i];
    return (p.x - x) ** 2 + (p.y - z) ** 2 <= r2;
  });
  if (!close.length) return [];
  close.sort((a, b) => a - b);
  const runs: number[][] = [[close[0]]];
  for (let k = 1; k < close.length; k++) {
    if (close[k] - close[k - 1] <= 3) runs[runs.length - 1].push(close[k]);
    else runs.push([close[k]]);
  }
  // A pass that straddles the start line shows up as a run at each end: join them.
  if (runs.length > 1 && runs[0][0] + n - runs[runs.length - 1][runs[runs.length - 1].length - 1] <= 3) {
    runs[0] = [...(runs.pop() ?? []), ...runs[0]];
  }
  return runs.map((run) => {
    let best = run[0];
    let bestD = Infinity;
    for (const i of run) {
      const p = c.points[i];
      const d = (p.x - x) ** 2 + (p.y - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { i: best, d: Math.sqrt(bestD) };
  });
}

/**
 * Ground height that one pass of the road asks for at (x, z), and how far the
 * point is beyond that pass's shoulder (0 = on the road or its shoulder).
 */
function passHeight(c: Centerline, i: number, x: number, z: number): { h: number; away: number } {
  const p = c.points[i];
  const t = c.tangents[i];
  const l = leftOf(t);
  const lateral = (x - p.x) * l.x + (z - p.y) * l.y;
  // Along the road the height follows the grade from the nearest sample (samples are 2.5 m apart).
  const along = (x - p.x) * t.x + (z - p.y) * t.y;
  // The shoulder out to the barrier line follows the road's bank; beyond it the ground blends away.
  const band = c.wallOffset + 0.5;
  const edge = Math.max(-band, Math.min(band, lateral));
  // Just under the road surface, so the road sits flush in the ground.
  const roadH = surfaceY(c, i, edge) + c.grade[i] * along - 0.03;
  const away = Math.max(0, Math.abs(lateral) - band, Math.abs(along) - c.spacing);
  return { h: roadH * (1 - smoothstep(0, BLEND, away)), away };
}

function buildTerrain(c: Centerline, grid: SampleGrid): Terrain {
  const { x0, z0 } = TERRAIN_RECT;
  const step = TERRAIN_STEP;
  const nx = Math.round((TERRAIN_RECT.x1 - x0) / step) + 1;
  const nz = Math.round((TERRAIN_RECT.z1 - z0) / step) + 1;
  const h = new Float32Array(nx * nz);
  const reach = c.wallOffset + BLEND + 2;
  const tmp: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const passes = nearestPerPass(c, x, z, grid.near(x, z, reach, tmp), reach);
      if (!passes.length) continue;
      // On a road's own shoulder, that road decides (so a road on a hill keeps its
      // embankment even next to a lower stretch). Where shoulders overlap (under a
      // bridge) the lowest wins, so the ground follows the road underneath. Between
      // roads the ground slopes from one to the other.
      let own = Infinity;
      let sum = 0;
      let wsum = 0;
      for (const ps of passes) {
        const q = passHeight(c, ps.i, x, z);
        if (q.away <= 0) own = Math.min(own, q.h);
        const w = 1 / (1 + q.away) ** 2;
        sum += q.h * w;
        wsum += w;
      }
      h[j * nx + i] = own < Infinity ? own : sum / wsum;
    }
  }
  return { x0, z0, step, nx, nz, h };
}

/**
 * Makes sure the ground never pokes through the road: checks points across the
 * road every half sample, out to its real edges (pulled in on the inside of
 * hairpins) and over the kerbs on the side that has them, and wherever the
 * interpolated ground comes up through the surface, lowers the four grid
 * corners around it. Checking only where there really is road keeps it from
 * digging pits inside tight banked corners.
 */
function pressUnderRoad(t: Terrain, c: Centerline, kerbs: KerbLayout): void {
  const n = c.points.length;
  const { left, right } = edgeOffsets(c);
  const margin = 0.03;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const l = leftOf(c.tangents[i]);
      for (const f of [0, 0.5]) {
        const cx = c.points[i].x + (c.points[j].x - c.points[i].x) * f;
        const cz = c.points[i].y + (c.points[j].y - c.points[i].y) * f;
        const lo = -Math.max(Math.min(right[i], right[j]), kerbAt(kerbs, i, -1)?.[1] ?? 0);
        const hi = Math.max(Math.min(left[i], left[j]), kerbAt(kerbs, i, 1)?.[1] ?? 0);
        for (let k = 0; k <= 8; k++) {
          const lat = lo + ((hi - lo) * k) / 8;
          const x = cx + l.x * lat;
          const z = cz + l.y * lat;
          const road = surfaceY(c, i, lat) * (1 - f) + surfaceY(c, j, lat) * f - margin;
          const excess = terrainHeight(t, x, z) - road;
          if (excess <= 0) continue;
          const fx = (x - t.x0) / t.step;
          const fz = (z - t.z0) / t.step;
          const gi = Math.floor(fx);
          const gj = Math.floor(fz);
          if (gi < 0 || gj < 0 || gi >= t.nx - 1 || gj >= t.nz - 1) continue;
          // Lower each corner by its share (the smallest change that gets this point under
          // the road), so grid points well away from the road hardly move: no trough beside it.
          const u = fx - gi;
          const v = fz - gj;
          const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
          const w2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3];
          const base = gj * t.nx + gi;
          [0, 1, t.nx, t.nx + 1].forEach((o, k) => (t.h[base + o] -= (excess * w[k]) / w2 + 0.001));
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

/** A level pad under the pit lane and garages, at the height of the road edge beside it. */
function padForPits(t: Terrain, c: Centerline, pits: PitLayout): void {
  const n = c.points.length;
  for (let s = pits.from - 10; s <= pits.to + 10; s += 2.5) {
    const { p, t: tan } = sampleAt(c, s);
    const i = ((Math.round(s / c.spacing) % n) + n) % n;
    const y = surfaceY(c, i, c.wallOffset * pits.side) - 0.1;
    const l = leftOf(tan);
    for (let lat = c.wallOffset + 0.5; lat <= pits.building[1] + 5; lat += 2.5) {
      const x = p.x + l.x * lat * pits.side;
      const z = p.y + l.y * lat * pits.side;
      const gi = Math.round((x - t.x0) / t.step);
      const gj = Math.round((z - t.z0) / t.step);
      if (gi < 0 || gj < 0 || gi >= t.nx || gj >= t.nz) continue;
      t.h[gj * t.nx + gi] = y;
    }
  }
}

/** Bilinear terrain height at (x, z); flat (0) outside the grid. */
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const fx = (x - t.x0) / t.step;
  const fz = (z - t.z0) / t.step;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return 0;
  const u = fx - i;
  const v = fz - j;
  const k = j * t.nx + i;
  const a = t.h[k] + (t.h[k + 1] - t.h[k]) * u;
  const b = t.h[k + t.nx] + (t.h[k + t.nx + 1] - t.h[k + t.nx]) * u;
  return a + (b - a) * v;
}

const cache = new WeakMap<Track, TrackSurface>();

export function surfaceFor(track: Track): TrackSurface {
  const hit = cache.get(track);
  if (hit) return hit;
  const c = track.center;
  const n = c.points.length;
  const grid = new SampleGrid(c, 20);
  const terrain = buildTerrain(c, grid);
  const pits = pitLayout(track);
  if (pits) padForPits(terrain, c, pits);
  pressUnderRoad(terrain, c, kerbLayout(track));

  // Raised decks: road well above the ground below it.
  const deck = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = c.points[i];
    deck[i] = c.height[i] - terrainHeight(terrain, p.x, p.y) > TRACK.deckClearance ? 1 : 0;
  }
  // Widen decks a little so the bridge mesh and rails start before the drop.
  const deckW = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (deck[i]) for (let o = -3; o <= 3; o++) deckW[wrap(i + o, n)] = 1;

  // Barriers: everywhere if the track has walls, always on decks; but leave a gap
  // where the barrier would stand on another stretch of road at a similar height.
  const wallL = new Uint8Array(n);
  const wallR = new Uint8Array(n);
  const hw = c.width / 2;
  const tmp: number[] = [];
  const blocked = (i: number, side: 1 | -1): boolean => {
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    const wx = p.x + l.x * c.wallOffset * side;
    const wz = p.y + l.y * c.wallOffset * side;
    const y = surfaceY(c, i, c.wallOffset * side);
    const clear = hw + 2.5;
    for (const j of grid.near(wx, wz, clear + 20, tmp)) {
      const ring = Math.min(Math.abs(j - i), n - Math.abs(j - i));
      if (ring * c.spacing < 30) continue; // this stretch itself
      const q = c.points[j];
      if ((q.x - wx) ** 2 + (q.y - wz) ** 2 > clear * clear) continue;
      if (Math.abs(c.height[j] - y) < TRACK.bridgeClearance / 2) return true;
    }
    return false;
  };
  // The inside of a corner tighter than the barrier line has no room for a barrier (it would fold over).
  const tight = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    for (let o = -3; o <= 3; o++) {
      const k = c.curvature[wrap(i + o, n)];
      if (Math.abs(k) * (c.wallOffset + 1.5) > 1) tight[i] = k > 0 ? -1 : 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const want = track.options.walls || deckW[i] === 1;
    wallL[i] = want && tight[i] !== 1 && !blocked(i, 1) ? 1 : 0;
    wallR[i] = want && tight[i] !== -1 && !blocked(i, -1) ? 1 : 0;
  }
  // Grow gaps a little so cars can drive straight through crossings.
  for (const w of [wallL, wallR]) {
    const src = w.slice();
    for (let i = 0; i < n; i++) if (!src[i]) for (let o = -4; o <= 4; o++) w[wrap(i + o, n)] = 0;
    // ...but never leave a deck without rails.
    for (let i = 0; i < n; i++) if (deck[i] && src[i]) w[i] = 1;
  }

  // Pillars under decks, about every 12 m, but never standing on a road passing underneath.
  const pillars: TrackSurface['pillars'] = [];
  const every = Math.max(1, Math.round(12 / c.spacing));
  const keepOff = hw + TRACK.kerbWidth + 1.5;
  const onRoadBelow = (i: number): boolean => {
    const p = c.points[i];
    for (const j of grid.near(p.x, p.y, keepOff + 20, tmp)) {
      const ring = Math.min(Math.abs(j - i), n - Math.abs(j - i));
      if (ring * c.spacing < 30) continue;
      const q = c.points[j];
      if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < keepOff * keepOff) return true;
    }
    return false;
  };
  for (let i = 0; i < n; i += every) {
    const p = c.points[i];
    const ground = terrainHeight(terrain, p.x, p.y);
    if (deck[i] && c.height[i] - ground > 2.5 && !onRoadBelow(i)) pillars.push({ x: p.x, z: p.y, y0: ground - 0.5, y1: c.height[i] - 0.6 });
  }

  const surf: TrackSurface = { terrain, deck: deckW, wallL, wallR, pillars };
  cache.set(track, surf);
  return surf;
}
