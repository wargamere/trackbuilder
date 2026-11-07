import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Vector3 } from 'three';

/** The block of falling rain around the camera (m): across, up and along. */
const SPAN = 64;
const HEIGHT = 34;
/** How fast it falls (m/s), and how long a drop's streak is in time (s): the "exposure". */
const FALL = 19;
const EXPOSURE = 0.035;
/** Drops in the block: full and fast graphics. */
const DROPS_FULL = 2200;
const DROPS_FAST = 1100;

/**
 * Rain: a field of short streaks tiled through the world and drawn in a
 * block around the camera, so you drive through it (it doesn't drive with
 * you). Each streak points along the drop's motion as the camera sees it, so
 * at speed it slants towards you. One draw call; the positions are updated
 * on the CPU each frame (a few thousand floats).
 */
export class RainEffect {
  readonly mesh: LineSegments;
  private readonly seeds: Float32Array;
  private readonly pos: Float32BufferAttribute;
  private readonly material: LineBasicMaterial;
  private time = 0;
  private count = DROPS_FULL;
  private readonly last = { x: 0, y: 0, z: 0, ok: false };
  /** Camera velocity, smoothed (m/s). */
  private readonly vel = { x: 0, y: 0, z: 0 };

  constructor() {
    this.seeds = new Float32Array(DROPS_FULL * 3);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = Math.random();
    const g = new BufferGeometry();
    this.pos = new Float32BufferAttribute(new Float32Array(DROPS_FULL * 6), 3);
    g.setAttribute('position', this.pos);
    this.material = new LineBasicMaterial({ color: 0xcdd6e4, transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new LineSegments(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** Fewer drops with fast graphics; dimmer at night. */
  configure(quality: 'full' | 'fast', night: boolean): void {
    this.count = quality === 'fast' ? DROPS_FAST : DROPS_FULL;
    this.mesh.geometry.setDrawRange(0, this.count * 2);
    this.material.color.setHex(night ? 0x8c97ad : 0xcdd6e4);
    this.material.opacity = night ? 0.4 : 0.5;
  }

  /** Moves the rain on by `dt` around the camera at `cam`. */
  update(cam: Vector3, dt: number): void {
    if (!this.mesh.visible) return;
    this.time += dt;
    // The camera's speed (a jump, like a reset, counts as standing still).
    const L = this.last;
    if (L.ok && dt > 0) {
      const vx = (cam.x - L.x) / dt;
      const vy = (cam.y - L.y) / dt;
      const vz = (cam.z - L.z) / dt;
      const ok = vx * vx + vy * vy + vz * vz < 120 * 120;
      const k = 1 - Math.exp(-dt * 10);
      this.vel.x += ((ok ? vx : 0) - this.vel.x) * k;
      this.vel.y += ((ok ? vy : 0) - this.vel.y) * k;
      this.vel.z += ((ok ? vz : 0) - this.vel.z) * k;
    }
    L.x = cam.x;
    L.y = cam.y;
    L.z = cam.z;
    L.ok = true;
    // A streak runs back from the drop along its motion relative to the camera.
    const tx = this.vel.x * EXPOSURE;
    const ty = (FALL + this.vel.y) * EXPOSURE;
    const tz = this.vel.z * EXPOSURE;
    const fall = this.time * FALL;
    const s = this.seeds;
    const p = this.pos.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      // The nearest copy of this drop (tiled every SPAN / HEIGHT m) to the camera.
      const wx = s[i * 3] * SPAN;
      const wy = s[i * 3 + 1] * HEIGHT - fall;
      const wz = s[i * 3 + 2] * SPAN;
      const x = wx + SPAN * Math.round((cam.x - wx) / SPAN);
      const y = wy + HEIGHT * Math.round((cam.y - wy) / HEIGHT);
      const z = wz + SPAN * Math.round((cam.z - wz) / SPAN);
      const o = i * 6;
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
      p[o + 3] = x + tx;
      p[o + 4] = y + ty;
      p[o + 5] = z + tz;
    }
    this.pos.needsUpdate = true;
  }

  show(on: boolean): void {
    this.mesh.visible = on;
    this.last.ok = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
