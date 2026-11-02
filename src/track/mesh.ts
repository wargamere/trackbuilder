import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { TRACK } from '../config/track.ts';
import { wrap } from '../core/math.ts';
import { QuadBuilder } from '../render/geom.ts';
import { leftOf, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

/** Height of the road surface above the grass (the ground also uses polygon offset). */
export const ROAD_Y = 0.02;

/**
 * Half-widths of the road on each side. On the inside of a hairpin tighter than
 * half the road width the inner edge would fold back on itself, so it is pulled
 * in to just inside the corner's radius (the road narrows slightly there).
 */
export function edgeOffsets(c: Centerline): { left: Float32Array; right: Float32Array } {
  const n = c.points.length;
  const hw = TRACK.roadWidth / 2;
  const left = new Float32Array(n).fill(hw);
  const right = new Float32Array(n).fill(hw);
  const win = 3;
  for (let i = 0; i < n; i++) {
    let kMax = 0; // tightest signed curvature nearby
    for (let o = -win; o <= win; o++) {
      const k = c.curvature[wrap(i + o, n)];
      if (Math.abs(k) > Math.abs(kMax)) kMax = k;
    }
    const limit = 0.9 / Math.max(Math.abs(kMax), 1e-6);
    if (limit >= hw) continue;
    // Positive curvature = right-hander: the inside is the right edge.
    if (kMax > 0) right[i] = Math.max(0.5, limit);
    else left[i] = Math.max(0.5, limit);
  }
  return { left, right };
}

/**
 * Extrudes the road ribbon along the closed centre line. Track coordinates
 * (x east, y south) map to world (x, z). U runs across the road (0 = left
 * edge), V along it. The loop gets one duplicated row at the end so V can run
 * straight to a whole number of texture tiles without a seam.
 */
export function buildRoadGeometry(c: Centerline): BufferGeometry {
  const n = c.points.length;
  const tiles = Math.max(1, Math.round(c.length / TRACK.roadWidth));
  const rows = n + 1;
  const pos = new Float32Array(rows * 2 * 3);
  const nor = new Float32Array(rows * 2 * 3);
  const uv = new Float32Array(rows * 2 * 2);
  const { left, right } = edgeOffsets(c);
  for (let r = 0; r < rows; r++) {
    const i = r % n;
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    const v = (r / n) * tiles;
    const o = r * 6;
    pos.set([p.x + l.x * left[i], ROAD_Y, p.y + l.y * left[i], p.x - l.x * right[i], ROAD_Y, p.y - l.y * right[i]], o);
    nor.set([0, 1, 0, 0, 1, 0], o);
    uv.set([0, v, 1, v], r * 4);
  }
  const idx = new Uint32Array(n * 6);
  for (let r = 0; r < n; r++) {
    const a = r * 2; // left, this row
    const b = a + 1; // right, this row
    const c2 = a + 2; // left, next row
    const d = a + 3; // right, next row
    idx.set([a, b, c2, b, d, c2], r * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const KERB_RED = 0xd8342c;
const KERB_WHITE = 0xf4f4f0;
/** Centre-line samples per kerb stripe (~2.5 m). */
const STRIPE = 1;
/** Extra samples of kerb before and after each corner run. */
const KERB_EXTEND = 3;

/**
 * Red/white kerbs on the outside edge of every corner in `track.kerbs`. Each
 * kerb has a raised, rounded-off profile: road edge -> crown -> grass.
 */
export function buildKerbGeometry(track: Track): BufferGeometry | null {
  const c = track.center;
  const n = c.points.length;
  const hw = TRACK.roadWidth / 2;
  const kw = TRACK.kerbWidth;
  const q = new QuadBuilder();
  // Lateral offsets and heights of the profile's three edges.
  const profile = [
    { off: hw - 0.15, y: ROAD_Y + 0.01 },
    { off: hw + kw * 0.45, y: 0.11 },
    { off: hw + kw, y: 0.025 },
  ];
  const at = (i: number, side: number, k: number) => {
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    const e = profile[k];
    return new Vector3(p.x + l.x * e.off * side, e.y, p.y + l.y * e.off * side);
  };

  for (const corner of track.kerbs) {
    const side = corner.sign > 0 ? 1 : -1; // outside of a right-hander is on the left
    const from = -KERB_EXTEND;
    const to = Math.min(corner.count + KERB_EXTEND, n - 1);
    for (let j = from; j < to; j++) {
      const i0 = wrap(corner.start + j, n);
      const i1 = wrap(corner.start + j + 1, n);
      const hex = Math.floor((j - from) / STRIPE) % 2 === 0 ? KERB_RED : KERB_WHITE;
      for (let k = 0; k < 2; k++) q.quad(at(i0, side, k), at(i1, side, k), at(i1, side, k + 1), at(i0, side, k + 1), hex);
    }
  }
  return q.empty ? null : q.build();
}
