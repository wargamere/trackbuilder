import { BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Uint32BufferAttribute } from 'three';
import { ASSISTS } from '../config/race.ts';
import type { RacingDriver } from '../race/driver.ts';
import { leftOf, surfaceY } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

/** Screen colours (sRGB) to the linear values vertex colours are given in. */
const linear = (c: readonly [number, number, number]) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
const GREEN = linear([0.1, 0.78, 0.3]);
const YELLOW = linear([1, 0.78, 0.0]);
const RED = linear([0.95, 0.15, 0.12]);

/**
 * The racing line drawn on the road ahead of the car, coloured by what to do
 * when you get there at the speed you're doing now: green (keep going), yellow
 * (lift), red (brake: the corner's limit there is below your speed). So the
 * red starts exactly where you'd have to start braking, and moves as you speed
 * up or slow down. "Braking" mode draws only the yellow and red. It lies on
 * the road surface (banking and bridges included), and fades in and out.
 */
export class RacingLineOverlay {
  readonly mesh: Mesh;
  readonly track: Track;
  private readonly driver: RacingDriver;
  private readonly colors: Float32Array;
  private readonly colorAttr: BufferAttribute;
  private readonly n: number;
  /** Samples coloured last frame (from, count), so they can be cleared. */
  private lit = { from: 0, count: 0 };

  constructor(track: Track, driver: RacingDriver) {
    this.track = track;
    this.driver = driver;
    const c = track.center;
    const n = c.points.length;
    this.n = n;
    const half = ASSISTS.lineWidth / 2;
    const pos = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const p = c.points[i];
      const l = leftOf(c.tangents[i]);
      const off = driver.line.offset[i];
      for (const [k, side] of [
        [0, half],
        [1, -half],
      ] as const) {
        const w = off + side;
        pos.set([p.x + l.x * w, surfaceY(c, i, w) + ASSISTS.lineLift, p.y + l.y * w], (i * 2 + k) * 3);
      }
    }
    const idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      idx.set([a, a + 1, b, a + 1, b + 1, b], i * 6);
    }
    this.colors = new Float32Array(n * 2 * 4);
    this.colorAttr = new BufferAttribute(this.colors, 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', this.colorAttr);
    g.setIndex(new Uint32BufferAttribute(idx, 1));
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      // Drawn over the road (and kerbs) it lies on.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Colours the line ahead of a car at centre-line sample `index` doing `speed` (m/s). */
  update(index: number, speed: number, mode: 'brake' | 'full'): void {
    const c = this.track.center;
    const n = this.n;
    for (let k = 0; k < this.lit.count; k++) this.paint((this.lit.from + k) % n, 0, 0, 0, 0);
    const from = (Math.max(0, index) + 2) % n;
    const count = Math.min(n - 4, Math.round(ASSISTS.lineAhead / c.spacing));
    const v = Math.max(0, speed);
    for (let k = 0; k < count; k++) {
      const i = (from + k) % n;
      const share = v / Math.max(1, this.driver.limit[i]);
      const rgb = share >= 1 ? RED : share >= ASSISTS.liftShare ? YELLOW : GREEN;
      if (mode === 'brake' && rgb === GREEN) {
        this.paint(i, 0, 0, 0, 0);
        continue;
      }
      // Fade in just ahead of the car, and out towards the far end.
      const d = k * c.spacing;
      const a = 0.9 * Math.min(1, d / 6) * Math.min(1, (ASSISTS.lineAhead - d) / 45);
      this.paint(i, rgb[0], rgb[1], rgb[2], a);
    }
    this.lit = { from, count };
    this.colorAttr.needsUpdate = true;
  }

  private paint(i: number, r: number, g: number, b: number, a: number): void {
    this.colors.set([r, g, b, a, r, g, b, a], i * 8);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
