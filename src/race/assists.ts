import { angleDelta, STANDARD_CAR, type CarPerformance, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { ASSISTS, DEFAULT_SETUP, type CarSetup } from '../config/race.ts';
import type { Assists } from '../core/settings.ts';
import { onLane, pitLane } from '../track/pitLane.ts';
import type { Track } from '../track/track.ts';
import { wetPace } from './ai.ts';
import { carPace, roadPace } from './racingLine.ts';
import { RacingDriver } from './driver.ts';

const drivers = new WeakMap<Track, Map<string, RacingDriver>>();
const wetDrivers = new WeakMap<Track, Map<string, RacingDriver>>();

/**
 * The racing line at the assists' pace (ASSISTS): what the braking and
 * steering assists drive to, and what colours the racing line. Built once per
 * track and weather (`wet`: the same share of the grip and brakes there are
 * in the rain). No top speed of its own: only the corners slow it.
 */
export function assistDriver(track: Track, wet = false, tune: Readonly<CarPerformance> = STANDARD_CAR, setup: CarSetup = DEFAULT_SETUP): RacingDriver {
  const map = wet ? wetDrivers : drivers;
  let cars = map.get(track);
  if (!cars) map.set(track, cars = new Map());
  const key = `${tune.grip}:${tune.pull}:${tune.top}:${setup.wing}:${setup.gears}:${setup.brakes}`;
  let d = cars.get(key);
  if (!d) {
    const pace = roadPace(carPace({ grip: ASSISTS.grip, brake: ASSISTS.brake, maxSpeed: HANDLING.maxSpeed * 1.3 }, setup, tune), track);
    d = new RacingDriver(track, wet ? wetPace(pace) : pace);
    // Keep only a few recent cars: career upgrades must not accumulate plans forever.
    if (cars.size >= 4) cars.delete(cars.keys().next().value!);
    cars.set(key, d);
  }
  return d;
}

const scratch: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

/**
 * Applies the braking and steering assists to the player's input, in place.
 * They help a little, they don't drive: hold the throttle and let go of the
 * rest and you'll still run wide at the first real corner.
 * Braking: where the assist driver would brake and you're not braking
 * enough, it adds a light touch (ASSISTS.brakeTouch) if you aren't braking
 * at all, or tops your braking up by at most ASSISTS.brakeTopUp if you are.
 * It never lifts the throttle. Steering: while you're not steering it eases
 * you back towards the racing line (gently, without swinging across it), but
 * never steers more than ASSISTS.steerShare of the lock, so corners are still
 * yours; the more you steer the less it does, and at full lock (any key press)
 * it does nothing.
 * Off below a walking pace, when reversing, and in the pit lane (the line is
 * on the other side of the pit wall; the limiter does the braking there).
 */
export function applyAssists(track: Track, st: CarState, inp: DriveInput, a: Assists, wet = false, tune: Readonly<CarPerformance> = STANDARD_CAR, setup: CarSetup = DEFAULT_SETUP): DriveInput {
  if ((!a.brake && !a.steer) || st.speed < ASSISTS.minSpeed) return inp;
  const lane = pitLane(track);
  if (lane && onLane(lane, st.s, st.lateral)) return inp;
  const d = assistDriver(track, wet, tune, setup);
  const ai = d.drive(st, 0, scratch, { lockGuard: false });
  if (a.brake && ai.brake > inp.brake) {
    const help = inp.brake > 0.05 ? inp.brake + ASSISTS.brakeTopUp : ASSISTS.brakeTouch;
    inp.brake = Math.max(inp.brake, Math.min(ai.brake, help));
  }
  if (a.steer) {
    // Back towards the line in proportion to how far off it you are, and
    // against heading away from it (which is what stops it swinging across),
    // never more than steerShare of the lock: it holds the line on straights
    // and gentle bends, but a real corner needs you.
    const c = track.center;
    const tg = c.tangents[Math.max(0, st.trackIndex)];
    const slope = (d.lateralAt(st.s + 2) - d.lateralAt(st.s - 2)) / 4;
    const lineHeading = Math.atan2(tg.y, tg.x) - Math.atan(slope);
    const offLine = st.lateral - d.lateralAt(st.s); // + = left of the line
    const turned = angleDelta(lineHeading, st.heading); // + = pointing right of it
    const want = ASSISTS.steerPerMetre * offLine - ASSISTS.steerPerRadian * turned;
    const own = Math.min(1, Math.abs(inp.steer));
    inp.steer += Math.max(-ASSISTS.steerShare, Math.min(ASSISTS.steerShare, want)) * (1 - own);
  }
  return inp;
}
