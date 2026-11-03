import { angleDelta, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { clamp } from '../core/math.ts';
import { leftOf, sampleAt } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

export interface BotOptions {
  /** Line to drive, as an offset from the centre line (+ = left). */
  lane?: number;
  /** Never drive faster than this (m/s). */
  maxSpeed?: number;
}

/**
 * A simple driver: steers at a point ahead on its line and brakes for corners
 * it can see coming, using `aggression` of the tyres' grip. Used for the
 * medal-time lap, to check the handling is drivable, and by the AI opponents.
 */
export function botInput(car: CarState, track: Track, aggression = 0.8, opts: BotOptions = {}, out?: DriveInput): DriveInput {
  const c = track.center;
  const n = c.points.length;
  const lane = opts.lane ?? 0;
  const v = Math.max(car.speed, 0);
  const ahead = sampleAt(c, car.s + 5 + v * 0.42);
  const l = leftOf(ahead.t);
  const tx = ahead.p.x + l.x * lane;
  const tz = ahead.p.y + l.y * lane;
  const err = angleDelta(car.heading, Math.atan2(tz - car.z, tx - car.x));
  const steer = clamp(err * 3.2 - (car.lateral - lane) * 0.04, -1, 1);
  // Fastest speed that still lets us brake in time for every corner in view.
  const latG = HANDLING.maxLateralAccel * aggression;
  const decel = HANDLING.brakeDecel * 0.7;
  let vTarget = opts.maxSpeed ?? Infinity;
  for (let d = 0; d < 120; d += c.spacing) {
    const i = Math.floor((car.s + d) / c.spacing) % n;
    const k = Math.abs(c.curvature[i]) + 1e-4;
    vTarget = Math.min(vTarget, Math.sqrt(latG / k + 2 * decel * d));
  }
  const o = out ?? { throttle: 0, brake: 0, steer: 0, handbrake: false };
  o.throttle = v < vTarget - 0.5 ? 1 : 0;
  o.brake = v > vTarget + 1.5 ? 1 : 0;
  o.steer = steer;
  o.handbrake = false;
  return o;
}
