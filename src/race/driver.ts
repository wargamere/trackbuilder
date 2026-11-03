import { angleDelta, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { DRIVER } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { leftOf } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { racingLine, speedProfile, type Pace, type RacingLine } from './racingLine.ts';

/**
 * Drives the racing line at a pace: steers for a point on the line a little
 * ahead (further at speed), and works throttle and brakes to the speed the
 * line allows there, looking a moment ahead so it brakes on time. `lane`
 * shifts it sideways off the line (to pass someone), within the road.
 */
export class RacingDriver {
  readonly line: RacingLine;
  /** Target speed at each sample (m/s). */
  readonly speed: Float32Array;
  private readonly track: Track;

  constructor(track: Track, pace: Pace) {
    this.track = track;
    this.line = racingLine(track);
    this.speed = speedProfile(track, this.line, pace);
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

  /** Where the driver wants to be across the road at `s`: the line plus `lane`, kept on the road. */
  lateralAt(s: number, lane = 0): number {
    return clamp(this.at(this.line.offset, s) + lane, this.at(this.line.lo, s), this.at(this.line.hi, s));
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

  /** Target speed at `s` (m/s). */
  speedAt(s: number): number {
    return this.at(this.speed, s);
  }

  /** Input for the next tick; `lane` drives that far left (+) of the line, at `pace` × the planned speed. */
  drive(st: CarState, lane = 0, out?: DriveInput, pace = 1): DriveInput {
    const H = HANDLING;
    const o = out ?? { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const v = Math.max(0, st.speed);

    // Steering: aim for a point on the line a little way ahead (further at speed): the arc
    // through the car and that point needs curvature 2 sin(a) / distance. Add part of the
    // line's own curvature just ahead, so the wheels are already turning as a corner begins.
    const look = DRIVER.lookBase + DRIVER.lookPerSpeed * v;
    const p = this.pointAt(st.s + look, lane);
    const dist = Math.max(1, Math.hypot(p.x - st.x, p.z - st.z));
    const alpha = angleDelta(st.heading, Math.atan2(p.z - st.z, p.x - st.x));
    const k = (2 * Math.sin(alpha)) / dist + DRIVER.curvatureFeed * this.at(this.line.curvature, st.s + v * DRIVER.curvaturePreview);
    const lock = H.maxSteerAngle / (1 + Math.abs(st.speed) / H.steerFalloff);
    o.steer = clamp(Math.atan(k * H.wheelBase) / lock, -1, 1);

    // Speed: the plan a moment ahead. Off the line it's a little slower, and slower again
    // on the inside of a bend, where a path beside the line is tighter (radius r - d).
    const sp = st.s + v * DRIVER.speedPreview;
    let off = 1;
    if (Math.abs(lane) > 0.5) {
      const kp = this.at(this.line.curvature, sp);
      const inward = -lane * Math.sign(kp); // + = towards the inside of the bend
      off = DRIVER.offLineSpeed * (inward > 0 ? Math.sqrt(Math.max(0.3, 1 - Math.abs(kp) * inward)) : 1);
    }
    const target = Math.min(this.speedAt(sp), this.speedAt(st.s + 2)) * off * pace;
    // The plan already assumes full throttle out of corners and firm braking into them,
    // so drive it hard: flat out below the target, brake firmly above it.
    const err = target - v;
    o.throttle = clamp(0.5 + err * 2, 0, 1);
    o.brake = err < -DRIVER.brakeDeadband ? clamp(-err * DRIVER.brakeGain, 0, 1) : 0;
    o.handbrake = false;
    return o;
  }
}
