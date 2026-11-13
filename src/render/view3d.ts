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
  Points,
  PointsMaterial,
  Uint32BufferAttribute,
  Scene,
  SphereGeometry,
  type Texture,
  Vector2,
  WebGLRenderer,
  BackSide,
} from 'three';
import { THEMES, type Theme } from '../config/themes.ts';
import type { RoadSurface, ThemeId, TimeOfDay } from '../config/track.ts';
import { valueNoise } from '../core/random.ts';
import { buildKerbGeometry, buildPitGeometry, buildRoadGeometry, buildRunoffGeometry, buildTunnelGeometry, buildWallGeometry } from '../track/mesh.ts';
import { buildScenery } from '../track/scenery.ts';
import { surfaceFor, TERRAIN_RECT, type Terrain } from '../track/surface.ts';
import type { Track } from '../track/track.ts';
import { tint } from './geom.ts';
import { RainEffect } from './rain.ts';
import { makeAsphaltTexture, makeAtlasTexture, makeGroundTexture } from './textures.ts';

/** What a run is driven in, when it isn't the track's own time of day in the dry. */
export interface ViewConditions {
  time: TimeOfDay;
  /** How hard it's raining (true: full rain), and how wet the road looks (0..1; the rain's by default). */
  rain: boolean | number;
  wet?: number;
}

const GROUND_SIZE = 2800;
const HILL_RADIUS = 1250;
/** Metres per repeat of the ground texture. */
const GROUND_TILE = 7;

/**
 * Owns the WebGL renderer and the 3D scene. Sky, outer ground, hills and
 * lights are built once and recoloured per theme; the track (road, decks,
 * kerbs, barriers, pillars, terrain and scenery) is rebuilt by setTrack().
 * Everything static is merged or instanced: about 15 draw calls in total.
 * The time of day is the track's own unless setConditions() says otherwise
 * (night, with stars and a floodlit road; rain, with a grey sky, close fog,
 * a wet road and the rain itself).
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
  private readonly stars: Points;
  private readonly rain = new RainEffect();
  private conditions: ViewConditions | null = null;
  /** The time of day and weather shown now. */
  private shownTime: TimeOfDay = 'day';
  private shownRain = 0;
  private lastRender = 0;
  private readonly maxAniso: number;
  private readonly mats: {
    road: MeshLambertMaterial;
    deck: MeshLambertMaterial;
    kerb: MeshLambertMaterial;
    wall: MeshLambertMaterial;
    prop: MeshLambertMaterial;
    atlas: MeshLambertMaterial;
    ground: MeshLambertMaterial;
    gravel: MeshLambertMaterial;
    runoffTarmac: MeshLambertMaterial;
  };
  private readonly groundTextures = new Map<ThemeId, Texture>();
  private theme: string | null = null;
  private quality: 'full' | 'fast' = 'full';
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
      // Run-off beside the road: drawn like the road (after the ground, no depth writes).
      gravel: new MeshLambertMaterial({ map: makeGroundTexture({ base: '#cdb991', speck: [1, 0.9, 0.74], lo: 140, hi: 235 }), depthWrite: false }),
      runoffTarmac: new MeshLambertMaterial({ map: asphalt, color: 0xb9bec8, depthWrite: false }),
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
    this.stars = this.buildStars();
    this.scene.add(this.sky, this.ground, this.hills, this.stars, this.rain.mesh);
    this.applyTheme('meadow', 'day', 0, 0);
  }

  /** A few hundred stars on the upper sky (shown on clear nights). */
  private buildStars(): Points {
    const pos: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 520; i++) {
      const a = rnd() * Math.PI * 2;
      const y = 0.08 + 0.92 * Math.sqrt(rnd());
      const r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 1900, y * 1900, Math.sin(a) * r * 1900);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const m = new Points(g, new PointsMaterial({ color: 0xdfe6ff, size: 1.7, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
    m.frustumCulled = false;
    m.renderOrder = -1;
    m.visible = false;
    return m;
  }

  private buildSky(): Mesh {
    const g = new SphereGeometry(2000, 24, 12);
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3));
    const m = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  /**
   * Big flat ground around the track's terrain grid: a frame of four strips
   * with a hole exactly where the terrain mesh goes, so the two never overlap.
   * Vertex colours add large lighter/darker patches.
   */
  private buildOuterGround(): Mesh {
    const R = TERRAIN_RECT;
    const G = GROUND_SIZE / 2;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const strip = (x0: number, z0: number, x1: number, z1: number) => {
      const nx = Math.max(1, Math.round((x1 - x0) / 50));
      const nz = Math.max(1, Math.round((z1 - z0) / 50));
      const base = pos.length / 3;
      for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
          const x = x0 + ((x1 - x0) * i) / nx;
          const z = z0 + ((z1 - z0) * j) / nz;
          const k = groundShade(x, z);
          pos.push(x, 0, z);
          uv.push(x / GROUND_TILE, z / GROUND_TILE);
          col.push(k, k, k);
        }
      }
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const a = base + j * (nx + 1) + i;
          const b = a + 1;
          const c = a + nx + 1;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    };
    strip(-G, -G, G, R.z0);
    strip(-G, R.z1, G, G);
    strip(-G, R.z0, R.x0, R.z1);
    strip(R.x1, R.z0, G, R.z1);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new Mesh(g, this.mats.ground);
  }

  private readonly roadTextures = new Map<RoadSurface, Texture>();

  /** The road's texture for a surface (made once). */
  private roadTexture(kind: RoadSurface): Texture {
    let t = this.roadTextures.get(kind);
    if (!t) {
      t = kind === 'tarmac' ? (this.mats.runoffTarmac.map as Texture) : makeAsphaltTexture(kind);
      t.anisotropy = this.maxAniso;
      this.roadTextures.set(kind, t);
    }
    return t;
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

  /**
   * Graphics quality: "fast" renders at 1 pixel per CSS pixel and sees less
   * far, which helps a lot on slow GPUs; "full" uses up to 2× pixels.
   */
  setQuality(q: 'full' | 'fast'): void {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'fast' ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.applyFog();
    this.rain.configure(q, this.shownTime === 'night', this.shownRain);
    this.camera.far = q === 'fast' ? 1100 : 2400;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getSize(new Vector2());
    this.renderer.setSize(size.x, size.y, false);
  }

  /** How far you can see: less at night, and much less in the rain. */
  private applyFog(): void {
    const fast = this.quality === 'fast';
    let near = fast ? 180 : 260;
    let far = fast ? 900 : 1500;
    if (this.shownTime === 'night') {
      near = 80;
      far = fast ? 650 : 800;
    }
    // The rain closes in the distance as it gets heavier.
    const r = this.shownRain;
    near += (20 - near) * r;
    far += ((fast ? 330 : 400) - far) * r;
    this.fog.near = near;
    this.fog.far = far;
  }

  /**
   * Conditions to show instead of the track's own (null: the track's own time
   * of day, in the dry). The race and the race setup set them; they put the
   * track's own back when they're done.
   */
  setConditions(c: ViewConditions | null): void {
    this.conditions = c;
    const t = this.currentTrack;
    const rain = Number(c?.rain ?? 0);
    this.applyTheme(t?.options.theme ?? 'meadow', c?.time ?? t?.options.time ?? 'day', rain, c?.wet ?? rain);
  }

  /** It's night (cars need their lights). */
  get night(): boolean {
    return this.shownTime === 'night';
  }

  /**
   * Recolours sky, fog, light, hills, ground and road for a theme at a time
   * of day, in `rain` (0 dry … 1 full rain) on a road `wet` wet (0..1).
   */
  private applyTheme(id: ThemeId, time: TimeOfDay, rain: number, wet: number): void {
    const key = `${id}/${time}/${rain.toFixed(2)}/${wet.toFixed(2)}`;
    if (this.theme === key) return;
    this.theme = key;
    this.shownTime = time;
    this.shownRain = rain;
    const th: Theme = THEMES[id];
    const dusk = time === 'sunset';
    const night = time === 'night';
    const mix = (a: number, b: number, t: number) => new Color(a).lerp(new Color(b), t);
    let top: Color;
    let hor: Color;
    let fog: Color;
    let hemiSky: Color;
    let hemiGround: Color;
    let sun: Color;
    let sunIntensity = th.sunIntensity;
    let near: Color;
    let far: Color;
    if (night) {
      // A clear dark-blue night: a dim moon high in the east, the track under floodlights.
      top = mix(th.skyTop, 0x010208, 0.96);
      hor = mix(th.skyHorizon, 0x0b1022, 0.94);
      fog = hor.clone();
      hemiSky = mix(th.hemiSky, 0x4a5a86, 0.82);
      hemiGround = new Color(th.hemiGround).multiplyScalar(0.2);
      sun = new Color(0xb4c2ee);
      sunIntensity *= 0.3;
      this.sun.position.set(0.55, 0.9, -0.4);
      near = new Color(th.hills[0]).multiply(new Color(0x1e2438));
      far = mix(th.hills[1], 0x1b2140, 0.86);
    } else if (dusk) {
      top = mix(th.skyTop, 0x2a2c66, 0.75);
      hor = mix(th.skyHorizon, 0xff9455, 0.8);
      fog = mix(th.skyHorizon, 0xe89a72, 0.7);
      hemiSky = mix(th.hemiSky, 0xffb98c, 0.7);
      hemiGround = new Color(th.hemiGround).multiplyScalar(0.55);
      sun = mix(th.sun, 0xff9a50, 0.8);
      sunIntensity *= 0.85;
      // Low evening sun from the west.
      this.sun.position.set(-1, 0.28, 0.35);
      near = new Color(th.hills[0]).multiply(new Color(0x7a5a6a));
      far = mix(th.hills[1], 0xc9837a, 0.6);
    } else {
      top = new Color(th.skyTop);
      hor = new Color(th.skyHorizon);
      fog = hor.clone();
      hemiSky = new Color(th.hemiSky);
      hemiGround = new Color(th.hemiGround);
      sun = new Color(th.sun);
      // High midday sun.
      this.sun.position.set(-0.45, 1, 0.3);
      near = new Color(th.hills[0]);
      far = new Color(th.hills[1]);
    }
    if (rain > 0) {
      // Low grey cloud: a flat grey sky, the sun hidden, the distance lost in the murk.
      const grey = new Color(night ? 0x161a24 : dusk ? 0x8a7f86 : 0xa3abb6);
      top.lerp(grey, 0.8 * rain).multiplyScalar(night ? 1 : 1 - 0.12 * rain);
      hor.lerp(grey, 0.8 * rain);
      fog.lerp(hor, rain);
      hemiSky.lerp(new Color(night ? 0x3c4458 : 0xc2c8d2), 0.6 * rain);
      sunIntensity *= 1 - 0.7 * rain;
      near.lerp(fog, 0.5 * rain);
      far.lerp(fog, 0.7 * rain);
    }
    this.scene.background = hor;
    this.fog.color.copy(fog);
    this.hemi.color.copy(hemiSky);
    this.hemi.groundColor.copy(hemiGround);
    this.hemi.intensity = night ? 0.5 : 1.6;
    this.sun.color.copy(sun);
    this.sun.intensity = sunIntensity;

    const sg = this.sky.geometry;
    const sp = sg.getAttribute('position');
    const sc = sg.getAttribute('color');
    const c = new Color();
    for (let i = 0; i < sp.count; i++) {
      c.copy(hor).lerp(top, Math.pow(Math.max(0, sp.getY(i) / 2000), dusk ? 0.45 : night ? 0.5 : 0.6));
      sc.setXYZ(i, c.r, c.g, c.b);
    }
    sc.needsUpdate = true;
    this.stars.visible = night && rain < 0.2;

    // Mountains for the Alps, a low skyline for the city.
    this.hills.scale.y = th.hillScale ?? 1;
    const hc = this.hills.geometry.getAttribute('color');
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
    if (this.mats.ground.map !== tex) {
      this.mats.ground.map = tex;
      this.mats.ground.needsUpdate = true;
    }
    this.mats.ground.color.setRGB(...th.groundTint).multiplyScalar(night ? 0.6 : 1);

    // A wet road is darker; at night the floodlights light the track (its own texture, lit
    // evenly however dark the sky).
    const M = this.mats;
    const wetLook = (dry: number, soaked: number) => new Color(dry).lerp(new Color(soaked), wet);
    M.road.color.copy(wetLook(0xffffff, 0x7f858f));
    M.deck.color.copy(wetLook(0xffffff, 0x7f858f));
    M.runoffTarmac.color.copy(wetLook(0xb9bec8, 0x8e939c));
    for (const m of [M.road, M.deck, M.runoffTarmac, M.gravel]) {
      const map = night ? m.map : null;
      if (m.emissiveMap !== map) {
        m.emissiveMap = map;
        m.needsUpdate = true;
      }
      m.emissive.copy(night ? wetLook(0x2a2d33, 0x202329) : new Color(0x000000));
    }
    M.kerb.emissive.setHex(night ? 0x26262b : 0x000000);
    M.wall.emissive.setHex(night ? 0x1a1b20 : 0x000000);
    this.rain.show(rain > 0.02);
    this.rain.configure(this.quality, night, rain);
    this.applyFog();
  }

  /**
   * The terrain around the track as one grid mesh. Each cell is split into two
   * triangles along the same diagonal terrainTri() uses, so what's drawn is
   * exactly what the physics and the "ground under the road" check see.
   */
  private buildTerrainMesh(t: Terrain): Mesh {
    const count = t.nx * t.nz;
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);
    for (let j = 0; j < t.nz; j++) {
      for (let i = 0; i < t.nx; i++) {
        const k = j * t.nx + i;
        const x = t.x0 + i * t.step;
        const z = t.z0 + j * t.step;
        pos.set([x, t.h[k], z], k * 3);
        uv.set([x / GROUND_TILE, z / GROUND_TILE], k * 2);
        const s = groundShade(x, z);
        col.set([s, s, s], k * 3);
      }
    }
    const idx = new Uint32Array((t.nx - 1) * (t.nz - 1) * 6);
    let o = 0;
    for (let j = 0; j < t.nz - 1; j++) {
      for (let i = 0; i < t.nx - 1; i++) {
        const k = j * t.nx + i;
        idx.set([k, k + t.nx, k + 1, k + t.nx, k + t.nx + 1, k + 1], o);
        o += 6;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(new Uint32BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return new Mesh(g, this.mats.ground);
  }

  /** Builds the road, kerbs, barriers, terrain and scenery for `track` (no-op if it is already shown). */
  setTrack(track: Track): void {
    if (this.currentTrack === track) return;
    this.clearTrack();
    this.currentTrack = track;
    const c = this.conditions;
    const rain = Number(c?.rain ?? 0);
    this.applyTheme(track.options.theme, c?.time ?? track.options.time, rain, c?.wet ?? rain);
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
    // Tarmac, dirt or snow.
    const roadTex = this.roadTexture(track.options.road);
    for (const m of [this.mats.road, this.mats.deck]) {
      if (m.map === roadTex) continue;
      if (m.emissiveMap) m.emissiveMap = roadTex;
      m.map = roadTex;
      m.needsUpdate = true;
    }
    add(road.ground, this.mats.road, 1);
    add(road.deck, this.mats.deck, 2);
    add(buildRunoffGeometry(track, surf, 'gravel'), this.mats.gravel, 0.5);
    add(buildRunoffGeometry(track, surf, 'tarmac'), this.mats.runoffTarmac, 0.5);
    add(buildKerbGeometry(track), this.mats.kerb);
    add(buildWallGeometry(track, surf), this.mats.wall);
    add(buildPitGeometry(track, surf), this.mats.wall);
    add(buildTunnelGeometry(track), this.mats.wall);

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
    this.renderer.setPixelRatio(this.quality === 'fast' ? 1 : Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    const now = performance.now() / 1000;
    const dt = this.lastRender ? Math.min(0.1, Math.max(0, now - this.lastRender)) : 1 / 60;
    this.lastRender = now;
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.rain.update(this.camera.position, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Hides everything that isn't the world or the track (the cars), e.g. for
   * the editor's 3D view; returns a function that puts it back.
   */
  hideExtras(): () => void {
    const keep = new Set<unknown>([this.sky, this.ground, this.hills, this.hemi, this.sun, this.stars, this.rain.mesh, this.trackGroup]);
    const hidden = this.scene.children.filter((o) => !keep.has(o) && o.visible);
    for (const o of hidden) o.visible = false;
    return () => {
      for (const o of hidden) o.visible = true;
    };
  }

  /** Fog distances (the editor's 3D view looks at the whole track from far away). */
  setFog(near: number, far: number): void {
    this.fog.near = near;
    this.fog.far = far;
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
