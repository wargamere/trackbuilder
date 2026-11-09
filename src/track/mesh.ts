import { BufferGeometry, Color, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { THEMES } from '../config/themes.ts';
import { OPTION_CHOICES, TRACK } from '../config/track.ts';
import { wrap } from '../core/math.ts';
import { QuadBuilder } from '../render/geom.ts';
import { runoffLayout } from './extras.ts';
import { kerbAt, kerbLayout } from './kerbs.ts';
import { pitLayout } from './pits.ts';
import { tunnelsOf } from './tunnels.ts';
import { edgeOffsets, leftOf, sampleAt, surfaceY, type Centerline } from './spline.ts';
import { terrainHeight, type TrackSurface } from './surface.ts';
import type { Track } from './track.ts';

/** Height of the road surface above the ground it sits on. */
export const ROAD_Y = 0.02;

export { edgeOffsets } from './spline.ts';

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
  const tiles = Math.max(1, Math.round(c.length / c.width));
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

/**
 * Red/white kerbs along the outside of every corner and on the inside around
 * the apex (see kerbLayout), sitting on the (possibly banked, raised) road:
 * road edge -> crown -> outer edge. Raised kerbs have a crown; flat ones are
 * just painted on.
 */
export function buildKerbGeometry(track: Track): BufferGeometry | null {
  if (track.options.kerbs === 'none') return null;
  const c = track.center;
  const n = c.points.length;
  const layout = kerbLayout(track);
  const q = new QuadBuilder();
  // Raised kerbs have a hump, flat ones barely any, painted ones are just paint on the road.
  const style = track.options.kerbs;
  const crown = style === 'raised' ? 0.11 : style === 'flat' ? 0.045 : ROAD_Y + 0.015;
  // Lift above the road surface of the profile's three edges (inner, crown, outer).
  const lifts = [ROAD_Y + 0.01, crown, style === 'painted' ? ROAD_Y + 0.01 : 0.025];
  const at = (i: number, side: 1 | -1, k: number): Vector3 | null => {
    const e = kerbAt(layout, i, side);
    if (!e) return null;
    const off = k === 0 ? e[0] : k === 1 ? e[0] + (e[1] - e[0]) * 0.5 : e[1];
    const p = c.points[i];
    const l = leftOf(c.tangents[i]);
    return new Vector3(p.x + l.x * off * side, surfaceY(c, i, off * side) + lifts[k], p.y + l.y * off * side);
  };
  for (const run of layout.runs) {
    for (let j = 0; j < run.count; j++) {
      const i0 = wrap(run.from + j, n);
      const i1 = wrap(run.from + j + 1, n);
      const hex = Math.floor(j / STRIPE) % 2 === 0 ? KERB_RED : KERB_WHITE;
      for (let k = 0; k < 2; k++) {
        const a = at(i0, run.side, k);
        const b = at(i1, run.side, k);
        const cc = at(i1, run.side, k + 1);
        const d = at(i0, run.side, k + 1);
        if (a && b && cc && d) q.quad(a, b, cc, d, hex);
      }
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

const TECPRO = [0x2357b8, 0xd23a2e, 0x2357b8, 0xf2f2ee] as const;
const ARMCO_LIGHT = 0xc9ced6;
const ARMCO_DARK = 0x8f969f;
const ARMCO_POST = 0x5b6067;
/** How thick each kind of barrier is (m). */
const BARRIER_THICK = { concrete: 0.45, tyres: 0.45, tecpro: 0.9, armco: 0.3 } as const;
const CONCRETE = 0xc9ccd2;
const CONCRETE_DARK = 0x9ea2aa;
const WALL_RED = 0xd8342c;
const WALL_WHITE = 0xf2f2ee;
/** How far the earth skirt under the road's outer edge reaches down (m). */
export const SKIRT_DEPTH = 2.6;
const TYRE = 0x2a2c31;
const TYRE_DARK = 0x1d1f23;
const TYRE_BAND = [0xd8342c, 0xf2f2ee, 0x2f6fd8, 0xf2f2ee] as const;

/**
 * Barriers along the road edges (where the surface data says so) and the sides
 * of raised decks, as one vertex-coloured mesh. Concrete barrier tops alternate
 * red and white every ~10 m so speed reads well; tyre walls are stacks of dark
 * tyres with a coloured band on top. Bridge rails are always concrete.
 */
export function buildWallGeometry(track: Track, surf: TrackSurface): BufferGeometry | null {
  const c = track.center;
  const n = c.points.length;
  const p = new Panels();
  const off = c.wallOffset;
  const style = track.options.barrier;
  const hgt = TRACK.wallHeight;
  const band = Math.max(1, Math.round(10 / c.spacing));
  /** A point `lateral` m left of sample i (and `ahead` m along the road), `lift` m above the surface there. */
  const at = (i: number, lateral: number, lift: number, ahead = 0) => {
    const q = c.points[i];
    const t = c.tangents[i];
    const l = leftOf(t);
    return [q.x + l.x * lateral + t.x * ahead, surfaceY(c, i, lateral) + lift, q.y + l.y * lateral + t.y * ahead];
  };
  /** How thick each kind of barrier is (bridge rails are always concrete). */
  const thickOf = (i: number) => (surf.deck[i] ? 0.45 : BARRIER_THICK[style]);
  for (const side of [1, -1] as const) {
    const flags = side === 1 ? surf.wallL : surf.wallR;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!flags[i] || !flags[j]) continue;
      const kind = surf.deck[i] ? 'concrete' : style;
      const inner = off * side;
      const outer = (off + thickOf(i)) * side;
      // Faces reach below the surface so banked or uneven ground never shows a gap.
      const block = (face: number, back: number, top: number, h: number) => {
        p.quad(at(i, inner, -1.2), at(j, inner, -1.2), at(j, inner, h), at(i, inner, h), face);
        p.quad(at(i, outer, -1.2), at(j, outer, -1.2), at(j, outer, h), at(i, outer, h), back);
        p.quad(at(i, inner, h), at(j, inner, h), at(j, outer, h), at(i, outer, h), top);
      };
      if (kind === 'tyres') {
        block(i % 2 ? TYRE : TYRE_DARK, TYRE_DARK, TYRE_BAND[Math.floor(i / band) % TYRE_BAND.length], hgt);
      } else if (kind === 'tecpro') {
        // Big foam blocks, one per sample, alternating colours, a little taller than a wall.
        const colour = TECPRO[i % TECPRO.length];
        block(colour, new Color(colour).multiplyScalar(0.7).getHex(), new Color(colour).lerp(new Color(0xffffff), 0.25).getHex(), 1.1);
      } else if (kind === 'armco') {
        // A steel W-beam rail on posts: light, dark, light bands for the corrugation.
        const rails: [number, number, number][] = [
          [0.48, 0.58, ARMCO_LIGHT],
          [0.58, 0.68, ARMCO_DARK],
          [0.68, 0.78, ARMCO_LIGHT],
        ];
        for (const [y0, y1, col] of rails) p.quad(at(i, inner, y0), at(j, inner, y0), at(j, inner, y1), at(i, inner, y1), col);
        p.quad(at(i, inner, 0.78), at(j, inner, 0.78), at(j, inner + 0.08 * side, 0.78), at(i, inner + 0.08 * side, 0.78), ARMCO_LIGHT);
        if (i % 2 === 0) {
          // A post just behind the rail.
          const a = inner + 0.08 * side;
          const b = inner + 0.24 * side;
          const w = 0.08;
          p.quad(at(i, a, -0.6, -w), at(i, a, -0.6, w), at(i, a, 0.74, w), at(i, a, 0.74, -w), ARMCO_POST);
          p.quad(at(i, b, -0.6, -w), at(i, b, -0.6, w), at(i, b, 0.74, w), at(i, b, 0.74, -w), ARMCO_POST);
          p.quad(at(i, a, -0.6, -w), at(i, b, -0.6, -w), at(i, b, 0.74, -w), at(i, a, 0.74, -w), ARMCO_POST);
          p.quad(at(i, a, -0.6, w), at(i, b, -0.6, w), at(i, b, 0.74, w), at(i, a, 0.74, w), ARMCO_POST);
        }
      } else {
        block(CONCRETE, CONCRETE_DARK, Math.floor(i / band) % 2 === 0 ? WALL_RED : WALL_WHITE, hgt);
      }
    }
    // Close the ends where a barrier stops (gaps at crossings, the inside of hairpins).
    for (let i = 0; i < n; i++) {
      const prev = flags[(i - 1 + n) % n];
      const next = flags[(i + 1) % n];
      if (!flags[i] || (prev && next)) continue;
      if (!prev && !next) continue; // a lone sample draws no barrier at all
      const kind = surf.deck[i] ? 'concrete' : style;
      if (kind === 'armco') continue; // a rail just ends
      const inner = off * side;
      const outer = (off + thickOf(i)) * side;
      const h = kind === 'tecpro' ? 1.1 : hgt;
      p.quad(at(i, inner, -1.2), at(i, outer, -1.2), at(i, outer, h), at(i, inner, h), kind === 'tyres' ? TYRE_DARK : kind === 'tecpro' ? TECPRO[0] : CONCRETE_DARK);
    }
  }
  // A short earth skirt down from the outer edge of the road surface (kerb or
  // run-off included), so where the ground falls away there is never a gap under it.
  const { left, right } = edgeOffsets(c);
  const kerbs = kerbLayout(track);
  // The skirt takes the colour of the ground, so where it shows it looks like the bank of earth.
  const skirt = new Color(THEMES[track.options.theme].ground.base).multiplyScalar(0.72).getHex();
  const lay = runoffLayout(track);
  const outerEdge = (i: number, side: 1 | -1) => {
    const e = side === 1 ? left[i] : right[i];
    // (Grass is run-off index 0: the ground itself.)
    if ((side === 1 ? lay.left : lay.right)[i] !== 0) {
      const k = Math.abs(c.curvature[i]);
      const inside = (c.curvature[i] > 0 && side === -1) || (c.curvature[i] < 0 && side === 1);
      return inside ? Math.max(e, Math.min(c.wallOffset + 0.4, 0.9 / Math.max(1e-6, k))) : c.wallOffset + 0.4;
    }
    return kerbAt(kerbs, i, side)?.[1] ?? e;
  };
  for (const side of [1, -1] as const) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (surf.deck[i] || surf.deck[j]) continue;
      const ei = outerEdge(i, side) * side;
      const ej = outerEdge(j, side) * side;
      p.quad(at(i, ei, ROAD_Y), at(j, ej, ROAD_Y), at(j, ej, -SKIRT_DEPTH), at(i, ei, -SKIRT_DEPTH), skirt);
    }
  }

  // Decks: a concrete shoulder from the road edge to the rails, the slab's edge and its underside.
  const hw = c.width / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!surf.deck[i] || !surf.deck[j]) continue;
    for (const side of [1, -1]) {
      p.quad(at(i, (hw - 0.2) * side, ROAD_Y * 0.5), at(j, (hw - 0.2) * side, ROAD_Y * 0.5), at(j, off * side, ROAD_Y * 0.5), at(i, off * side, ROAD_Y * 0.5), CONCRETE);
      const e = (off + 0.45) * side;
      p.quad(at(i, e, 0), at(j, e, 0), at(j, e, -1.1), at(i, e, -1.1), CONCRETE_DARK);
    }
    // Underside of the slab.
    p.quad(at(i, off + 0.45, -1.1), at(j, off + 0.45, -1.1), at(j, -(off + 0.45), -1.1), at(i, -(off + 0.45), -1.1), CONCRETE_DARK);
  }
  return p.empty ? null : p.build();
}

const TUNNEL_WALL = 0xb9bec7;
const TUNNEL_INSIDE = 0x6f747c;
const TUNNEL_ROOF = 0x8f949c;
const TUNNEL_FACE = 0xd5d8de;

/**
 * Tunnels where the track crosses itself (TrackOptions.crossing): along the
 * lower road under the road above, a wall each side outside its barriers, a
 * roof slab between them and a portal face at each end, up to the road above.
 */
export function buildTunnelGeometry(track: Track): BufferGeometry | null {
  const tunnels = tunnelsOf(track);
  if (!tunnels.length) return null;
  const c = track.center;
  const n = c.points.length;
  const p = new Panels();
  const off = c.wallOffset + 0.5;
  const at = (i: number, lateral: number, y: number) => {
    const q = c.points[i];
    const l = leftOf(c.tangents[i]);
    return [q.x + l.x * lateral, y, q.y + l.y * lateral];
  };
  for (const t of tunnels) {
    const top = t.roof + 1.25 + 1; // the parapet of the road above
    for (let k = 0; k < t.count; k++) {
      const i = (t.from + k) % n;
      const j = (i + 1) % n;
      for (const side of [1, -1]) {
        const lat = off * side;
        const floorI = surfaceY(c, i, lat) - 0.6;
        const floorJ = surfaceY(c, j, lat) - 0.6;
        // Inner face (seen from the road, darker) and outer face up to the parapet.
        p.quad(at(i, lat, floorI), at(j, lat, floorJ), at(j, lat, t.roof), at(i, lat, t.roof), TUNNEL_INSIDE);
        p.quad(at(i, lat + 0.5 * side, floorI), at(j, lat + 0.5 * side, floorJ), at(j, lat + 0.5 * side, top), at(i, lat + 0.5 * side, top), TUNNEL_WALL);
        p.quad(at(i, lat, t.roof), at(j, lat, t.roof), at(j, lat + 0.5 * side, top), at(i, lat + 0.5 * side, top), TUNNEL_WALL);
      }
      // The roof: its underside, and its top (a little below the road above, so the deck covers it there).
      p.quad(at(i, off, t.roof), at(j, off, t.roof), at(j, -off, t.roof), at(i, -off, t.roof), TUNNEL_ROOF);
      p.quad(at(i, off + 0.5, t.roof + 0.9), at(j, off + 0.5, t.roof + 0.9), at(j, -off - 0.5, t.roof + 0.9), at(i, -off - 0.5, t.roof + 0.9), TUNNEL_WALL);
    }
    // Portals: the face above each opening, from just under the roof to the parapet.
    for (const i of [t.from, (t.from + t.count) % n]) {
      p.quad(at(i, off + 0.5, t.roof - 0.5), at(i, -off - 0.5, t.roof - 0.5), at(i, -off - 0.5, top), at(i, off + 0.5, top), TUNNEL_FACE);
      p.quad(at(i, off + 0.5, t.roof - 0.5), at(i, -off - 0.5, t.roof - 0.5), at(i, -off - 0.5, t.roof), at(i, off + 0.5, t.roof), WALL_RED);
    }
  }
  return p.empty ? null : p.build();
}

/**
 * Gravel or tarmac run-off beside the road, out to the barrier line (nothing
 * for grass: that's the ground itself). Drawn like the road, after the ground
 * and without writing depth. Skipped on bridge decks, which have their own
 * concrete shoulders. UVs are in world metres / 4.
 */
export function buildRunoffGeometry(track: Track, surf: TrackSurface, kind: 'gravel' | 'tarmac' = track.options.runoff === 'gravel' ? 'gravel' : 'tarmac'): BufferGeometry | null {
  // Which stretches have this run-off (it can be painted, or set per corner).
  const lay = runoffLayout(track);
  const want = (OPTION_CHOICES.runoff as readonly string[]).indexOf(kind);
  if (!lay.left.includes(want) && !lay.right.includes(want)) return null;
  const c = track.center;
  const n = c.points.length;
  const { left, right } = edgeOffsets(c);
  const outerMax = c.wallOffset + 0.4;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let r = 0; r <= n; r++) {
      const i = r % n;
      const p = c.points[i];
      const l = leftOf(c.tangents[i]);
      // On the inside of a tight corner the strip stops short of the corner's centre.
      const k = c.curvature[i];
      const insideHere = (k > 0 && side === -1) || (k < 0 && side === 1);
      const inner = (side === 1 ? left[i] : right[i]) - 0.1;
      const outer = insideHere ? Math.max(inner, Math.min(outerMax, 0.9 / Math.max(1e-6, Math.abs(k)))) : outerMax;
      for (const lat of [inner, outer]) {
        const x = p.x + l.x * lat * side;
        const z = p.y + l.y * lat * side;
        pos.push(x, surfaceY(c, i, lat * side) + ROAD_Y * 0.4, z);
        uv.push(x / 4, z / 4);
      }
    }
    const has = side === 1 ? lay.left : lay.right;
    for (let r = 0; r < n; r++) {
      if (surf.deck[r] || surf.deck[(r + 1) % n]) continue;
      if (has[r] !== want) continue;
      const a = base + r * 2;
      // Winding so the face points up on either side.
      if (side === 1) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  if (!idx.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(new Uint32BufferAttribute(Uint32Array.from(idx), 1));
  g.computeVertexNormals();
  return g;
}

const PIT_LANE = 0x4b505a;
const PIT_LINE = 0xf2f2ee;
const PIT_WALL = 0xe9ebef;
const PIT_BACK = 0xb9bec7;
const PIT_ROOF = 0xf6f6f4;
const PIT_DOOR = 0x22262e;
/** Team colours above the garage doors. */
const TEAMS = [0xd8342c, 0x2f6fd8, 0xf2b705, 0x2fa35a, 0xf07a1a, 0x8a4fd8, 0x18a9b8, 0xe0e0e0, 0xd84f9a, 0x3b3f47] as const;

/**
 * The pit building beside the start straight: a pit lane, then a long white
 * building whose front is a row of garages with team-coloured signs, under a
 * roof that overhangs the lane a little. One vertex-coloured mesh.
 */
export function buildPitGeometry(track: Track, surf: TrackSurface): BufferGeometry | null {
  const pits = pitLayout(track);
  if (!pits) return null;
  const c = track.center;
  const p = new Panels();
  const side = pits.side;
  const H = 6.2;
  /** A point at track position s, `lat` metres out on the pit side, `y` above the pad. */
  const at = (s: number, lat: number, y: number): number[] => {
    const { p: q, t } = sampleAt(c, s);
    const l = leftOf(t);
    const x = q.x + l.x * lat * side;
    const z = q.y + l.y * lat * side;
    return [x, terrainHeight(surf.terrain, x, z) + y, z];
  };
  // Pit lane and its white edge lines.
  const [l0, l1] = pits.lane;
  const [b0, b1] = pits.building;
  const step = 2.5;
  for (let s = pits.from - 8; s < pits.to + 8; s += step) {
    const e = s + step;
    p.quad(at(s, l0, 0.06), at(e, l0, 0.06), at(e, l1 + 0.5, 0.06), at(s, l1 + 0.5, 0.06), PIT_LANE);
    p.quad(at(s, l0 + 0.4, 0.08), at(e, l0 + 0.4, 0.08), at(e, l0 + 0.7, 0.08), at(s, l0 + 0.7, 0.08), PIT_LINE);
  }
  // The building: front with garages, back, roof and end walls.
  const doorW = 4.4;
  for (let k = 0; k < pits.doors.length; k++) {
    const m = pits.doors[k];
    const g0 = m - 3;
    const g1 = m + 3;
    const d0 = m - doorW / 2;
    const d1 = m + doorW / 2;
    // Pillars either side of the door and the wall above it.
    p.quad(at(g0, b0, -0.6), at(d0, b0, -0.6), at(d0, b0, H), at(g0, b0, H), PIT_WALL);
    p.quad(at(d1, b0, -0.6), at(g1, b0, -0.6), at(g1, b0, H), at(d1, b0, H), PIT_WALL);
    p.quad(at(d0, b0, 3.6), at(d1, b0, 3.6), at(d1, b0, 4.6), at(d0, b0, 4.6), TEAMS[k % TEAMS.length]);
    p.quad(at(d0, b0, 4.6), at(d1, b0, 4.6), at(d1, b0, H), at(d0, b0, H), PIT_WALL);
    // The open garage: a dark recess.
    p.quad(at(d0, b0 + 0.6, -0.6), at(d1, b0 + 0.6, -0.6), at(d1, b0 + 0.6, 3.6), at(d0, b0 + 0.6, 3.6), PIT_DOOR);
    p.quad(at(d0, b0, 3.6), at(d1, b0, 3.6), at(d1, b0 + 0.6, 3.6), at(d0, b0 + 0.6, 3.6), PIT_BACK);
    for (const d of [d0, d1]) p.quad(at(d, b0, -0.6), at(d, b0 + 0.6, -0.6), at(d, b0 + 0.6, 3.6), at(d, b0, 3.6), PIT_BACK);
  }
  const s0 = pits.from;
  const s1 = pits.to;
  for (let s = s0; s < s1 - 0.01; s += step) {
    const e = Math.min(s1, s + step);
    // Back wall and roof (overhanging the lane by 2 m).
    p.quad(at(s, b1, -0.6), at(e, b1, -0.6), at(e, b1, H), at(s, b1, H), PIT_BACK);
    p.quad(at(s, b0 - 2, H), at(e, b0 - 2, H), at(e, b1, H), at(s, b1, H), PIT_ROOF);
    p.quad(at(s, b0 - 2, H - 0.35), at(e, b0 - 2, H - 0.35), at(e, b0 - 2, H), at(s, b0 - 2, H), PIT_BACK);
  }
  // Front beyond the first and last garage, and the end walls.
  const g0 = pits.doors[0] - 3;
  const g1 = pits.doors[pits.doors.length - 1] + 3;
  p.quad(at(s0, b0, -0.6), at(g0, b0, -0.6), at(g0, b0, H), at(s0, b0, H), PIT_WALL);
  p.quad(at(g1, b0, -0.6), at(s1, b0, -0.6), at(s1, b0, H), at(g1, b0, H), PIT_WALL);
  for (const s of [s0, s1]) p.quad(at(s, b0, -0.6), at(s, b1, -0.6), at(s, b1, H), at(s, b0, H), PIT_BACK);
  return p.build();
}
