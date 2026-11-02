import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
} from 'three';
import { TRACK } from '../config/track.ts';
import { dist2, wrap, type Vec2 } from '../core/math.ts';
import { hashString, rng, valueNoise } from '../core/random.ts';
import { merge, tint } from '../render/geom.ts';
import { ATLAS } from '../render/textures.ts';
import { ROAD_Y } from './mesh.ts';
import { leftOf, type Centerline } from './spline.ts';
import type { Track } from './track.ts';

export interface SceneryMaterials {
  /** Vertex-coloured, flat-shaded material for low-poly props. */
  prop: Material;
  /** Material using the start/finish atlas texture. */
  atlas: Material;
}

// ------------------------------------------------------------------ prototypes
// Built once and shared by every track (instanced meshes reference them).

let conifer: BufferGeometry | null = null;
let broadleaf: BufferGeometry | null = null;
let cone: BufferGeometry | null = null;

function coniferGeometry(): BufferGeometry {
  conifer ??= merge([
    tint(new CylinderGeometry(0.22, 0.32, 1.6, 5, 1, true).translate(0, 0.8, 0), 0x6b4a2b),
    tint(new ConeGeometry(2.0, 3.6, 6).translate(0, 3.0, 0), 0x2f6b3a),
    tint(new ConeGeometry(1.4, 2.8, 6).translate(0, 4.6, 0), 0x3a7d44),
  ]);
  return conifer;
}

function broadleafGeometry(): BufferGeometry {
  broadleaf ??= merge([
    tint(new CylinderGeometry(0.22, 0.3, 2.2, 5, 1, true).translate(0, 1.1, 0), 0x6b4a2b),
    tint(new IcosahedronGeometry(2.1, 0).scale(1, 0.9, 1).translate(0, 3.6, 0), 0x5b9a3e),
    tint(new IcosahedronGeometry(1.3, 0).translate(0.9, 4.5, 0.4), 0x6aab47),
  ]);
  return broadleaf;
}

function coneGeometry(): BufferGeometry {
  cone ??= merge([
    tint(new BoxGeometry(0.62, 0.05, 0.62).translate(0, 0.025, 0), 0xd9480f),
    tint(new ConeGeometry(0.26, 0.78, 8).translate(0, 0.44, 0), 0xff6a13),
    tint(new CylinderGeometry(0.113, 0.156, 0.13, 8, 1, true).translate(0, 0.45, 0), 0xffffff),
  ]);
  return cone;
}

// ------------------------------------------------------------------ placement

/** True if `p` is at least `clearance` metres from every centre-line point. */
function clearOfTrack(c: Centerline, p: Vec2, clearance: number): boolean {
  const c2 = clearance * clearance;
  for (const q of c.points) if (dist2(p, q) < c2) return false;
  return true;
}

const tmpObj = new Object3D();
const tmpColor = new Color();

/**
 * Trees: two instanced meshes (conifers and broadleaf), scattered on a jittered
 * grid. Value noise clusters them into woods, and none are allowed near the road.
 */
function buildTrees(track: Track, mat: Material, seed: number): InstancedMesh[] {
  const rand = rng(seed);
  const c = track.center;
  const clearance = TRACK.roadWidth / 2 + 11;
  const step = 15;
  const extentX = 600;
  const extentZ = 420;
  const spots: { x: number; z: number; s: number; r: number; kind: number }[] = [];
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
      spots.push({ x, z, s: 0.75 + rand() * 0.7, r: rand() * Math.PI * 2, kind: wood > 0.5 ? (rand() < 0.75 ? 0 : 1) : rand() < 0.35 ? 0 : 1 });
    }
  }
  const out: InstancedMesh[] = [];
  const geoms = [coniferGeometry(), broadleafGeometry()];
  for (let kind = 0; kind < 2; kind++) {
    const list = spots.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const mesh = new InstancedMesh(geoms[kind], mat, list.length);
    list.forEach((s, i) => {
      tmpObj.position.set(s.x, 0, s.z);
      tmpObj.rotation.set(0, s.r, 0);
      tmpObj.scale.setScalar(s.s);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
      const shade = 0.8 + rand() * 0.35;
      mesh.setColorAt(i, tmpColor.setRGB(shade, shade * (0.95 + rand() * 0.1), shade * 0.95));
    });
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  return out;
}

/** Three cones just beyond the outside kerb at the apex of every tight corner. */
function buildCones(track: Track, mat: Material): InstancedMesh | null {
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
  if (!spots.length) return null;
  const mesh = new InstancedMesh(coneGeometry(), mat, spots.length);
  spots.forEach((p, i) => {
    tmpObj.position.set(p.x, 0, p.y);
    tmpObj.rotation.set(0, i * 1.7, 0);
    tmpObj.scale.setScalar(1);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(i, tmpObj.matrix);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

/** Matrix placing local (X across to the left, Y up, Z along the road) at the start line. */
function startFrame(c: Centerline): Matrix4 {
  const p = c.points[0];
  const t = c.tangents[0];
  const l = leftOf(t);
  return new Matrix4()
    .makeBasis(new Vector3(l.x, 0, l.y), new Vector3(0, 1, 0), new Vector3(t.x, 0, t.y))
    .setPosition(p.x, 0, p.y);
}

const GANTRY = { postX: TRACK.roadWidth / 2 + 1.4, height: 7, beamY: 6.2, beamH: 1.6, beamD: 0.7 } as const;

/** Gantry posts and beam (vertex-coloured, merged into one mesh). */
function buildGantryFrame(frame: Matrix4, mat: Material): Mesh {
  const g = GANTRY;
  const parts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(tint(new BoxGeometry(0.6, g.height, 0.6).translate(sx * g.postX, g.height / 2, 0), 0xdadde3));
    parts.push(tint(new BoxGeometry(1.1, 0.4, 1.1).translate(sx * g.postX, 0.2, 0), 0x8a8f99));
  }
  parts.push(tint(new BoxGeometry(g.postX * 2 + 0.6, g.beamH, g.beamD).translate(0, g.beamY, 0), 0x22283a));
  const geo = merge(parts).applyMatrix4(frame);
  return new Mesh(geo, mat);
}

/** Banner on both faces of the beam plus the chequered line on the road: one mesh, one texture. */
function buildStartAtlasMesh(frame: Matrix4, mat: Material): Mesh {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const quad = (q: Vector3[], uvs: number[][]) => {
    const n = new Vector3().subVectors(q[1], q[0]).cross(new Vector3().subVectors(q[3], q[0])).normalize();
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(q[k].x, q[k].y, q[k].z);
      nor.push(n.x, n.y, n.z);
      uv.push(uvs[k][0], uvs[k][1]);
    }
  };
  const g = GANTRY;
  const bw = g.postX * 2 - 0.8; // banner width
  const bh = bw / ATLAS.bannerAspect;
  const y0 = g.beamY - bh / 2;
  const y1 = g.beamY + bh / 2;
  const z = g.beamD / 2 + 0.01;
  const b = ATLAS.banner;
  const bannerUv = [
    [b.u0, b.v0],
    [b.u1, b.v0],
    [b.u1, b.v1],
    [b.u0, b.v1],
  ];
  // Facing drivers approaching the line (they look along +Z; their left is +X).
  quad([new Vector3(bw / 2, y0, -z), new Vector3(-bw / 2, y0, -z), new Vector3(-bw / 2, y1, -z), new Vector3(bw / 2, y1, -z)], bannerUv);
  // Facing the other way.
  quad([new Vector3(-bw / 2, y0, z), new Vector3(bw / 2, y0, z), new Vector3(bw / 2, y1, z), new Vector3(-bw / 2, y1, z)], bannerUv);
  // Chequered line lying on the road: 8 squares across, 2 along.
  const hw = TRACK.roadWidth / 2 - 0.3;
  const d = 0.9;
  const y = ROAD_Y + 0.006;
  const k = ATLAS.checker;
  quad(
    [new Vector3(-hw, y, -d), new Vector3(-hw, y, d), new Vector3(hw, y, d), new Vector3(hw, y, -d)],
    [
      [k.u0, k.v0],
      [k.u0, k.v1],
      [k.u1, k.v1],
      [k.u1, k.v0],
    ],
  );
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.applyMatrix4(frame);
  return new Mesh(geo, mat);
}

/** Everything placed around one track. Dispose it when the track changes. */
export function buildScenery(track: Track, mats: SceneryMaterials): { group: Group; dispose(): void } {
  const group = new Group();
  group.name = 'scenery';
  const seed = hashString(track.def.id);
  const frame = startFrame(track.center);
  const owned: BufferGeometry[] = [];

  const gantry = buildGantryFrame(frame, mats.prop);
  const atlas = buildStartAtlasMesh(frame, mats.atlas);
  owned.push(gantry.geometry, atlas.geometry);
  group.add(gantry, atlas);

  const instanced: InstancedMesh[] = [...buildTrees(track, mats.prop, seed)];
  const cones = buildCones(track, mats.prop);
  if (cones) instanced.push(cones);
  for (const m of instanced) group.add(m);

  return {
    group,
    dispose() {
      for (const g of owned) g.dispose();
      // Instanced meshes share prototype geometry; only free their instance buffers.
      for (const m of instanced) m.dispose();
    },
  };
}
