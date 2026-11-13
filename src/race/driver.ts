import { angleDelta, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { DRIVER } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { leftOf } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { brakingDecel, cornerSpeed, drivingAccel, racingLine, speedProfile, type Pace, type RacingLine, type SpeedPlan } from './racingLine.ts';

/** A stretch across the road (m left of the centre line) for a car to keep within. */
export interface Corridor {
  lo: number;
  hi: number;
}

/** How to drive, beyond the lane (see RacingDriver.drive()). */
export interface DriveOptions {
  /** Share of the planned speed. */
  pace?: number;
  /** At most this fast (m/s). */
  cap?: number;
  /** How much of a slipstream it's in (0..1). */
  tow?: number;
  /** A stretch across the road to stay within: room for a car alongside, or a car being passed. */
  keep?: Corridor | null;
  /** Fighting for a place: later on the brakes. */
  late?: boolean;
  /** A path of its own across the road (m left of the centre, at s) instead of the lane: covering the inside of a bend, or the way into the pit box. */
  route?: ((s: number) => number) | null;
  /** The route may leave the road (the way through the pit lane): it isn't kept within the room beside the line. */
  offRoad?: boolean;
  /** Lift and brake when the path needs more steering lock than the car has at this speed (on by default; the assists, which only advise, leave it off). */
  lockGuard?: boolean;
  /** The tyres' grip as a share of what the plan was made for (worn tyres: slower through the bends; softer or rain tyres: quicker). */
  grip?: number;
  /** The brakes' bite as a share of what the plan was made for (a road getting wet: less, so it brakes earlier). */
  brake?: number;
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
  /** The corner limit alone at each sample (lower `limit` means braking for the next bend). */
  private readonly corner: Float32Array;
  readonly pace: Pace;
  private readonly track: Track;

  /** Offsets from the line (sorted) that have a speed plan of their own, and those plans' corner and braking limits. */
  private readonly laneOffsets: readonly number[];
  private readonly laneLimits: Float32Array[];
  /** What it can actually do in each lane (accelerating out of the bends too). */
  private readonly laneSpeeds: Float32Array[];
  /** Seconds to drive each sample of each lane at that speed (for judging what a lane costs). */
  private readonly laneTimes: Float32Array[];
  /** Fighting for a place: the brakes it uses then (a share), and the corner and braking limits that gives on the line and in each lane. */
  readonly lateBrake: number;
  private readonly lateLimit: Float32Array;
  private readonly laneLateLimits: Float32Array[];

  constructor(track: Track, pace: Pace) {
    this.track = track;
    this.pace = pace;
    this.line = racingLine(track);
    const plan = speedProfile(track, this.line, pace);
    this.speed = plan.speed;
    this.limit = plan.limit;
    this.corner = plan.corner;
    this.lateBrake = Math.min(DRIVER.lateBrakeMax, pace.brake + DRIVER.lateBrake);
    this.lateLimit = speedProfile(track, this.line, { ...pace, brake: this.lateBrake }).limit;
    // A speed plan for each lane beside the line too: its own bends (the line shifted
    // sideways within the room there is), a little grip kept in hand, its own braking.
    this.laneOffsets = [...new Set([0, ...DRIVER.planLanes])].sort((a, b) => a - b);
    const plans = this.laneOffsets.map((o) => (o === 0 ? { ...plan, late: this.lateLimit } : this.lanePlan(o)));
    this.laneLimits = plans.map((p) => p.limit);
    this.laneLateLimits = plans.map((p) => p.late);
    this.laneSpeeds = plans.map((p) => p.speed);
    this.laneTimes = this.laneSpeeds.map((sp) => {
      const n = sp.length;
      const t = new Float32Array(n);
      for (let i = 0; i < n; i++) t[i] = this.track.center.spacing / Math.max(2, sp[i]);
      return t;
    });
  }

  /** Corner and braking limits along the line shifted `o` metres sideways (braking as usual, and late), and the speeds it can really reach there. */
  private lanePlan(o: number): SpeedPlan & { late: Float32Array } {
    const c = this.track.center;
    const n = c.points.length;
    const v = new Float32Array(n);
    const lat = (x: number) => this.lateralAt(x, o);
    for (let i = 0; i < n; i++) {
      const s = i * c.spacing;
      const k = this.pathCurvature(s, lat);
      v[i] = Math.min(this.pace.maxSpeed, cornerSpeed(k, c.bank[i], this.pace.grip * DRIVER.offLineGrip, this.pace.downforce));
    }
    // Light smoothing (the curvature of a shifted path is a little noisy), keeping the lows.
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) sm[i] = Math.min(v[i], (v[(i - 1 + n) % n] + v[i] + v[(i + 1) % n]) / 3);
    const brakeBack = (arr: Float32Array, brake = this.pace.brake) => {
      for (let round = 0; round < 2; round++) {
        for (let i = n - 1; i >= 0; i--) {
          const j = (i + 1) % n;
          const reach = Math.sqrt(arr[j] * arr[j] + 2 * brakingDecel(brake, arr[j], c.grade[i], this.pace.drag) * c.spacing);
          if (reach < arr[i]) arr[i] = reach;
        }
      }
    };
    const corner = Float32Array.from(sm);
    const late = Float32Array.from(sm);
    brakeBack(late, this.lateBrake);
    brakeBack(sm);
    // And how fast it really gets there, accelerating out of each bend.
    const sp = Float32Array.from(sm);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const vi = sp[i];
        const acc = drivingAccel(vi, this.pace, c.grade[i]);
        const reach = Math.sqrt(Math.max(0, vi * vi + 2 * acc * c.spacing));
        if (reach < sp[j]) sp[j] = reach;
      }
    }
    brakeBack(sp);
    return { limit: sm, speed: sp, late, corner };
  }

  /** Corner and braking limit at `s` on the lane `lane` metres beside the line (between the planned lanes, in between); `late`: braking late. */
  laneLimitAt(s: number, lane: number, late = false): number {
    return this.betweenLanes(late ? this.laneLateLimits : this.laneLimits, s, lane);
  }

  /** The speed it can really do at `s` in lane `lane` metres beside the line (between the planned lanes, in between). */
  laneSpeedAt(s: number, lane: number): number {
    if (Math.abs(lane) < DRIVER.offLine) return this.at(this.speed, s);
    return this.betweenLanes(this.laneSpeeds, s, lane);
  }

  /** Per-lane `arrs` at `s`, for lane `lane`: between two planned lanes, in proportion. */
  private betweenLanes(arrs: Float32Array[], s: number, lane: number): number {
    const offs = this.laneOffsets;
    if (lane <= offs[0]) return this.at(arrs[0], s);
    if (lane >= offs[offs.length - 1]) return this.at(arrs[offs.length - 1], s);
    let k = 0;
    while (offs[k + 1] < lane) k++;
    const u = (lane - offs[k]) / (offs[k + 1] - offs[k]);
    return this.at(arrs[k], s) * (1 - u) + this.at(arrs[k + 1], s) * u;
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
    // Most predictions are already on this lap. Two floating-point modulo
    // operations here used to dominate full-grid traffic planning.
    let f = s / c.spacing;
    if (f < 0 || f >= n) f = ((f % n) + n) % n;
    else { f = (f + n) - n; if (f === n) f = 0; }
    const i = Math.floor(f);
    const u = f - i;
    return arr[i] * (1 - u) + arr[i + 1 === n ? 0 : i + 1] * u;
  }

  /**
   * Where the driver wants to be across the road at `s`: the line shifted
   * `lane` metres sideways, by no more than the (smoothed) room there is
   * beside the line, so every such path is as smooth as the line itself.
   */
  lateralAt(s: number, lane = 0): number {
    const c = this.track.center, n = c.points.length;
    let f = s / c.spacing;
    if (f < 0 || f >= n) f = ((f % n) + n) % n;
    // Preserve the old wrap's floating-point rounding, including a value
    // within one rounding unit of the finish. Contact races are sensitive to it.
    else { f = (f + n) - n; if (f === n) f = 0; }
    const i = Math.floor(f), j = i + 1 === n ? 0 : i + 1, u = f - i, a = 1 - u;
    // Offset and both road margins share one interpolation position.
    const line = this.line.offset[i] * a + this.line.offset[j] * u;
    if (lane === 0) return line;
    return line + clamp(lane, -(this.line.roomRight[i] * a + this.line.roomRight[j] * u), this.line.roomLeft[i] * a + this.line.roomLeft[j] * u);
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

  /** The corner and braking limit on the line at `s` (m/s); `late`: braking late. */
  limitAt(s: number, late = false): number {
    return this.at(late ? this.lateLimit : this.limit, s);
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
  pathLimit(s: number, lat: (s: number) => number, keepOnRoad = true, brake = this.pace.brake, grip: number = DRIVER.offLineGrip): number {
    const c = this.track.center;
    const h = DRIVER.pathStep;
    let lim = Infinity;
    for (let d = 0; d <= DRIVER.pathLook; d += h) {
      const s1 = s + d;
      const k = this.pathCurvature(s1, lat, keepOnRoad, true);
      // Off the line it keeps some grip in hand (for moving across, and for others).
      const vc = Math.min(this.pace.maxSpeed, cornerSpeed(k, this.at(c.bank, s1), this.pace.grip * grip, this.pace.downforce));
      const allowed = Math.sqrt(vc * vc + 2 * brakingDecel(brake, vc, this.at(c.grade, s1), this.pace.drag) * d);
      if (allowed < lim) lim = allowed;
    }
    return lim;
  }

  /**
   * Signed curvature (+ = right) of the path `lat(s)` across the road, at `s`:
   * of the path as the car really drives it, smoothed over about as far as
   * its steering looks ahead (DRIVER.pathSmooth), so a corner in it (where a
   * lane beside the line meets the road's edge, or bends round a car) costs
   * what rounding it off does, not what taking it square would.
   */
  pathCurvature(s: number, lat: (s: number) => number, keepOnRoad = true, worldSpace = false): number {
    const h = DRIVER.pathStep;
    const w = DRIVER.pathSmooth;
    const at = (x: number) => (keepOnRoad ? this.clampLat(x, lat(x)) : lat(x));
    // Smooth the actual path in world space. Smoothing lateral offsets first
    // changes the path where the centre line turns sharply: even the ideal
    // racing line could appear to need half its normal speed in a duel.
    const point = (x: number) => {
      let px = 0, pz = 0;
      for (const d of [-w, -w / 2, 0, w / 2, w]) { const p = this.worldAt(x + d, at(x + d)); px += p.x; pz += p.z; }
      return { x: px / 5, z: pz / 5 };
    };
    // Steering feed and the established lane plans retain their road-relative
    // smoothing. A route's speed limit must measure its actual world geometry.
    const L = (x: number) => (at(x - w) + at(x - w / 2) + at(x) + at(x + w / 2) + at(x + w)) / 5;
    const a = worldSpace ? point(s - h) : this.worldAt(s - h, L(s - h));
    const b = worldSpace ? point(s) : this.worldAt(s, L(s));
    const q = worldSpace ? point(s + h) : this.worldAt(s + h, L(s + h));
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
   * Input for the next tick; `lane` drives that far left (+) of the line (or
   * `route`, a path of its own), at `pace` × the planned speed, at most `cap`,
   * `tow` = how much of a slipstream it is in. `keep`, if given, is a stretch
   * across the road to stay within (m left of the centre): room left for a
   * car alongside, or a car being passed. The path bends round it, however the
   * line goes. `late`: fighting for a place, it brakes later (with
   * DRIVER.lateBrake more of the brakes), giving up a little time to win it.
   */
  drive(st: CarState, lane = 0, out?: DriveInput, opts: DriveOptions = {}): DriveInput {
    const H = HANDLING;
    const o = out ?? { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const { pace = 1, cap = Infinity, tow = 0, keep = null, late = false, route = null, offRoad = false, grip = 1, brake: bite = 1, lockGuard = true } = opts;
    const v = Math.max(0, st.speed);
    const kept = keep;
    const base = route ? (offRoad ? route : (x: number) => this.clampLat(x, route(x))) : (x: number) => this.lateralAt(x, lane);
    const path = kept ? (x: number) => this.clampLat(x, clamp(base(x), kept.lo, kept.hi)) : base;

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
    const bent = route !== null || (kept !== null && Math.abs(path(st.s + look) - this.lateralAt(st.s + look, lane)) > 0.05);
    const kAhead = bent || Math.abs(lane) > DRIVER.offLine ? this.pathCurvature(sk, path, !offRoad, route !== null) : this.at(this.line.curvature, sk);
    const k = (2 * Math.sin(alpha)) / dist + DRIVER.curvatureFeed * kAhead;
    const lock = H.maxSteerAngle / (1 + Math.abs(st.speed) / H.steerFalloff);
    o.steer = clamp(Math.atan(k * H.wheelBase) / lock, -1, 1);

    // Speed: flat out up to the corner and braking limit a moment ahead. Off the line, the
    // limit of the path actually being driven (and a touch slower, for safety).
    const sp = st.s + v * DRIVER.speedPreview;
    let limit = Math.min(this.limitAt(sp, late), this.limitAt(st.s + 2, late));
    const brake = late ? this.lateBrake : this.pace.brake;
    // Off the line (meaning to be, or actually: knocked, or still moving across), the limit
    // is that of the path it will really drive: from where it is now, blending over the next
    // stretch onto the path it wants.
    const lat0 = st.lateral;
    if (route) {
      // A path of its own (smooth, and meant): its own limit (read ahead, as the line's is, so it
      // brakes in time), keeping just a little grip in hand.
      limit = Math.min(this.pathLimit(sp, path, !offRoad, brake, DRIVER.routeGrip), this.pathLimit(st.s, path, !offRoad, brake, DRIVER.routeGrip)) * DRIVER.routeSpeed;
    } else {
      if (Math.abs(lane) > DRIVER.offLine) limit = Math.min(this.laneLimitAt(sp, lane, late), this.laneLimitAt(st.s + 2, lane, late));
      // (Further over than the widest lane with a plan of its own: the path's own limit.)
      const widest = Math.abs(lane) > this.laneOffsets[this.laneOffsets.length - 1] + 0.5;
      if (widest || bent || (kept !== null && Math.abs(path(st.s) - this.lateralAt(st.s, lane)) > 0.05)) limit = Math.min(limit, this.pathLimit(st.s, path, true, brake) * DRIVER.offLineSpeed);
    }
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
      limit = Math.min(limit, this.pathLimit(s0, blend, false, brake) * DRIVER.offLineSpeed);
    }
    // Less grip than planned (worn tyres): slower wherever a bend, or braking for one, sets the
    // speed, by as much as the grip allows (the speed through a bend goes with its square root).
    // More (softer tyres, or rain tyres in the rain): quicker through the bends themselves, but
    // not into them, as the brakes are no better.
    // Weaker brakes than planned: earlier into the bends, by the square root too (on the safe side).
    const top = this.pace.maxSpeed;
    if (limit < top - 0.5) {
      const braking = this.at(this.limit, sp) < this.at(this.corner, sp) - 0.3;
      let f = 1;
      if (grip < 1) f = Math.sqrt(grip) * (1 - DRIVER.lowGripCare * Math.max(0, DRIVER.lowGrip - grip));
      else if (grip > 1 && !braking) f = Math.sqrt(grip);
      if (braking && bite < 1) f = Math.min(f, Math.sqrt(bite));
      limit = Math.min(top, limit * f);
    }
    // In a tow it may go past its own top speed, as the tow lets the car (where the bends allow).
    if (tow > 0 && limit >= top - 0.5) limit = top * (1 + HANDLING.slipstreamTopSpeed * tow);
    const target = Math.min(cap, limit * pace);
    // The plan already assumes full throttle out of corners and firm braking into them,
    // so drive it hard: flat out below the target, brake firmly above it.
    const err = target - v;
    o.throttle = clamp(0.5 + err * 2, 0, 1);
    o.brake = err < -DRIVER.brakeDeadband ? clamp(-err * DRIVER.brakeGain, 0, 1) : 0;
    o.handbrake = false;
    // Running wide at full lock (too fast to make the turn: flooring it would only widen the arc
    // into the barrier): lift, and brake the harder the faster it's drifting off its path.
    // (Not just at full lock: in the tightest hairpins that's how the line is driven.)
    if (lockGuard && v > DRIVER.lockCrawl && Math.abs(o.steer) >= 1) {
      const c = this.track.center;
      const i = Math.max(0, st.trackIndex);
      const l = leftOf(c.tangents[i]);
      const t = c.tangents[i];
      const err = st.lateral - path(st.s);
      // How fast it's moving off the path, across it (m/s; + = further off).
      const across = (st.vx * l.x + st.vz * l.y - ((path(st.s + 1) - path(st.s - 1)) / 2) * (st.vx * t.x + st.vz * t.y)) * Math.sign(err);
      if (Math.abs(err) > DRIVER.wideFrom && across > DRIVER.wideDrift) {
        o.throttle = 0;
        o.brake = Math.max(o.brake, Math.min(DRIVER.lockBrakeMax, (across - DRIVER.wideDrift) * DRIVER.lockBrake));
      }
    }
    return o;
  }
}
