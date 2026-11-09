import { HANDLING } from '../config/handling.ts';
import { RACING_LINE, SETUP } from '../config/race.ts';
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
  /**
   * Room beside the line, to its left and right (m), smoothed into a gentle,
   * cautious envelope. Paths beside the line are the line shifted sideways by
   * at most this much, so they're as smooth as the line is. (Shifting into the
   * raw road edge instead would copy every wiggle of the centre line and every
   * step where a kerb starts, and a car at the limit can't follow those.)
   */
  roomLeft: Float32Array;
  roomRight: Float32Array;
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
  // A cautious, smooth envelope of the road: the narrowest it gets nearby, then averaged.
  const W = RACING_LINE.envelope;
  const erode = (arr: Float32Array, pick: (a: number, b: number) => number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = arr[i];
      for (let o = -W; o <= W; o++) v = pick(v, arr[wrapI(i + o)]);
      out[i] = v;
    }
    return out;
  };
  const blur = (arr: Float32Array) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let o = -W; o <= W; o++) sum += arr[wrapI(i + o)];
      out[i] = sum / (2 * W + 1);
    }
    return out;
  };
  // The road's edges, at their narrowest nearby (where kerbs start and stop) and a little in
  // from them (a car beside the line is racing someone, not on the limit); the room is from the
  // line as it is here out to those, smoothed, and never past the edge itself.
  const inset = RACING_LINE.laneInset;
  const hiE = erode(hi, Math.min).map((x) => x - inset);
  const loE = erode(lo, Math.max).map((x) => x + inset);
  const spareLeft = new Float32Array(n);
  const spareRight = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    spareLeft[i] = Math.max(0, hiE[i] - offset[i]);
    spareRight[i] = Math.max(0, offset[i] - loE[i]);
  }
  const roomLeft = blur(spareLeft);
  const roomRight = blur(spareRight);
  for (let i = 0; i < n; i++) {
    roomLeft[i] = Math.min(roomLeft[i], Math.max(0, hi[i] - offset[i]));
    roomRight[i] = Math.min(roomRight[i], Math.max(0, offset[i] - lo[i]));
  }
  const line: RacingLine = { offset, curvature, ds, lo, hi, roomLeft, roomRight };
  cache.set(track, line);
  return line;
}

/**
 * How hard a driver pushes: share of the tyres' grip used in corners, of the
 * brakes, and a top speed (m/s); and the car's wing (SETUP.wing), if it isn't
 * the standard one: its downforce and drag.
 */
export interface Pace {
  grip: number;
  brake: number;
  maxSpeed: number;
  downforce?: number;
  drag?: number;
}

/**
 * Sideways acceleration the car can hold at `grip` of the tyres' grip in a
 * bend of curvature `k` (signed like a yaw rate) on a road banked `bank`
 * (rad, + = left side up): the tyres plus the help from a bank that leans
 * into the turn, as the physics gives it.
 */
export function cornerGrip(k: number, bank: number, grip: number): number {
  const H = HANDLING;
  const assist = G * Math.sin(Math.abs(bank)) * (Math.sign(bank) === Math.sign(k) ? 1 : -0.5);
  return Math.max(H.maxLateralAccel * 0.5, H.maxLateralAccel + assist * H.bankGripFactor) * grip;
}

/** Deceleration available from the brakes at `brake` of their force, plus drag (× `drag`, the wing's), at speed v on slope `grade`. */
export const brakingDecel = (brake: number, v: number, grade: number, drag = 1): number =>
  HANDLING.brakeDecel * brake + HANDLING.rollingDrag + HANDLING.aeroDrag * drag * v * v + G * HANDLING.slopeFactor * grade;

/** The car's top speed on the flat (m/s) with drag × `drag` (the wing): where the engine's pull meets the drag. */
export function topSpeed(drag = 1): number {
  const H = HANDLING;
  // engineAccel (1 − v / maxSpeed) = rollingDrag + aeroDrag·drag·v²
  const a = H.aeroDrag * drag;
  const b = H.engineAccel / H.maxSpeed;
  const c = H.rollingDrag - H.engineAccel;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/**
 * The speed (m/s) a bend of curvature `k` allows at `grip` (see cornerGrip),
 * with a wing giving `downforce` (more grip the faster: × 1 + downforce ×
 * (v / SETUP.downforceSpeed)², as in the physics). Infinity when the
 * downforce would hold any speed.
 */
export function cornerSpeed(k: number, bank: number, grip: number, downforce = 0): number {
  const a = cornerGrip(k, bank, grip);
  const den = Math.max(Math.abs(k), 1e-5) - (a * downforce) / SETUP.downforceSpeed ** 2;
  return den <= 1e-7 ? Infinity : Math.sqrt(a / den);
}

/** Speeds along the line (m/s per sample). */
export interface SpeedPlan {
  /** What the car can actually do: as fast as each corner allows, reached by accelerating out of the one before and braking for the next. */
  speed: Float32Array;
  /** Just the corner and braking limits (no "can it get up to that speed" pass): drive flat out below it. */
  limit: Float32Array;
  /** Just the corner limits (where `limit` is lower, the car is braking for the next one). */
  corner: Float32Array;
}

/**
 * The speeds to drive at along the line: as fast as each corner allows (see
 * cornerGrip), then limited by how quickly the car can speed up out of the
 * corners before (engine, drag, slopes) and must slow down for the ones after
 * (`brake` of the brakes, drag, slopes).
 */
export function speedProfile(track: Track, line: RacingLine, pace: Pace): SpeedPlan {
  const drag = pace.drag ?? 1;
  const H = HANDLING;
  const c = track.center;
  const n = c.points.length;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = line.curvature[i];
    v[i] = Math.min(pace.maxSpeed, cornerSpeed(k, c.bank[i], pace.grip, pace.downforce));
  }
  const brakeBack = (arr: Float32Array) => {
    // Twice round, so the limits carry across the start line.
    for (let round = 0; round < 2; round++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        const reach = Math.sqrt(Math.max(0, arr[j] * arr[j] + 2 * brakingDecel(pace.brake, arr[j], c.grade[i], drag) * line.ds[i]));
        if (reach < arr[i]) arr[i] = reach;
      }
    }
  };
  const corner = Float32Array.from(v);
  const limit = Float32Array.from(v);
  brakeBack(limit);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const vi = v[i];
      const acc = H.engineAccel * Math.max(0, 1 - vi / H.maxSpeed) - H.rollingDrag - H.aeroDrag * drag * vi * vi - G * H.slopeFactor * c.grade[i];
      const reach = Math.sqrt(Math.max(0, vi * vi + 2 * acc * line.ds[i]));
      if (reach < v[j]) v[j] = reach;
    }
  }
  brakeBack(v);
  return { speed: v, limit, corner };
}

/** Seconds to drive the line once at the speeds of `plan`. */
export function planLapTime(line: RacingLine, plan: SpeedPlan): number {
  let t = 0;
  for (let i = 0; i < plan.speed.length; i++) t += line.ds[i] / Math.max(1, plan.speed[i]);
  return t;
}
