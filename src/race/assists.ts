import { angleDelta, type CarState, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { ASSISTS } from '../config/race.ts';
import type { Assists } from '../core/settings.ts';
import type { Track } from '../track/track.ts';
import { wetPace } from './ai.ts';
import { roadPace } from './racingLine.ts';
import { RacingDriver } from './driver.ts';

const drivers = new WeakMap<Track, RacingDriver>();
const wetDrivers = new WeakMap<Track, RacingDriver>();

/**
 * The racing line at the assists' pace (ASSISTS): what the braking and
 * steering assists drive to, and what colours the racing line. Built once per
 * track and weather (`wet`: the same share of the grip and brakes there are
 * in the rain). No top speed of its own: only the corners slow it.
 */
export function assistDriver(track: Track, wet = false): RacingDriver {
  const map = wet ? wetDrivers : drivers;
  let d = map.get(track);
  if (!d) {
    const pace = roadPace({ grip: ASSISTS.grip, brake: ASSISTS.brake, maxSpeed: HANDLING.maxSpeed * 1.3 }, track);
    d = new RacingDriver(track, wet ? wetPace(pace) : pace);
    map.set(track, d);
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
 * Off below a walking pace, and when reversing.
 */
export function applyAssists(track: Track, st: CarState, inp: DriveInput, a: Assists, wet = false): DriveInput {
  if ((!a.brake && !a.steer) || st.speed < ASSISTS.minSpeed) return inp;
  const d = assistDriver(track, wet);
  const ai = d.drive(st, 0, scratch);
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
