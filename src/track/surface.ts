import { TRACK, WORLD } from '../config/track.ts';
import { wrap } from '../core/math.ts';
import { leftOf, surfaceY, type Centerline } from './spline.ts';
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

/** Ground height that one pass of the road asks for at (x, z). */
function passHeight(c: Centerline, i: number, x: number, z: number): number {
  const p = c.points[i];
  const t = c.tangents[i];
  const l = leftOf(t);
  const lateral = (x - p.x) * l.x + (z - p.y) * l.y;
  // Along the road the height follows the grade from the nearest sample (samples are 2.5 m apart).
  const along = (x - p.x) * t.x + (z - p.y) * t.y;
  // The shoulder out to the barrier line follows the road's bank; beyond it the ground blends away.
  const band = TRACK.wallOffset + 0.5;
  const edge = Math.max(-band, Math.min(band, lateral));
  const roadH = surfaceY(c, i, edge) + c.grade[i] * along - 0.1;
  const away = Math.max(0, Math.abs(lateral) - band);
  return roadH * (1 - smoothstep(0, BLEND, away));
}

function buildTerrain(c: Centerline, grid: SampleGrid): Terrain {
  const { x0, z0 } = TERRAIN_RECT;
  const step = TERRAIN_STEP;
  const nx = Math.round((TERRAIN_RECT.x1 - x0) / step) + 1;
  const nz = Math.round((TERRAIN_RECT.z1 - z0) / step) + 1;
  const h = new Float32Array(nx * nz);
  const reach = TRACK.wallOffset + BLEND + 2;
  const tmp: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const passes = nearestPerPass(c, x, z, grid.near(x, z, reach, tmp), reach);
      if (!passes.length) continue;
      // The lowest pass wins, so a bridge's ground follows the road underneath it.
      let y = Infinity;
      for (const ps of passes) y = Math.min(y, passHeight(c, ps.i, x, z));
      h[j * nx + i] = y;
    }
  }
  return { x0, z0, step, nx, nz, h };
}

/**
 * Makes sure the ground never pokes through the road: checks points across the
 * road (kerbs included) every half sample, and wherever the interpolated ground
 * comes up through the surface, lowers the four grid corners around it.
 */
function pressUnderRoad(t: Terrain, c: Centerline): void {
  const n = c.points.length;
  const hw = TRACK.roadWidth / 2 + TRACK.kerbWidth;
  const margin = 0.04;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const l = leftOf(c.tangents[i]);
      for (const f of [0, 0.5]) {
        const cx = c.points[i].x + (c.points[j].x - c.points[i].x) * f;
        const cz = c.points[i].y + (c.points[j].y - c.points[i].y) * f;
        for (let k = -4; k <= 4; k++) {
          const lat = (hw * k) / 4;
          const x = cx + l.x * lat;
          const z = cz + l.y * lat;
          const road = surfaceY(c, i, lat) * (1 - f) + surfaceY(c, j, lat) * f - margin;
          const excess = terrainHeight(t, x, z) - road;
          if (excess <= 0) continue;
          const gi = Math.floor((x - t.x0) / t.step);
          const gj = Math.floor((z - t.z0) / t.step);
          if (gi < 0 || gj < 0 || gi >= t.nx - 1 || gj >= t.nz - 1) continue;
          const base = gj * t.nx + gi;
          for (const o of [0, 1, t.nx, t.nx + 1]) t.h[base + o] -= excess;
          changed = true;
        }
      }
    }
    if (!changed) break;
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
  pressUnderRoad(terrain, c);

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
  const hw = TRACK.roadWidth / 2;
  const tmp: number[] = [];
  const blocked = (i: number, side: 1 | -1): boolean => {
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    const wx = p.x + l.x * TRACK.wallOffset * side;
    const wz = p.y + l.y * TRACK.wallOffset * side;
    const y = surfaceY(c, i, TRACK.wallOffset * side);
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
  for (let i = 0; i < n; i++) {
    const want = track.options.walls || deckW[i] === 1;
    wallL[i] = want && !blocked(i, 1) ? 1 : 0;
    wallR[i] = want && !blocked(i, -1) ? 1 : 0;
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
