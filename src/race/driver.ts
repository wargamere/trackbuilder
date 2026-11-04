import { angleDelta, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { DRIVER } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { leftOf } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { brakingDecel, cornerGrip, racingLine, speedProfile, type Pace, type RacingLine, type SpeedPlan } from './racingLine.ts';

/** A stretch across the road (m left of the centre line) for a car to keep within. */
export interface Corridor {
  lo: number;
  hi: number;
}

/**
 * Drives the racing line at a pace: steers for a point on the line a little
 * ahead (further at speed), and works throttle and brakes to the speed the
 * line allows there, looking a moment ahead so it brakes on time. `lane`
 * shifts it sideways off the line (to pass someone), within the road.
 */
export class RacingDriver {
  readonly line: RacingLine;
  /** The speed it can do at each sample of the line (m/s). */
  readonly speed: Float32Array;
  /** The corner and braking limit at each sample: it drives flat out below this. */
  readonly limit: Float32Array;
  readonly pace: Pace;
  private readonly track: Track;

  /** Offsets from the line (sorted) that have a speed plan of their own, and those plans' corner and braking limits. */
  private readonly laneOffsets: readonly number[];
  private readonly laneLimits: Float32Array[];
  /** What it can actually do in each lane (accelerating out of the bends too). */
  private readonly laneSpeeds: Float32Array[];
  /** Seconds to drive each sample of each lane at that speed (for judging what a lane costs). */
  private readonly laneTimes: Float32Array[];

  constructor(track: Track, pace: Pace) {
    this.track = track;
    this.pace = pace;
    this.line = racingLine(track);
    const plan = speedProfile(track, this.line, pace);
    this.speed = plan.speed;
    this.limit = plan.limit;
    // A speed plan for each lane beside the line too: its own bends (the line shifted
    // sideways within the room there is), a little grip kept in hand, its own braking.
    this.laneOffsets = [...new Set([0, ...DRIVER.planLanes])].sort((a, b) => a - b);
    const plans = this.laneOffsets.map((o) => (o === 0 ? plan : this.lanePlan(o)));
    this.laneLimits = plans.map((p) => p.limit);
    this.laneSpeeds = plans.map((p) => p.speed);
    this.laneTimes = this.laneSpeeds.map((sp) => {
      const n = sp.length;
      const t = new Float32Array(n);
      for (let i = 0; i < n; i++) t[i] = this.track.center.spacing / Math.max(2, sp[i]);
      return t;
    });
  }

  /** Corner and braking limits along the line shifted `o` metres sideways, and the speeds it can really reach there. */
  private lanePlan(o: number): SpeedPlan {
    const c = this.track.center;
    const n = c.points.length;
    const v = new Float32Array(n);
    const lat = (x: number) => this.lateralAt(x, o);
    for (let i = 0; i < n; i++) {
      const s = i * c.spacing;
      const k = this.pathCurvature(s, lat);
      v[i] = Math.min(this.pace.maxSpeed, Math.sqrt(cornerGrip(k, c.bank[i], this.pace.grip * DRIVER.offLineGrip) / Math.max(Math.abs(k), 1e-5)));
    }
    // Light smoothing (the curvature of a shifted path is a little noisy), keeping the lows.
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) sm[i] = Math.min(v[i], (v[(i - 1 + n) % n] + v[i] + v[(i + 1) % n]) / 3);
    const brakeBack = (arr: Float32Array) => {
      for (let round = 0; round < 2; round++) {
        for (let i = n - 1; i >= 0; i--) {
          const j = (i + 1) % n;
          const reach = Math.sqrt(arr[j] * arr[j] + 2 * brakingDecel(this.pace.brake, arr[j], c.grade[i]) * c.spacing);
          if (reach < arr[i]) arr[i] = reach;
        }
      }
    };
    brakeBack(sm);
    // And how fast it really gets there, accelerating out of each bend.
    const H = HANDLING;
    const sp = Float32Array.from(sm);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const vi = sp[i];
        const acc = H.engineAccel * Math.max(0, 1 - vi / H.maxSpeed) - H.rollingDrag - H.aeroDrag * vi * vi - 9.81 * H.slopeFactor * c.grade[i];
        const reach = Math.sqrt(Math.max(0, vi * vi + 2 * acc * c.spacing));
        if (reach < sp[j]) sp[j] = reach;
      }
    }
    brakeBack(sp);
    return { limit: sm, speed: sp };
  }

  /** Corner and braking limit at `s` on the lane `lane` metres beside the line (between the planned lanes, the slower). */
  laneLimitAt(s: number, lane: number): number {
    const offs = this.laneOffsets;
    if (lane <= offs[0]) return this.at(this.laneLimits[0], s);
    if (lane >= offs[offs.length - 1]) return this.at(this.laneLimits[offs.length - 1], s);
    let k = 0;
    while (offs[k + 1] < lane) k++;
    return Math.min(this.at(this.laneLimits[k], s), this.at(this.laneLimits[k + 1], s));
  }

  /** The speed it can really do at `s` in lane `lane` metres beside the line (between the planned lanes, the slower). */
  laneSpeedAt(s: number, lane: number): number {
    if (Math.abs(lane) < DRIVER.offLine) return this.at(this.speed, s);
    const offs = this.laneOffsets;
    if (lane <= offs[0]) return this.at(this.laneSpeeds[0], s);
    if (lane >= offs[offs.length - 1]) return this.at(this.laneSpeeds[offs.length - 1], s);
    let k = 0;
    while (offs[k + 1] < lane) k++;
    return Math.min(this.at(this.laneSpeeds[k], s), this.at(this.laneSpeeds[k + 1], s));
  }

  /** Seconds lost driving the next `dist` metres in lane `lane` rather than on the line, both as fast as they go. */
  laneTimeLost(s: number, lane: number, dist: number): number {
    return Math.max(0, this.laneTime(s, lane, dist) - this.laneTime(s, 0, dist));
  }

  /** How fast lane `lane` is over the next `dist` metres, as a share of the line (1 = as fast). */
  laneSpeedShare(s: number, lane: number, dist: number): number {
    return Math.min(1, this.laneTime(s, 0, dist) / Math.max(1e-6, this.laneTime(s, lane, dist)));
  }

  /** Seconds to drive the next `dist` metres in the planned lane nearest `lane`, at its limit. */
  private laneTime(s: number, lane: number, dist: number): number {
    const offs = this.laneOffsets;
    let k = 0;
    let best = Infinity;
    for (let j = 0; j < offs.length; j++) {
      const d = Math.abs(offs[j] - lane);
      if (d < best) {
        best = d;
        k = j;
      }
    }
    const c = this.track.center;
    const n = c.points.length;
    const i0 = Math.floor((((s / c.spacing) % n) + n) % n);
    const steps = Math.ceil(dist / c.spacing);
    let t = 0;
    for (let d = 0; d < steps; d++) t += this.laneTimes[k][(i0 + d) % n];
    return t;
  }

  /** Linear interpolation of a per-sample array at distance `s` along the track. */
  private at(arr: Float32Array, s: number): number {
    const c = this.track.center;
    const n = c.points.length;
    const f = (((s / c.spacing) % n) + n) % n;
    const i = Math.floor(f);
    const u = f - i;
    return arr[i] * (1 - u) + arr[(i + 1) % n] * u;
  }

  /**
   * Where the driver wants to be across the road at `s`: the line shifted
   * `lane` metres sideways, by no more than the (smoothed) room there is
   * beside the line, so every such path is as smooth as the line itself.
   */
  lateralAt(s: number, lane = 0): number {
    const line = this.at(this.line.offset, s);
    if (lane === 0) return line;
    return line + clamp(lane, -this.at(this.line.roomRight, s), this.at(this.line.roomLeft, s));
  }

  /** The point the driver aims to be at, `s` metres along the track. */
  pointAt(s: number, lane = 0): { x: number; z: number } {
    const c = this.track.center;
    const n = c.points.length;
    const f = (((s / c.spacing) % n) + n) % n;
    const i = Math.floor(f);
    const u = f - i;
    const j = (i + 1) % n;
    const lat = this.lateralAt(s, lane);
    const l0 = leftOf(c.tangents[i]);
    const l1 = leftOf(c.tangents[j]);
    const px = c.points[i].x + (c.points[j].x - c.points[i].x) * u + (l0.x + (l1.x - l0.x) * u) * lat;
    const pz = c.points[i].y + (c.points[j].y - c.points[i].y) * u + (l0.y + (l1.y - l0.y) * u) * lat;
    return { x: px, z: pz };
  }

  /** Curvature of the line at `s` (1/m; + = right-hander). */
  curvatureAt(s: number): number {
    return this.at(this.line.curvature, s);
  }

  /** The speed it can do on the line at `s` (m/s). */
  speedAt(s: number): number {
    return this.at(this.speed, s);
  }

  /** The corner and braking limit on the line at `s` (m/s). */
  limitAt(s: number): number {
    return this.at(this.limit, s);
  }

  /** The point `lat` metres left of the centre line, `s` metres along it. */
  private worldAt(s: number, lat: number): { x: number; z: number } {
    const c = this.track.center;
    const n = c.points.length;
    const f = (((s / c.spacing) % n) + n) % n;
    const i = Math.floor(f);
    const u = f - i;
    const j = (i + 1) % n;
    const l0 = leftOf(c.tangents[i]);
    const l1 = leftOf(c.tangents[j]);
    return {
      x: c.points[i].x + (c.points[j].x - c.points[i].x) * u + (l0.x + (l1.x - l0.x) * u) * lat,
      z: c.points[i].y + (c.points[j].y - c.points[i].y) * u + (l0.y + (l1.y - l0.y) * u) * lat,
    };
  }

  /**
   * The fastest it may go now on a path other than the line: `lat(s)` across
   * the road (kept on it). It looks along that path for the bends in it, and
   * takes the slowest of "corner speed there, plus what braking can lose on
   * the way". Off the line, a path is tighter or looser than the line is, so
   * the line's own speeds don't apply.
   */
  pathLimit(s: number, lat: (s: number) => number, keepOnRoad = true): number {
    const c = this.track.center;
    const h = DRIVER.pathStep;
    let lim = Infinity;
    for (let d = 0; d <= DRIVER.pathLook; d += h) {
      const s1 = s + d;
      const k = this.pathCurvature(s1, lat, keepOnRoad);
      // Off the line it keeps some grip in hand (for moving across, and for others).
      const vc = Math.min(this.pace.maxSpeed, Math.sqrt(cornerGrip(k, this.at(c.bank, s1), this.pace.grip * DRIVER.offLineGrip) / Math.max(Math.abs(k), 1e-5)));
      const allowed = Math.sqrt(vc * vc + 2 * brakingDecel(this.pace.brake, vc, this.at(c.grade, s1)) * d);
      if (allowed < lim) lim = allowed;
    }
    return lim;
  }

  /** Signed curvature (+ = right) of the path `lat(s)` across the road, at `s`. */
  pathCurvature(s: number, lat: (s: number) => number, keepOnRoad = true): number {
    const h = DRIVER.pathStep;
    const L = (x: number) => (keepOnRoad ? this.clampLat(x, lat(x)) : lat(x));
    const a = this.worldAt(s - h, L(s - h));
    const b = this.worldAt(s, L(s));
    const q = this.worldAt(s + h, L(s + h));
    const ux = b.x - a.x;
    const uz = b.z - a.z;
    const vx = q.x - b.x;
    const vz = q.z - b.z;
    const den = Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(q.x - a.x, q.z - a.z);
    return den > 1e-9 ? (2 * (ux * vz - uz * vx)) / den : 0;
  }

  private clampLat(s: number, lat: number): number {
    const line = this.at(this.line.offset, s);
    return clamp(lat, line - this.at(this.line.roomRight, s), line + this.at(this.line.roomLeft, s));
  }

  /**
   * Input for the next tick; `lane` drives that far left (+) of the line, at
   * `pace` × the planned speed, at most `cap`, `tow` = how much of a
   * slipstream it is in. `keep`, if given, is a stretch across the road to
   * stay within (m left of the centre): room left for a car alongside, or a
   * car being passed. The path bends round it, however the line goes.
   */
  drive(st: CarState, lane = 0, out?: DriveInput, pace = 1, cap = Infinity, tow = 0, keep: Corridor | null = null): DriveInput {
    const H = HANDLING;
    const o = out ?? { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const v = Math.max(0, st.speed);
    const kept = keep;
    const path = kept ? (x: number) => this.clampLat(x, clamp(this.lateralAt(x, lane), kept.lo, kept.hi)) : (x: number) => this.lateralAt(x, lane);

    // Steering: aim for a point on the line a little way ahead (further at speed): the arc
    // through the car and that point needs curvature 2 sin(a) / distance. Add part of the
    // line's own curvature just ahead, so the wheels are already turning as a corner begins.
    const look = DRIVER.lookBase + DRIVER.lookPerSpeed * v;
    const p = this.worldAt(st.s + look, path(st.s + look));
    const dist = Math.max(1, Math.hypot(p.x - st.x, p.z - st.z));
    const alpha = angleDelta(st.heading, Math.atan2(p.z - st.z, p.x - st.x));
    // Off the line, it's the bend of the path being driven (beside the line, or along the road's
    // edge) that the wheels should follow, not the line's.
    const sk = st.s + v * DRIVER.curvaturePreview;
    // (Bent round a car beside us: wherever the stretch we keep to cuts the path.)
    const bent = kept !== null && Math.abs(path(st.s + look) - this.lateralAt(st.s + look, lane)) > 0.05;
    const kAhead = bent || Math.abs(lane) > DRIVER.offLine ? this.pathCurvature(sk, path) : this.at(this.line.curvature, sk);
    const k = (2 * Math.sin(alpha)) / dist + DRIVER.curvatureFeed * kAhead;
    const lock = H.maxSteerAngle / (1 + Math.abs(st.speed) / H.steerFalloff);
    o.steer = clamp(Math.atan(k * H.wheelBase) / lock, -1, 1);

    // Speed: flat out up to the corner and braking limit a moment ahead. Off the line, the
    // limit of the path actually being driven (and a touch slower, for safety).
    const sp = st.s + v * DRIVER.speedPreview;
    let limit = Math.min(this.limitAt(sp), this.limitAt(st.s + 2));
    // Off the line (meaning to be, or actually: knocked, or still moving across), the limit
    // is that of the path it will really drive: from where it is now, blending over the next
    // stretch onto the path it wants.
    const lat0 = st.lateral;
    if (Math.abs(lane) > DRIVER.offLine) limit = Math.min(this.laneLimitAt(sp, lane), this.laneLimitAt(st.s + 2, lane));
    if (bent || (kept !== null && Math.abs(path(st.s) - this.lateralAt(st.s, lane)) > 0.05)) limit = Math.min(limit, this.pathLimit(st.s, path) * DRIVER.offLineSpeed);
    // Well away from where it means to be (knocked, or still moving across): the limit of the
    // path it will really drive, from where it is now blending onto the one it wants.
    if (Math.abs(lat0 - path(st.s)) > DRIVER.farOff) {
      const s0 = st.s;
      const conv = DRIVER.converge;
      const blend = (x: number) => {
        const u = clamp((x - s0) / conv, 0, 1);
        const b = u * u * (3 - 2 * u);
        return lat0 + (path(x) - lat0) * b;
      };
      limit = Math.min(limit, this.pathLimit(s0, blend, false) * DRIVER.offLineSpeed);
    }
    // In a tow it may go past its own top speed, as the tow lets the car (where the bends allow).
    const top = this.pace.maxSpeed;
    if (tow > 0 && limit >= top - 0.5) limit = top * (1 + HANDLING.slipstreamTopSpeed * tow);
    const target = Math.min(cap, limit * pace);
    // The plan already assumes full throttle out of corners and firm braking into them,
    // so drive it hard: flat out below the target, brake firmly above it.
    const err = target - v;
    o.throttle = clamp(0.5 + err * 2, 0, 1);
    o.brake = err < -DRIVER.brakeDeadband ? clamp(-err * DRIVER.brakeGain, 0, 1) : 0;
    o.handbrake = false;
    return o;
  }
}
