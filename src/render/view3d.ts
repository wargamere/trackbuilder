import {
  BackSide,
  BufferGeometry,
  DoubleSide,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type Texture,
  WebGLRenderer,
} from 'three';
import { valueNoise } from '../core/random.ts';
import { buildKerbGeometry, buildRoadGeometry } from '../track/mesh.ts';
import { buildScenery } from '../track/scenery.ts';
import type { Track } from '../track/track.ts';
import { makeAsphaltTexture, makeAtlasTexture, makeGrassTexture } from './textures.ts';

const SKY_TOP = 0x4f97de;
const SKY_HORIZON = 0xcfe6f5;
const GROUND_SIZE = 2800;
const HILL_RADIUS = 1250;

/**
 * Owns the WebGL renderer and the 3D scene. The world (sky, ground, hills,
 * lights) is built once; the track and its scenery are rebuilt by setTrack().
 * Everything static is merged or instanced, so a full scene is ~10 draw calls.
 */
export class View3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, 1, 0.3, 2400);
  private readonly sky: Mesh;
  private readonly mats: {
    road: MeshLambertMaterial;
    kerb: MeshLambertMaterial;
    prop: MeshLambertMaterial;
    atlas: MeshLambertMaterial;
  };
  private readonly textures: Texture[] = [];
  private trackGroup: Group | null = null;
  private disposeTrack: (() => void) | null = null;
  private currentTrack: Track | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const maxAniso = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());

    const asphalt = makeAsphaltTexture();
    const grass = makeGrassTexture();
    const atlas = makeAtlasTexture();
    for (const t of [asphalt, grass, atlas]) {
      t.anisotropy = maxAniso;
      this.textures.push(t);
    }
    this.mats = {
      road: new MeshLambertMaterial({ map: asphalt, depthWrite: false }),
      kerb: new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      prop: new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      atlas: new MeshLambertMaterial({ map: atlas }),
    };

    const horizon = new Color(SKY_HORIZON);
    this.scene.background = horizon;
    this.scene.fog = new Fog(horizon, 260, 1500);

    const hemi = new HemisphereLight(0xdcefff, 0x5d7a3c, 1.6);
    const sun = new DirectionalLight(0xfff2dc, 2.2);
    sun.position.set(-0.45, 1, 0.3);
    this.scene.add(hemi, sun);

    this.sky = this.buildSky();
    this.scene.add(this.sky, this.buildGround(grass), this.buildHills());
  }

  private buildSky(): Mesh {
    const g = new SphereGeometry(2000, 24, 12);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const top = new Color(SKY_TOP);
    const hor = new Color(SKY_HORIZON);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const h = Math.max(0, pos.getY(i) / 2000);
      c.copy(hor).lerp(top, Math.pow(h, 0.6));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    const m = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  /** Big grass plane. Vertex colours add large patches of lighter and darker grass. */
  private buildGround(grass: Texture): Mesh {
    const seg = 56;
    const g = new PlaneGeometry(GROUND_SIZE, GROUND_SIZE, seg, seg).rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const col = new Float32Array(pos.count * 3);
    const tileMetres = 7;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n = valueNoise(x / 160, z / 160, 3) * 0.6 + valueNoise(x / 45, z / 45, 9) * 0.4;
      const k = 0.82 + n * 0.32;
      col.set([k * 0.97, k, k * 0.9], i * 3);
      uv.setXY(i, x / tileMetres, z / tileMetres);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    const m = new Mesh(
      g,
      new MeshLambertMaterial({
        map: grass,
        vertexColors: true,
        // Push the ground back in depth so the flat road never z-fights with it.
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 4,
      }),
    );
    return m;
  }

  /** A ring of low, faceted hills on the horizon (one mesh). */
  private buildHills(): Mesh {
    const segs = 72;
    const pos: number[] = [];
    const col: number[] = [];
    const near = new Color(0x5f8a55);
    const far = new Color(0x7fa8a8);
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const h = (a: number, k: number) => 35 + 110 * valueNoise(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, k);
      const r0 = HILL_RADIUS;
      const r1 = HILL_RADIUS + 120;
      const p = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
      const b0 = p(a0, r0, -2);
      const b1 = p(a1, r0, -2);
      const t0 = p(a0, r1, h(a0, 5));
      const t1 = p(a1, r1, h(a1, 5));
      // Faces point inwards, towards the track.
      for (const v of [b0, t0, b1, b1, t0, t1]) pos.push(...v);
      for (const c of [near, far, near, near, far, far]) col.push(c.r, c.g, c.b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return new Mesh(g, new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));
  }

  /** Builds the road, kerbs and scenery for `track` (no-op if it is already shown). */
  setTrack(track: Track): void {
    if (this.currentTrack === track) return;
    this.clearTrack();
    this.currentTrack = track;
    const group = new Group();
    group.name = 'track';
    const road = new Mesh(buildRoadGeometry(track.center), this.mats.road);
    // Drawn after the ground and without writing depth, so where the track crosses
    // itself the two stretches simply overlap instead of flickering (z-fighting).
    road.renderOrder = 1;
    group.add(road);
    const kerbGeo = buildKerbGeometry(track);
    const kerbs = kerbGeo ? new Mesh(kerbGeo, this.mats.kerb) : null;
    if (kerbs) group.add(kerbs);
    const scenery = buildScenery(track, { prop: this.mats.prop, atlas: this.mats.atlas });
    group.add(scenery.group);
    this.scene.add(group);
    this.trackGroup = group;
    this.disposeTrack = () => {
      road.geometry.dispose();
      kerbs?.geometry.dispose();
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
