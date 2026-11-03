import { CONTACT } from '../config/race.ts';
import type { CarState } from './physics.ts';

/**
 * Car-to-car contact. Each car is two overlapping circles along its length
 * (nose and tail). Overlapping cars are pushed apart, half each, and their
 * closing speed along the contact is cancelled with a small bounce; an
 * off-centre hit also turns them a little. Returns the closing speed of the
 * hardest contact (0 = none), for sound and camera shake.
 */
export function collideCars(a: CarState, b: CarState): number {
  const { radius, offset, restitution } = CONTACT;
  const reach = (radius + offset) * 2;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) return 0;
  const ca = Math.cos(a.heading);
  const sa = Math.sin(a.heading);
  const cb = Math.cos(b.heading);
  const sb = Math.sin(b.heading);
  let hardest = 0;
  for (const fa of [offset, -offset]) {
    for (const fb of [offset, -offset]) {
      const ax = a.x + ca * fa;
      const az = a.z + sa * fa;
      const bx = b.x + cb * fb;
      const bz = b.z + sb * fb;
      const dx = bx - ax;
      const dz = bz - az;
      const d2 = dx * dx + dz * dz;
      const min = radius * 2;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = d2 > 1e-12 ? dx / d : 1;
      const nz = d2 > 1e-12 ? dz / d : 0;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing <= 0) continue;
      const j = (closing * (1 + restitution)) / 2;
      a.vx -= nx * j;
      a.vz -= nz * j;
      b.vx += nx * j;
      b.vz += nz * j;
      // Hit away from the middle: a nudge of rotation (nose hits turn the car most).
      const turnA = (ca * nz - sa * nx) * Math.sign(fa) * j * 0.08;
      const turnB = (cb * nz - sb * nx) * Math.sign(fb) * j * 0.08;
      a.yawRate -= turnA;
      b.yawRate += turnB;
      hardest = Math.max(hardest, closing);
    }
  }
  return hardest;
}
