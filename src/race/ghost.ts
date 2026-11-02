import { HANDLING } from '../config/handling.ts';
import { angleDelta } from '../car/physics.ts';

/**
 * A recorded lap: the car's position and heading at every physics tick, plus
 * the lap time of the first sample (the lap starts part-way through a tick).
 */
export interface GhostLap {
  /** Lap time (s) of sample 0. */
  t0: number;
  /** x, z, heading per tick. */
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
    return { t0: this.t0, data: this.buf.slice(0, this.n * STRIDE) };
  }
}

/** Ghost pose at `lapTime` seconds into the lap (interpolated), or null outside the recording. */
export function ghostPose(g: GhostLap, lapTime: number): { x: number; z: number; heading: number } | null {
  const n = g.data.length / STRIDE;
  const u = (lapTime - g.t0) * HANDLING.tickRate;
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
