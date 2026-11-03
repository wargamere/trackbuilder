import { HANDLING } from '../config/handling.ts';
import { RACING_LINE } from '../config/race.ts';
import { kerbAt, kerbLayout } from '../track/kerbs.ts';
import { edgeOffsets, leftOf } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

const G = 9.81;

/**
 * The fastest way round a track, for the AI: a line through the corners
 * (outside, inside at the apex, outside again) and the speed it can be driven
 * at. Indexed like the centre line: sample i of the line is beside centre-line
 * sample i, `offset[i]` metres to its left (negative = right).
 */
export interface RacingLine {
  offset: Float32Array;
  /** Signed curvature of the line (1/m): + is a right-hander, like a positive yaw rate. */
  curvature: Float32Array;
  /** Length of the line from sample i to i + 1 (m). */
  ds: Float32Array;
  /** How far left (hi) and right (lo, negative) of the centre a car may drive: the road and its kerbs, minus the car's half-width. */
  lo: Float32Array;
  hi: Float32Array;
}

const cache = new WeakMap<Track, RacingLine>();

/**
 * The line that bends as little as possible while staying on the road
 * (kerbs included), worked out the way Rémi Coulom's K1999 racing robot does
 * it: each point is moved across the road until the line's curvature there is
 * the average of the curvature just before and just after it, so turning is
 * spread as evenly as the road allows. Doing it first with points far apart
 * (64 samples), then closer and closer, settles whole corners quickly. What
 * comes out is the classic line: in from the outside, clipping the apex, and
 * out to the outside again, with straights cutting across from one corner's
 * exit to the next one's entry.
 */
export function racingLine(track: Track): RacingLine {
  const hit = cache.get(track);
  if (hit) return hit;
  const c = track.center;
  const n = c.points.length;
  const { left, right } = edgeOffsets(c);
  const kerbs = kerbLayout(track);
  const margin = HANDLING.halfWidth + RACING_LINE.edgeMargin;
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = Math.max(left[i], kerbAt(kerbs, i, 1)?.[1] ?? 0) - margin;
    const r = Math.max(right[i], kerbAt(kerbs, i, -1)?.[1] ?? 0) - margin;
    hi[i] = Math.max(0, l);
    lo[i] = -Math.max(0, r);
  }
  // The kerbs make the corridor jump wider and narrower; let the line use them only
  // where it changes gently (a jump in the corridor would put a kink in the line).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      hi[i] = Math.min(hi[i], Math.max(hi[a], hi[b]) - 0.0, (hi[a] + hi[b]) / 2 + RACING_LINE.corridorStep);
      lo[i] = Math.max(lo[i], Math.min(lo[a], lo[b]) + 0.0, (lo[a] + lo[b]) / 2 - RACING_LINE.corridorStep);
    }
  }
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  const lx = new Float64Array(n);
  const lz = new Float64Array(n);
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const l = leftOf(c.tangents[i]);
    lx[i] = l.x;
    lz[i] = l.y;
    cx[i] = c.points[i].x;
    cz[i] = c.points[i].y;
  }
  const X = (i: number) => cx[i] + lx[i] * e[i];
  const Z = (i: number) => cz[i] + lz[i] * e[i];
  const wrapI = (i: number) => ((i % n) + n) % n;
  /** Signed inverse radius of the circle through points a, (x, z), b (+ = turning right). */
  const rInv = (ax: number, az: number, x: number, z: number, bx: number, bz: number) => {
    const ux = x - ax;
    const uz = z - az;
    const vx = bx - x;
    const vz = bz - z;
    const cross = ux * vz - uz * vx;
    const den = Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(bx - ax, bz - az);
    return den > 1e-12 ? (2 * cross) / den : 0;
  };
  /** Moves point i (between `p` and `q`) across the road so the line's curvature there is `target`. */
  const adjust = (p: number, i: number, q: number, target: number) => {
    const ax = X(p);
    const az = Z(p);
    const bx = X(q);
    const bz = Z(q);
    // First onto the straight from p to q (zero curvature)…
    const dx = bx - ax;
    const dz = bz - az;
    const den = dx * lz[i] - dz * lx[i];
    if (Math.abs(den) < 1e-9) return;
    let off = (dx * (az - cz[i]) - dz * (ax - cx[i])) / den;
    // …then out by however far gives the target curvature (curvature is about linear in it).
    const h = 0.01;
    const k1 = rInv(ax, az, cx[i] + lx[i] * (off + h), cz[i] + lz[i] * (off + h), bx, bz);
    if (Math.abs(k1) > 1e-9) off += (target / k1) * h;
    e[i] = Math.min(hi[i], Math.max(lo[i], off));
  };
  for (let step: number = RACING_LINE.firstStep; step >= 1; step = Math.floor(step / 2)) {
    if (step * 4 > n) continue;
    const iterations = Math.round(RACING_LINE.iterations * Math.sqrt(step));
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i += step) {
        const p = wrapI(i - step);
        const q = wrapI(i + step);
        const pp = wrapI(i - 2 * step);
        const qq = wrapI(i + 2 * step);
        const k0 = rInv(X(pp), Z(pp), X(p), Z(p), X(i), Z(i));
        const k2 = rInv(X(i), Z(i), X(q), Z(q), X(qq), Z(qq));
        const d0 = Math.hypot(X(i) - X(p), Z(i) - Z(p));
        const d2 = Math.hypot(X(q) - X(i), Z(q) - Z(i));
        adjust(p, i, q, (d2 * k0 + d0 * k2) / Math.max(1e-6, d0 + d2));
      }
    }
    // Fill in between the points just placed, ready for the next, finer round.
    if (step > 1) {
      for (let i = 0; i < n; i += step) {
        const j = i + step;
        const ej = e[wrapI(j)];
        for (let k = 1; k < step && i + k < n; k++) {
          const m = i + k;
          e[m] = Math.min(hi[m], Math.max(lo[m], e[i] + ((ej - e[i]) * k) / step));
        }
      }
    }
  }
  const offset = Float32Array.from(e);
  const ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ds[i] = Math.max(0.1, Math.hypot(X(j) - X(i), Z(j) - Z(i)));
  }
  // Curvature from the circle through points two samples either side, then lightly smoothed.
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = wrapI(i - 2);
    const b = wrapI(i + 2);
    raw[i] = rInv(X(a), Z(a), X(i), Z(i), X(b), Z(b));
  }
  const curvature = new Float32Array(n);
  for (let i = 0; i < n; i++) curvature[i] = (raw[wrapI(i - 1)] + 2 * raw[i] + raw[wrapI(i + 1)]) / 4;
  const line: RacingLine = { offset, curvature, ds, lo, hi };
  cache.set(track, line);
  return line;
}

/** How hard a driver pushes: share of the tyres' grip used in corners, of the brakes, and a top speed (m/s). */
export interface Pace {
  grip: number;
  brake: number;
  maxSpeed: number;
}

/**
 * The speed to drive at each sample of the line: as fast as the corner allows
 * (`grip` of the tyres' sideways grip, plus the help from a bank that leans
 * into the turn, as the physics gives it), then limited by how quickly the car
 * can speed up out of the corners before and must slow down for the ones
 * after (engine, drag, slopes and `brake` of the brakes).
 */
export function speedProfile(track: Track, line: RacingLine, pace: Pace): Float32Array {
  const H = HANDLING;
  const c = track.center;
  const n = c.points.length;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = line.curvature[i];
    const bank = c.bank[i];
    const assist = G * Math.sin(Math.abs(bank)) * (Math.sign(bank) === Math.sign(k) ? 1 : -0.5);
    const lat = Math.max(H.maxLateralAccel * 0.5, H.maxLateralAccel + assist * H.bankGripFactor) * pace.grip;
    v[i] = Math.min(pace.maxSpeed, Math.sqrt(lat / Math.max(Math.abs(k), 1e-5)));
  }
  const slope = (i: number) => G * H.slopeFactor * c.grade[i];
  // Twice round, so the limits carry across the start line.
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const vi = v[i];
      const acc = H.engineAccel * Math.max(0, 1 - vi / H.maxSpeed) - H.rollingDrag - H.aeroDrag * vi * vi - slope(i);
      const reach = Math.sqrt(Math.max(0, vi * vi + 2 * acc * line.ds[i]));
      if (reach < v[j]) v[j] = reach;
    }
  }
  for (let round = 0; round < 2; round++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const vj = v[j];
      const dec = H.brakeDecel * pace.brake + H.rollingDrag + H.aeroDrag * vj * vj + slope(i);
      const reach = Math.sqrt(Math.max(0, vj * vj + 2 * dec * line.ds[i]));
      if (reach < v[i]) v[i] = reach;
    }
  }
  return v;
}
