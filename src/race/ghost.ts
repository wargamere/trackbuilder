import { HANDLING } from '../config/handling.ts';
import { angleDelta } from '../car/physics.ts';
import { fromBase64Url, toBase64Url } from '../core/base64.ts';

/**
 * A recorded lap: the car's position and heading at every physics tick, plus
 * the lap time of the first sample (the lap starts part-way through a tick).
 */
export interface GhostLap {
  /** Lap time (s) of sample 0. */
  t0: number;
  /** Samples per second (the physics rate when recorded; lower when loaded from storage). */
  rate: number;
  /** x, z, heading per sample. */
  data: Float32Array;
}

const STRIDE = 3;

/** Records the current lap tick by tick. */
export class GhostRecorder {
  private buf = new Float32Array(STRIDE * 120 * 60);
  private n = 0;
  private t0 = 0;

  /** Starts a new lap whose first sample is `t0` seconds into it. */
  start(t0: number): void {
    this.n = 0;
    this.t0 = t0;
  }

  push(x: number, z: number, heading: number): void {
    if ((this.n + 1) * STRIDE > this.buf.length) {
      const bigger = new Float32Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf.set([x, z, heading], this.n * STRIDE);
    this.n++;
  }

  /** A copy of the lap recorded so far. */
  take(): GhostLap {
    return { t0: this.t0, rate: HANDLING.tickRate, data: this.buf.slice(0, this.n * STRIDE) };
  }
}

/** Ghost pose at `lapTime` seconds into the lap (interpolated), or null outside the recording. */
export function ghostPose(g: GhostLap, lapTime: number): { x: number; z: number; heading: number } | null {
  const n = g.data.length / STRIDE;
  const u = (lapTime - g.t0) * g.rate;
  if (n < 2 || u < 0) return null;
  const i = Math.floor(u);
  if (i >= n - 1) {
    const k = (n - 1) * STRIDE;
    return { x: g.data[k], z: g.data[k + 1], heading: g.data[k + 2] };
  }
  const f = u - i;
  const a = i * STRIDE;
  const b = a + STRIDE;
  const d = g.data;
  return {
    x: d[a] + (d[b] - d[a]) * f,
    z: d[a + 1] + (d[b + 1] - d[a + 1]) * f,
    heading: d[a + 2] + angleDelta(d[a + 2], d[b + 2]) * f,
  };
}

/** Stored ghosts keep every 4th physics tick (30 per second): plenty for smooth replay. */
const STORE_EVERY = 4;
const POS_SCALE = 20; // 5 cm steps
const ANGLE_SCALE = 10000; // 0.0001 rad steps

/**
 * Compact text form of a ghost for storage: a small header, then int16
 * x, z, heading per sample, as base64url. About 11 KB for a 45 s lap.
 */
export function encodeGhost(g: GhostLap): string {
  const every = Math.max(1, Math.round(g.rate / (HANDLING.tickRate / STORE_EVERY)));
  const n = Math.floor((g.data.length / STRIDE - 1) / every) + 1;
  const buf = new ArrayBuffer(10 + n * 6);
  const v = new DataView(buf);
  v.setUint8(0, 1); // format version
  v.setUint8(1, Math.round(g.rate / every));
  v.setFloat32(2, g.t0, true);
  v.setUint32(6, n, true);
  const clamp16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)));
  for (let i = 0; i < n; i++) {
    const k = i * every * STRIDE;
    let h = g.data[k + 2] % (Math.PI * 2);
    if (h > Math.PI) h -= Math.PI * 2;
    if (h < -Math.PI) h += Math.PI * 2;
    v.setInt16(10 + i * 6, clamp16(g.data[k] * POS_SCALE), true);
    v.setInt16(12 + i * 6, clamp16(g.data[k + 1] * POS_SCALE), true);
    v.setInt16(14 + i * 6, clamp16(h * ANGLE_SCALE), true);
  }
  return toBase64Url(new Uint8Array(buf));
}

export function decodeGhost(s: string): GhostLap | null {
  const bytes = fromBase64Url(s);
  if (!bytes || bytes.length < 10) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== 1) return null;
  const rate = v.getUint8(1);
  const t0 = v.getFloat32(2, true);
  const n = v.getUint32(6, true);
  if (!rate || bytes.length !== 10 + n * 6) return null;
  const data = new Float32Array(n * STRIDE);
  for (let i = 0; i < n; i++) {
    data[i * 3] = v.getInt16(10 + i * 6, true) / POS_SCALE;
    data[i * 3 + 1] = v.getInt16(12 + i * 6, true) / POS_SCALE;
    data[i * 3 + 2] = v.getInt16(14 + i * 6, true) / ANGLE_SCALE;
  }
  return { t0, rate, data };
}
