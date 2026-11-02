import { TRACK } from '../config/track.ts';
import { surfaceY } from './spline.ts';
import { terrainHeight, type TrackSurface } from './surface.ts';
import type { Track } from './track.ts';
import type { TrackPos } from './locator.ts';

/** Height of the ground under a car and how it tilts the car. */
export interface GroundPose {
  y: number;
  /** Nose-up angle (rad). */
  pitch: number;
  /** Left-side-up angle (rad). */
  roll: number;
}

/**
 * Ground under a car at (x, z) facing `heading`, given where it is on the track.
 * On the road (out to the barrier line) it follows the road surface, smoothly
 * interpolated between centre-line samples so climbs don't stair-step; off the
 * road it follows the terrain. Shared by the physics and the ghost car.
 */
export function groundPose(track: Track, surf: TrackSurface, x: number, z: number, heading: number, pos: TrackPos, out: GroundPose): GroundPose {
  const c = track.center;
  const n = c.points.length;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  if (Math.abs(pos.lateral) <= TRACK.wallOffset + 0.5) {
    const i = Math.max(0, pos.index);
    const j = (i + 1) % n;
    let f = pos.s / c.spacing - i;
    if (f < -1) f += n;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const t = c.tangents[i];
    const along = cos * t.x + sin * t.y;
    out.y = surfaceY(c, i, pos.lateral) * (1 - f) + surfaceY(c, j, pos.lateral) * f;
    out.pitch = Math.atan((c.grade[i] * (1 - f) + c.grade[j] * f) * along);
    out.roll = (c.bank[i] * (1 - f) + c.bank[j] * f) * along;
  } else {
    const tr = surf.terrain;
    out.y = terrainHeight(tr, x, z);
    const ahead = terrainHeight(tr, x + cos * 1.5, z + sin * 1.5) - terrainHeight(tr, x - cos * 1.5, z - sin * 1.5);
    const left = terrainHeight(tr, x + sin, z - cos) - terrainHeight(tr, x - sin, z + cos);
    out.pitch = Math.atan(ahead / 3);
    out.roll = Math.atan(left / 2);
  }
  return out;
}
