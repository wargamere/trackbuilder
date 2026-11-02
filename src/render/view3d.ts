import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type Texture,
  WebGLRenderer,
  BackSide,
} from 'three';
import { THEMES, type Theme } from '../config/themes.ts';
import type { ThemeId } from '../config/track.ts';
import { valueNoise } from '../core/random.ts';
import { buildKerbGeometry, buildRoadGeometry, buildWallGeometry } from '../track/mesh.ts';
import { buildScenery } from '../track/scenery.ts';
import { surfaceFor, type Terrain } from '../track/surface.ts';
import type { Track } from '../track/track.ts';
import { tint } from './geom.ts';
import { makeAsphaltTexture, makeAtlasTexture, makeGroundTexture } from './textures.ts';

const GROUND_SIZE = 2800;
const HILL_RADIUS = 1250;
/** The flat outer ground sits a little below the track's terrain mesh, which covers the middle. */
const OUTER_GROUND_Y = -0.4;
/** Metres per repeat of the ground texture. */
const GROUND_TILE = 7;

/**
 * Owns the WebGL renderer and the 3D scene. Sky, outer ground, hills and
 * lights are built once and recoloured per theme; the track (road, decks,
 * kerbs, barriers, pillars, terrain and scenery) is rebuilt by setTrack().
 * Everything static is merged or instanced: about 15 draw calls in total.
 */
export class View3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.3, 2400);
  private readonly sky: Mesh;
  private readonly hills: Mesh;
  private readonly ground: Mesh;
  private readonly hemi: HemisphereLight;
  private readonly sun: DirectionalLight;
  private readonly fog: Fog;
  private readonly maxAniso: number;
  private readonly mats: {
    road: MeshLambertMaterial;
    deck: MeshLambertMaterial;
    kerb: MeshLambertMaterial;
    wall: MeshLambertMaterial;
    prop: MeshLambertMaterial;
    atlas: MeshLambertMaterial;
    ground: MeshLambertMaterial;
  };
  private readonly groundTextures = new Map<ThemeId, Texture>();
  private theme: ThemeId | null = null;
  private trackGroup: Group | null = null;
  private disposeTrack: (() => void) | null = null;
  private currentTrack: Track | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.maxAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());

    const asphalt = makeAsphaltTexture();
    const atlas = makeAtlasTexture();
    for (const t of [asphalt, atlas]) t.anisotropy = this.maxAniso;
    this.mats = {
      // Ground-level road: drawn after the ground without writing depth, so where
      // the track crosses itself the two stretches overlap instead of flickering.
      road: new MeshLambertMaterial({ map: asphalt, depthWrite: false }),
      // Raised decks write depth (they must hide a road passing underneath).
      deck: new MeshLambertMaterial({ map: asphalt, side: DoubleSide }),
      kerb: new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      wall: new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }),
      prop: new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      atlas: new MeshLambertMaterial({ map: atlas }),
      // The ground is pushed back in depth so the road lying on it never z-fights.
      ground: new MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
    };

    this.fog = new Fog(0xffffff, 260, 1500);
    this.scene.fog = this.fog;
    this.hemi = new HemisphereLight(0xffffff, 0xffffff, 1.6);
    this.sun = new DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(-0.45, 1, 0.3);
    this.scene.add(this.hemi, this.sun);

    this.sky = this.buildSky();
    this.ground = this.buildOuterGround();
    this.hills = this.buildHills();
    this.scene.add(this.sky, this.ground, this.hills);
    this.applyTheme('meadow');
  }

  private buildSky(): Mesh {
    const g = new SphereGeometry(2000, 24, 12);
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3));
    const m = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  /** Big flat ground around the track's terrain. Vertex colours add large lighter/darker patches. */
  private buildOuterGround(): Mesh {
    const seg = 56;
    const g = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE, seg, seg).rotateX(-Math.PI / 2).translate(0, OUTER_GROUND_Y, 0);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const k = groundShade(x, z);
      col.set([k, k, k], i * 3);
      uv.setXY(i, x / GROUND_TILE, z / GROUND_TILE);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    return new Mesh(g, this.mats.ground);
  }

  /** A ring of low, faceted hills on the horizon (one mesh, recoloured per theme). */
  private buildHills(): Mesh {
    const segs = 72;
    const pos: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const h = (a: number) => 35 + 110 * valueNoise(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, 5);
      const r0 = HILL_RADIUS;
      const r1 = HILL_RADIUS + 120;
      const p = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
      for (const v of [p(a0, r0, -2), p(a0, r1, h(a0)), p(a1, r0, -2), p(a1, r0, -2), p(a0, r1, h(a0)), p(a1, r1, h(a1))]) pos.push(...v);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.computeVertexNormals();
    return new Mesh(g, new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
  }

  /** Recolours sky, fog, light, hills and ground for a theme. */
  private applyTheme(id: ThemeId): void {
    if (this.theme === id) return;
    this.theme = id;
    const th: Theme = THEMES[id];
    const top = new Color(th.skyTop);
    const hor = new Color(th.skyHorizon);
    this.scene.background = hor;
    this.fog.color.copy(hor);
    this.hemi.color.setHex(th.hemiSky);
    this.hemi.groundColor.setHex(th.hemiGround);
    this.sun.color.setHex(th.sun);
    this.sun.intensity = th.sunIntensity;

    const sg = this.sky.geometry;
    const sp = sg.getAttribute('position');
    const sc = sg.getAttribute('color');
    const c = new Color();
    for (let i = 0; i < sp.count; i++) {
      c.copy(hor).lerp(top, Math.pow(Math.max(0, sp.getY(i) / 2000), 0.6));
      sc.setXYZ(i, c.r, c.g, c.b);
    }
    sc.needsUpdate = true;

    const hc = this.hills.geometry.getAttribute('color');
    const near = new Color(th.hills[0]);
    const far = new Color(th.hills[1]);
    for (let i = 0; i < hc.count; i++) {
      const v = [near, far, near, near, far, far][i % 6];
      hc.setXYZ(i, v.r, v.g, v.b);
    }
    hc.needsUpdate = true;

    let tex = this.groundTextures.get(id);
    if (!tex) {
      tex = makeGroundTexture(th.ground);
      tex.anisotropy = this.maxAniso;
      this.groundTextures.set(id, tex);
    }
    this.mats.ground.map = tex;
    this.mats.ground.color.setRGB(...th.groundTint);
    this.mats.ground.needsUpdate = true;
  }

  /** The terrain around the track as one grid mesh. */
  private buildTerrainMesh(t: Terrain): Mesh {
    const g = new PlaneGeometry((t.nx - 1) * t.step, (t.nz - 1) * t.step, t.nx - 1, t.nz - 1).rotateX(-Math.PI / 2);
    g.translate(t.x0 + ((t.nx - 1) * t.step) / 2, 0, t.z0 + ((t.nz - 1) * t.step) / 2);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ix = Math.round((x - t.x0) / t.step);
      const iz = Math.round((z - t.z0) / t.step);
      pos.setY(i, t.h[iz * t.nx + ix]);
      const k = groundShade(x, z);
      col.set([k, k, k], i * 3);
      uv.setXY(i, x / GROUND_TILE, z / GROUND_TILE);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return new Mesh(g, this.mats.ground);
  }

  /** Builds the road, kerbs, barriers, terrain and scenery for `track` (no-op if it is already shown). */
  setTrack(track: Track): void {
    if (this.currentTrack === track) return;
    this.clearTrack();
    this.currentTrack = track;
    this.applyTheme(track.options.theme);
    const surf = surfaceFor(track);
    const group = new Group();
    group.name = 'track';
    const owned: BufferGeometry[] = [];
    const add = (g: BufferGeometry | null, mat: MeshLambertMaterial, order = 0) => {
      if (!g) return;
      const m = new Mesh(g, mat);
      m.renderOrder = order;
      owned.push(g);
      group.add(m);
    };
    const terrain = this.buildTerrainMesh(surf.terrain);
    owned.push(terrain.geometry);
    group.add(terrain);
    const road = buildRoadGeometry(track.center, surf);
    add(road.ground, this.mats.road, 1);
    add(road.deck, this.mats.deck, 2);
    add(buildKerbGeometry(track), this.mats.kerb);
    add(buildWallGeometry(track, surf), this.mats.wall);

    let pillars: InstancedMesh | null = null;
    if (surf.pillars.length) {
      pillars = new InstancedMesh(pillarGeometry(), this.mats.prop, surf.pillars.length);
      const o = new Object3D();
      surf.pillars.forEach((p, i) => {
        o.position.set(p.x, p.y0, p.z);
        o.scale.set(1, Math.max(0.1, p.y1 - p.y0), 1);
        o.updateMatrix();
        pillars?.setMatrixAt(i, o.matrix);
      });
      pillars.computeBoundingSphere();
      group.add(pillars);
    }

    const scenery = buildScenery(track, { prop: this.mats.prop, atlas: this.mats.atlas });
    group.add(scenery.group);
    this.scene.add(group);
    this.trackGroup = group;
    this.disposeTrack = () => {
      for (const g of owned) g.dispose();
      pillars?.dispose();
      scenery.dispose();
    };
  }

  private clearTrack(): void {
    if (this.trackGroup) this.scene.remove(this.trackGroup);
    this.disposeTrack?.();
    this.trackGroup = null;
    this.disposeTrack = null;
    this.currentTrack = null;
  }

  resize(w: number, h: number): void {
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Draw calls and triangles in the last frame (for the debug overlay and budget checks). */
  stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }
}

/** Large-scale brightness variation of the ground (shared by terrain and outer ground so they match). */
function groundShade(x: number, z: number): number {
  const n = valueNoise(x / 160, z / 160, 3) * 0.6 + valueNoise(x / 45, z / 45, 9) * 0.4;
  return 0.82 + n * 0.32;
}

let pillarGeo: BufferGeometry | null = null;
/** A 1 m tall concrete pillar (scaled per instance to reach the deck). */
function pillarGeometry(): BufferGeometry {
  pillarGeo ??= tint(new BoxGeometry(1.6, 1, 1.6).translate(0, 0.5, 0), 0xb8bcc4);
  return pillarGeo;
}
