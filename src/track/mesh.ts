import { BufferGeometry, Color, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { TRACK } from '../config/track.ts';
import { wrap } from '../core/math.ts';
import { QuadBuilder } from '../render/geom.ts';
import { leftOf, surfaceY, type Centerline } from './spline.ts';
import type { TrackSurface } from './surface.ts';
import type { Track } from './track.ts';

/** Height of the road surface above the ground it sits on. */
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
 * Extrudes the road ribbon along the closed centre line, following its height
 * and banking. Track coordinates (x east, y south) map to world (x, z). U runs
 * across the road (0 = left edge), V along it; the loop gets one duplicated row
 * so V can end on a whole number of tiles without a seam.
 *
 * Returns two geometries sharing the vertices: the road on the ground, and the
 * raised decks (bridges), which are drawn separately so they cover a road
 * passing underneath.
 */
export function buildRoadGeometry(c: Centerline, surf: TrackSurface): { ground: BufferGeometry; deck: BufferGeometry | null } {
  const n = c.points.length;
  const tiles = Math.max(1, Math.round(c.length / TRACK.roadWidth));
  const rows = n + 1;
  const pos = new Float32Array(rows * 2 * 3);
  const uv = new Float32Array(rows * 2 * 2);
  const { left, right } = edgeOffsets(c);
  for (let r = 0; r < rows; r++) {
    const i = r % n;
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    const v = (r / n) * tiles;
    const yl = surfaceY(c, i, left[i]) + ROAD_Y;
    const yr = surfaceY(c, i, -right[i]) + ROAD_Y;
    pos.set([p.x + l.x * left[i], yl, p.y + l.y * left[i], p.x - l.x * right[i], yr, p.y - l.y * right[i]], r * 6);
    uv.set([0, v, 1, v], r * 4);
  }
  const groundIdx: number[] = [];
  const deckIdx: number[] = [];
  for (let r = 0; r < n; r++) {
    const a = r * 2; // left, this row
    const b = a + 1; // right, this row
    const c2 = a + 2; // left, next row
    const d = a + 3; // right, next row
    (surf.deck[r] || surf.deck[(r + 1) % n] ? deckIdx : groundIdx).push(a, b, c2, b, d, c2);
  }
  const position = new Float32BufferAttribute(pos, 3);
  const uvAttr = new Float32BufferAttribute(uv, 2);
  const make = (idx: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('uv', uvAttr);
    g.setIndex(new Uint32BufferAttribute(Uint32Array.from(idx), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  return { ground: make(groundIdx), deck: deckIdx.length ? make(deckIdx) : null };
}

const KERB_RED = 0xd8342c;
const KERB_WHITE = 0xf4f4f0;
/** Centre-line samples per kerb stripe (~2.5 m). */
const STRIPE = 1;
/** Extra samples of kerb before and after each corner run. */
const KERB_EXTEND = 3;

/**
 * Red/white kerbs on the outside edge of every corner in `track.kerbs`, sitting
 * on the (possibly banked, raised) road: road edge -> crown -> outer edge.
 */
export function buildKerbGeometry(track: Track): BufferGeometry | null {
  const c = track.center;
  const n = c.points.length;
  const hw = TRACK.roadWidth / 2;
  const kw = TRACK.kerbWidth;
  const q = new QuadBuilder();
  // Lateral offsets and lift above the road surface of the profile's three edges.
  const profile = [
    { off: hw - 0.15, lift: ROAD_Y + 0.01 },
    { off: hw + kw * 0.45, lift: 0.11 },
    { off: hw + kw, lift: 0.025 },
  ];
  const at = (i: number, side: number, k: number) => {
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    const e = profile[k];
    return new Vector3(p.x + l.x * e.off * side, surfaceY(c, i, e.off * side) + e.lift, p.y + l.y * e.off * side);
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

/** Flat-coloured quads of any orientation (rendered double-sided). */
class Panels {
  private pos: number[] = [];
  private col: number[] = [];
  private readonly c = new Color();
  quad(a: number[], b: number[], cc: number[], d: number[], hex: number): void {
    this.c.setHex(hex);
    for (const v of [a, b, cc, a, cc, d]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }
  get empty(): boolean {
    return this.pos.length === 0;
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

const CONCRETE = 0xc9ccd2;
const CONCRETE_DARK = 0x9ea2aa;
const WALL_RED = 0xd8342c;
const WALL_WHITE = 0xf2f2ee;

/**
 * Barriers along the road edges (where the surface data says so) and the sides
 * of raised decks, as one vertex-coloured mesh. Barrier tops alternate red and
 * white every ~10 m so speed reads well.
 */
export function buildWallGeometry(track: Track, surf: TrackSurface): BufferGeometry | null {
  const c = track.center;
  const n = c.points.length;
  const p = new Panels();
  const off = TRACK.wallOffset;
  const thick = 0.45;
  const hgt = TRACK.wallHeight;
  const band = Math.max(1, Math.round(10 / c.spacing));
  const at = (i: number, lateral: number, lift: number) => {
    const q = c.points[i];
    const l = leftOf(c.tangents[i]);
    return [q.x + l.x * lateral, surfaceY(c, i, lateral) + lift, q.y + l.y * lateral];
  };
  for (const side of [1, -1] as const) {
    const flags = side === 1 ? surf.wallL : surf.wallR;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!flags[i] || !flags[j]) continue;
      const inner = off * side;
      const outer = (off + thick) * side;
      const top = Math.floor(i / band) % 2 === 0 ? WALL_RED : WALL_WHITE;
      // Faces reach below the surface so banked or uneven ground never shows a gap.
      p.quad(at(i, inner, -1.2), at(j, inner, -1.2), at(j, inner, hgt), at(i, inner, hgt), CONCRETE);
      p.quad(at(i, outer, -1.2), at(j, outer, -1.2), at(j, outer, hgt), at(i, outer, hgt), CONCRETE_DARK);
      p.quad(at(i, inner, hgt), at(j, inner, hgt), at(j, outer, hgt), at(i, outer, hgt), top);
    }
  }
  // Decks: a concrete shoulder from the road edge to the rails, the slab's edge and its underside.
  const hw = TRACK.roadWidth / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!surf.deck[i] || !surf.deck[j]) continue;
    for (const side of [1, -1]) {
      p.quad(at(i, (hw - 0.2) * side, ROAD_Y * 0.5), at(j, (hw - 0.2) * side, ROAD_Y * 0.5), at(j, off * side, ROAD_Y * 0.5), at(i, off * side, ROAD_Y * 0.5), CONCRETE);
      const e = (off + thick) * side;
      p.quad(at(i, e, 0), at(j, e, 0), at(j, e, -1.1), at(i, e, -1.1), CONCRETE_DARK);
    }
    // Underside of the slab.
    p.quad(at(i, off + thick, -1.1), at(j, off + thick, -1.1), at(j, -(off + thick), -1.1), at(i, -(off + thick), -1.1), CONCRETE_DARK);
  }
  return p.empty ? null : p.build();
}
