import type { CarState, DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { ASSISTS } from '../config/race.ts';
import type { Assists } from '../core/settings.ts';
import type { Track } from '../track/track.ts';
import { RacingDriver } from './driver.ts';

const drivers = new WeakMap<Track, RacingDriver>();

/**
 * The racing line at the assists' pace (ASSISTS): what the braking and
 * steering assists drive to, and what colours the racing line. Built once per
 * track. No top speed of its own: only the corners slow it.
 */
export function assistDriver(track: Track): RacingDriver {
  let d = drivers.get(track);
  if (!d) {
    d = new RacingDriver(track, { grip: ASSISTS.grip, brake: ASSISTS.brake, maxSpeed: HANDLING.maxSpeed * 1.3 });
    drivers.set(track, d);
  }
  return d;
}

const scratch: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/**
 * Applies the braking and steering assists to the player's input, in place.
 * Braking: where the assist driver would brake, it brakes at least that hard
 * and lifts off the throttle. Steering: while you're not steering it steers
 * along the racing line; the more you steer, the more it's yours (all of it at
 * full lock, so a key press always wins). Off below a walking pace, and when
 * reversing.
 */
export function applyAssists(track: Track, st: CarState, inp: DriveInput, a: Assists): DriveInput {
  if ((!a.brake && !a.steer) || st.speed < ASSISTS.minSpeed) return inp;
  const ai = assistDriver(track).drive(st, 0, scratch);
  if (a.brake && ai.brake > 0) {
    inp.brake = Math.max(inp.brake, ai.brake);
    inp.throttle = Math.min(inp.throttle, ai.throttle);
  }
  if (a.steer) {
    const own = Math.min(1, Math.abs(inp.steer));
    inp.steer = inp.steer * own + ai.steer * (1 - own);
  }
  return inp;
}
