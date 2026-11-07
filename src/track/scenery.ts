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
import { THEMES, type PropKind } from '../config/themes.ts';
import { merge, tint } from '../render/geom.ts';
import { ATLAS } from '../render/textures.ts';
import { ROAD_Y } from './mesh.ts';
import { placeCones, placeTrees } from './placement.ts';
import { leftOf, type Centerline } from './spline.ts';
import { surfaceFor, terrainHeight, type Terrain } from './surface.ts';
import type { Track } from './track.ts';

export interface SceneryMaterials {
  /** Vertex-coloured, flat-shaded material for low-poly props. */
  prop: Material;
  /** Material using the start/finish atlas texture. */
  atlas: Material;
}

// ------------------------------------------------------------------ prototypes
// Built once and shared by every track (instanced meshes reference them).

const props = new Map<PropKind, BufferGeometry>();
let cone: BufferGeometry | null = null;

const PROP_BUILDERS: Record<PropKind, () => BufferGeometry> = {
  conifer: () =>
    merge([
      tint(new CylinderGeometry(0.22, 0.32, 1.6, 5, 1, true).translate(0, 0.8, 0), 0x6b4a2b),
      tint(new ConeGeometry(2.0, 3.6, 6).translate(0, 3.0, 0), 0x2f6b3a),
      tint(new ConeGeometry(1.4, 2.8, 6).translate(0, 4.6, 0), 0x3a7d44),
    ]),
  broadleaf: () =>
    merge([
      tint(new CylinderGeometry(0.22, 0.3, 2.2, 5, 1, true).translate(0, 1.1, 0), 0x6b4a2b),
      tint(new IcosahedronGeometry(2.1, 0).scale(1, 0.9, 1).translate(0, 3.6, 0), 0x5b9a3e),
      tint(new IcosahedronGeometry(1.3, 0).translate(0.9, 4.5, 0.4), 0x6aab47),
    ]),
  snowpine: () =>
    merge([
      tint(new CylinderGeometry(0.22, 0.32, 1.6, 5, 1, true).translate(0, 0.8, 0), 0x5a4030),
      tint(new ConeGeometry(2.0, 3.6, 6).translate(0, 3.0, 0), 0x2c5a3c),
      tint(new ConeGeometry(1.45, 2.2, 6).translate(0, 4.3, 0), 0xeef3f8),
      tint(new ConeGeometry(0.8, 1.3, 6).translate(0, 5.5, 0), 0xf6f9fc),
    ]),
  cactus: () =>
    merge([
      tint(new CylinderGeometry(0.34, 0.4, 3.4, 7).translate(0, 1.7, 0), 0x4f8a3e),
      tint(new CylinderGeometry(0.2, 0.2, 0.8, 6).rotateZ(Math.PI / 2).translate(0.5, 1.5, 0), 0x4f8a3e),
      tint(new CylinderGeometry(0.2, 0.22, 1.3, 6).translate(0.85, 2.05, 0), 0x5a9646),
      tint(new CylinderGeometry(0.18, 0.18, 0.6, 6).rotateZ(Math.PI / 2).translate(-0.4, 2.2, 0), 0x4f8a3e),
      tint(new CylinderGeometry(0.18, 0.2, 0.9, 6).translate(-0.65, 2.55, 0), 0x5a9646),
    ]),
  rock: () =>
    merge([
      tint(new IcosahedronGeometry(1.3, 0).scale(1.3, 0.7, 1.05).translate(0, 0.45, 0), 0xa98c6c),
      tint(new IcosahedronGeometry(0.7, 0).scale(1, 0.8, 1).translate(1.1, 0.25, 0.4), 0x9c7f61),
    ]),
};

function propGeometry(kind: PropKind): BufferGeometry {
  let g = props.get(kind);
  if (!g) {
    g = PROP_BUILDERS[kind]();
    props.set(kind, g);
  }
  return g;
}

function coneGeometry(): BufferGeometry {
  cone ??= merge([
    tint(new BoxGeometry(0.62, 0.05, 0.62).translate(0, 0.025, 0), 0xd9480f),
    tint(new ConeGeometry(0.26, 0.78, 8).translate(0, 0.44, 0), 0xff6a13),
    tint(new CylinderGeometry(0.113, 0.156, 0.13, 8, 1, true).translate(0, 0.45, 0), 0xffffff),
  ]);
  return cone;
}

const tmpObj = new Object3D();
const tmpColor = new Color();

/** Roadside props: two instanced meshes (the theme's two kinds), standing on the terrain. */
function buildTrees(track: Track, mat: Material, terrain: Terrain): InstancedMesh[] {
  const spots = placeTrees(track);
  const out: InstancedMesh[] = [];
  const kinds = THEMES[track.options.theme].props;
  const geoms = [propGeometry(kinds[0]), propGeometry(kinds[1])];
  for (const kind of [0, 1] as const) {
    const list = spots.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const mesh = new InstancedMesh(geoms[kind], mat, list.length);
    list.forEach((s, i) => {
      tmpObj.position.set(s.x, terrainHeight(terrain, s.x, s.z) - 0.1, s.z);
      tmpObj.rotation.set(0, s.rot, 0);
      tmpObj.scale.setScalar(s.scale);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
      mesh.setColorAt(i, tmpColor.setRGB(s.shade, s.shade, s.shade * 0.95));
    });
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  return out;
}

/** Cones at tight-corner apexes (instanced). */
function buildCones(track: Track, mat: Material, terrain: Terrain): InstancedMesh | null {
  const spots = placeCones(track);
  if (!spots.length) return null;
  const mesh = new InstancedMesh(coneGeometry(), mat, spots.length);
  spots.forEach((p, i) => {
    tmpObj.position.set(p.x, terrainHeight(terrain, p.x, p.y), p.y);
    tmpObj.rotation.set(0, i * 1.7, 0);
    tmpObj.scale.setScalar(1);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(i, tmpObj.matrix);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

/** Matrix placing local (X across to the left, Y up, Z along the road) at the start line, following height and bank. */
function startFrame(c: Centerline): Matrix4 {
  const p = c.points[0];
  const t = c.tangents[0];
  const l = leftOf(t);
  const b = c.bank[0];
  const z = new Vector3(t.x, 0, t.y);
  const x = new Vector3(l.x * Math.cos(b), Math.sin(b), l.y * Math.cos(b));
  const y = new Vector3().crossVectors(z, x);
  return new Matrix4().makeBasis(x, y, z).setPosition(p.x, c.height[0], p.y);
}

/** Start gantry dimensions for a road `width` wide. */
const gantryFor = (width: number) => ({ postX: width / 2 + 1.4, height: 7, beamY: 6.2, beamH: 1.6, beamD: 0.7 });

/** Gantry posts and beam (vertex-coloured, merged into one mesh). */
function buildGantryFrame(frame: Matrix4, mat: Material, width: number): Mesh {
  const g = gantryFor(width);
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
function buildStartAtlasMesh(frame: Matrix4, mat: Material, width: number): Mesh {
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
  const g = gantryFor(width);
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
  const hw = width / 2 - 0.3;
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
  const frame = startFrame(track.center);
  const owned: BufferGeometry[] = [];

  const gantry = buildGantryFrame(frame, mats.prop, track.center.width);
  const atlas = buildStartAtlasMesh(frame, mats.atlas, track.center.width);
  owned.push(gantry.geometry, atlas.geometry);
  group.add(gantry, atlas);

  const terrain = surfaceFor(track).terrain;
  const instanced: InstancedMesh[] = [...buildTrees(track, mats.prop, terrain)];
  const cones = buildCones(track, mats.prop, terrain);
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
