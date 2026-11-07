import { angleDelta, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { clamp } from '../core/math.ts';
import { sampleAt } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

/**
 * A simple test driver: steers at a point ahead on the centre line and brakes
 * for corners it can see coming. The tests use it to check the handling is
 * drivable on any track; the AI cars use the racing line (driver.ts).
 */
export function botInput(car: CarState, track: Track, aggression = 0.8): DriveInput {
  const c = track.center;
  const n = c.points.length;
  const v = Math.max(car.speed, 0);
  const tgt = sampleAt(c, car.s + 5 + v * 0.42).p;
  const err = angleDelta(car.heading, Math.atan2(tgt.y - car.z, tgt.x - car.x));
  const steer = clamp(err * 3.2 - car.lateral * 0.04, -1, 1);
  // Fastest speed that still lets us brake in time for every corner in view.
  const latG = HANDLING.maxLateralAccel * aggression;
  const decel = HANDLING.brakeDecel * 0.7;
  let vTarget = Infinity;
  for (let d = 0; d < 120; d += c.spacing) {
    const i = Math.floor((car.s + d) / c.spacing) % n;
    const k = Math.abs(c.curvature[i]) + 1e-4;
    vTarget = Math.min(vTarget, Math.sqrt(latG / k + 2 * decel * d));
  }
  return {
    throttle: v < vTarget - 0.5 ? 1 : 0,
    brake: v > vTarget + 1.5 ? 1 : 0,
    steer,
    handbrake: false,
  };
}
