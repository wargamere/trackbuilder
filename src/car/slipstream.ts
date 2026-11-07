import { CONTACT, SLIPSTREAM } from '../config/race.ts';
import type { CarState } from './physics.ts';

/**
 * Slipstream: a car close behind another, in line with it, has less air to
 * push through and gets towed along. For each car, how much of a slipstream
 * it's in (0..1), see towStrength(). Every car gets it, the player included;
 * it's what lets a car get a run on the one ahead along a straight. `L` is
 * the track length (gaps wrap round the lap).
 */
export function slipstream(states: readonly CarState[], L: number, out: Float32Array | number[]): void {
  for (let i = 0; i < states.length; i++) {
    const a = states[i];
    let best = 0;
    for (let j = 0; j < states.length; j++) {
      if (i === j) continue;
      const b = states[j];
      if (Math.abs(a.y - b.y) > CONTACT.heightGap) continue;
      let ds = (b.s - a.s) % L;
      if (ds < 0) ds += L;
      const gap = ds - 2 * CONTACT.halfLength;
      if (ds <= 0 || gap > SLIPSTREAM.range) continue;
      // Both going forwards, roughly the same way (not a spun car facing us).
      if (Math.cos(a.heading - b.heading) < 0.8 || b.speed < 5) continue;
      const f = towStrength(gap, Math.abs(b.lateral - a.lateral), a.speed);
      if (f > best) best = f;
    }
    out[i] = best;
  }
}

/**
 * How much of a slipstream a car `gap` m behind another (bumper to bumper)
 * and `side` m to its side, going at `speed`, is in (0..1). It's all about
 * the time gap: right on the bumper it's full, and it falls away
 * exponentially (to about a quarter half a second back), so it grows faster
 * and faster the closer you get. The wake widens behind the car.
 */
export function towStrength(gap: number, side: number, speed: number): number {
  if (gap > SLIPSTREAM.range) return 0;
  const g = Math.max(0, gap);
  const width = SLIPSTREAM.width + SLIPSTREAM.spread * g;
  if (side >= width) return 0;
  const t = g / Math.max(SLIPSTREAM.minSpeed, speed);
  return Math.exp(-t / SLIPSTREAM.timeScale) * (1 - (side / width) ** 2);
}

/**
 * The tow a car carries for a moment after it leaves the slipstream (the
 * slingshot that gets it alongside): the new strength, or what it had a
 * tick ago fading over SLIPSTREAM.carry seconds, whichever is more.
 */
export function carriedTow(had: number, now: number, dt: number): number {
  return Math.max(now, had * Math.exp(-dt / SLIPSTREAM.carry));
}
