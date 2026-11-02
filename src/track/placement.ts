import { THEMES } from '../config/themes.ts';
import { TRACK } from '../config/track.ts';
import { dist2, wrap, type Vec2 } from '../core/math.ts';
import { hashString, rng, valueNoise } from '../core/random.ts';
import { leftOf, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

/**
 * Where scenery goes, as plain data (no Three.js), so the physics can collide
 * with the same trees the renderer draws. Seeded from the track id, so a track
 * always gets the same scenery.
 */
export interface TreeSpot {
  x: number;
  z: number;
  scale: number;
  rot: number;
  /** Which of the theme's two prop kinds (see THEMES[theme].props). */
  kind: 0 | 1;
  shade: number;
  /** Collision radius (m). */
  radius: number;
}

/** True if `p` is at least `clearance` metres from every centre-line point. */
function clearOfTrack(c: Centerline, p: Vec2, clearance: number): boolean {
  const c2 = clearance * clearance;
  for (const q of c.points) if (dist2(p, q) < c2) return false;
  return true;
}

const treeCache = new WeakMap<Track, TreeSpot[]>();
const coneCache = new WeakMap<Track, Vec2[]>();

/** Trees on a jittered grid, clustered into woods by noise and kept clear of the road. */
export function placeTrees(track: Track): TreeSpot[] {
  const cached = treeCache.get(track);
  if (cached) return cached;
  const seed = hashString(track.def.id);
  const rand = rng(seed);
  const c = track.center;
  const clearance = TRACK.wallOffset + 6;
  const radius = THEMES[track.options.theme].propRadius;
  const step = 15;
  const extentX = 600;
  const extentZ = 420;
  const spots: TreeSpot[] = [];
  for (let gx = -extentX; gx <= extentX; gx += step) {
    for (let gz = -extentZ; gz <= extentZ; gz += step) {
      const x = gx + (rand() - 0.5) * step * 0.9;
      const z = gz + (rand() - 0.5) * step * 0.9;
      const wood = valueNoise(x / 110, z / 110, seed & 0xffff);
      // Thinner beyond the drawable area: those trees are small and fogged anyway.
      const far = Math.abs(x) > 420 || Math.abs(z) > 260 ? 0.5 : 1;
      const chance = (wood > 0.55 ? 0.7 : wood > 0.42 ? 0.2 : 0.035) * far;
      if (rand() > chance) continue;
      if (!clearOfTrack(c, { x, y: z }, clearance)) continue;
      const kind = wood > 0.5 ? (rand() < 0.75 ? 0 : 1) : rand() < 0.35 ? 0 : 1;
      const scale = 0.75 + rand() * 0.7;
      spots.push({ x, z, scale, rot: rand() * Math.PI * 2, kind, shade: 0.8 + rand() * 0.35, radius: radius[kind] * scale });
    }
  }
  treeCache.set(track, spots);
  return spots;
}

/** Three cones just beyond the outside kerb at the apex of every tight corner. */
export function placeCones(track: Track): Vec2[] {
  const cached = coneCache.get(track);
  if (cached) return cached;
  const c = track.center;
  const n = c.points.length;
  const off = TRACK.roadWidth / 2 + TRACK.kerbWidth + 2.2;
  const spots: Vec2[] = [];
  for (const corner of track.tightCorners) {
    const side = corner.sign > 0 ? 1 : -1;
    for (const o of [-3, 0, 3]) {
      const i = wrap(corner.apex + o, n);
      const l = leftOf(c.tangents[i]);
      const p = { x: c.points[i].x + l.x * off * side, y: c.points[i].y + l.y * off * side };
      if (clearOfTrack(c, p, TRACK.roadWidth / 2 + 1.5)) spots.push(p);
    }
  }
  coneCache.set(track, spots);
  return spots;
}
