import { CONTACT } from '../config/race.ts';
import type { CarState } from './physics.ts';

const HL = CONTACT.halfLength;
const HW = CONTACT.halfWidth;
/** Moment of inertia of a uniform box of mass 1 about its centre (yaw). */
const INERTIA = ((2 * HL) ** 2 + (2 * HW) ** 2) / 12;
/** Furthest two touching cars' centres can be apart. */
const REACH = 2 * Math.hypot(HL, HW);

interface Box {
  x: number;
  z: number;
  /** Forward and left unit vectors. */
  fx: number;
  fz: number;
  sx: number;
  sz: number;
}

const box = (c: CarState): Box => {
  const fx = Math.cos(c.heading);
  const fz = Math.sin(c.heading);
  return { x: c.x, z: c.z, fx, fz, sx: fz, sz: -fx };
};

/** Half the box's extent along unit axis (ux, uz). */
const radius = (b: Box, ux: number, uz: number) => HL * Math.abs(b.fx * ux + b.fz * uz) + HW * Math.abs(b.sx * ux + b.sz * uz);

/** Is point (px, pz) inside box b (with a little slack)? */
const inside = (b: Box, px: number, pz: number) => {
  const dx = px - b.x;
  const dz = pz - b.z;
  return Math.abs(dx * b.fx + dz * b.fz) <= HL + 0.02 && Math.abs(dx * b.sx + dz * b.sz) <= HW + 0.02;
};

const corners = (b: Box): [number, number][] => {
  const out: [number, number][] = [];
  for (const f of [HL, -HL]) for (const s of [HW, -HW]) out.push([b.x + b.fx * f + b.sx * s, b.z + b.fz * f + b.sz * s]);
  return out;
};

/** Least overlap of two boxes and its axis (normal from A towards B), or null if they don't touch. */
function overlapOf(A: Box, B: Box): { depth: number; nx: number; nz: number; onA: boolean } | null {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  let depth = Infinity;
  let nx = 0;
  let nz = 0;
  let onA = true;
  const axes: [number, number, boolean][] = [
    [A.fx, A.fz, true],
    [A.sx, A.sz, true],
    [B.fx, B.fz, false],
    [B.sx, B.sz, false],
  ];
  for (const [ux, uz, fromA] of axes) {
    const d = dx * ux + dz * uz;
    const overlap = radius(A, ux, uz) + radius(B, ux, uz) - Math.abs(d);
    if (overlap <= 0) return null;
    if (overlap < depth) {
      depth = overlap;
      const sign = d >= 0 ? 1 : -1;
      nx = ux * sign;
      nz = uz * sign;
      onA = fromA;
    }
  }
  return { depth, nx, nz, onA };
}

/** How deep two car bodies overlap (m), 0 if they don't (or are at different heights). */
export function carOverlap(a: CarState, b: CarState): number {
  if (Math.abs(a.y - b.y) > CONTACT.heightGap) return 0;
  return overlapOf(box(a), box(b))?.depth ?? 0;
}

/**
 * Car-to-car contact between two car bodies, each a box the size of the car,
 * turned with it. If they overlap (separating-axis test on the four box
 * sides), they are pushed apart along the axis of least overlap, half each,
 * and an impulse at the point of contact stops them closing: a small bounce,
 * plus friction along the contact so a side-swipe drags. The impulse acts at
 * the contact point, so a hit on the nose or tail turns a car, and a square
 * hit pushes it straight. Cars far apart in height (on and under a bridge)
 * never touch. Returns the closing speed of the hit (0 = none), for sound
 * and camera shake.
 */
export function collideCars(a: CarState, b: CarState): number {
  if (Math.abs(a.y - b.y) > CONTACT.heightGap) return 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) > REACH || Math.abs(dz) > REACH) return 0;
  const A = box(a);
  const B = box(b);
  // Separating axes: the sides of both boxes; the one with the least overlap is the normal.
  const hit = overlapOf(A, B);
  if (!hit) return 0;
  const { depth, nx, nz, onA } = hit;
  // Contact point: the middle of the overlap, i.e. of the corners of each box that are inside
  // the other. (If none are, the boxes cross edge to edge: use the deepest corner.)
  let cx = 0;
  let cz = 0;
  let count = 0;
  for (const [px, pz] of corners(B)) if (inside(A, px, pz)) (cx += px), (cz += pz), count++;
  for (const [px, pz] of corners(A)) if (inside(B, px, pz)) (cx += px), (cz += pz), count++;
  if (count === 0) {
    const pts = onA ? corners(B) : corners(A);
    const dir = onA ? -1 : 1; // B's corners poke into A against the normal; A's along it
    let best = -Infinity;
    for (const [px, pz] of pts) {
      const d = (px * nx + pz * nz) * dir;
      if (d > best) {
        best = d;
        cx = px;
        cz = pz;
      }
    }
    count = 1;
  }
  cx /= count;
  cz /= count;

  // Push apart, half each.
  a.x -= (nx * depth) / 2;
  a.z -= (nz * depth) / 2;
  b.x += (nx * depth) / 2;
  b.z += (nz * depth) / 2;

  // Impulse at the contact point (equal masses of 1). A point r from the centre
  // moves at v + yawRate × (-r.z, r.x).
  const rax = cx - a.x;
  const raz = cz - a.z;
  const rbx = cx - b.x;
  const rbz = cz - b.z;
  const vax = a.vx - a.yawRate * raz;
  const vaz = a.vz + a.yawRate * rax;
  const vbx = b.vx - b.yawRate * rbz;
  const vbz = b.vz + b.yawRate * rbx;
  const rvx = vbx - vax;
  const rvz = vbz - vaz;
  const closing = -(rvx * nx + rvz * nz);
  if (closing <= 0) return 0; // already moving apart
  const raN = rax * nz - raz * nx;
  const rbN = rbx * nz - rbz * nx;
  const j = ((1 + CONTACT.restitution) * closing) / (2 + (raN * raN + rbN * rbN) / INERTIA);
  // Friction along the contact, at most `friction` × the push.
  const tx = -nz;
  const tz = nx;
  const slide = rvx * tx + rvz * tz;
  const raT = rax * tz - raz * tx;
  const rbT = rbx * tz - rbz * tx;
  const jtFull = -slide / (2 + (raT * raT + rbT * rbT) / INERTIA);
  const jt = Math.max(-CONTACT.friction * j, Math.min(CONTACT.friction * j, jtFull));
  // Total impulse on b is +(j n + jt t); on a, the opposite.
  const ix = nx * j + tx * jt;
  const iz = nz * j + tz * jt;
  a.vx -= ix;
  a.vz -= iz;
  b.vx += ix;
  b.vz += iz;
  a.yawRate -= (CONTACT.spin * (rax * iz - raz * ix)) / INERTIA;
  b.yawRate += (CONTACT.spin * (rbx * iz - rbz * ix)) / INERTIA;
  return closing;
}
