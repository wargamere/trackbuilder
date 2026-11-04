import { CONTACT, SLIPSTREAM } from '../config/race.ts';
import type { CarState } from './physics.ts';

/**
 * Slipstream: a car close behind another, in line with it, has less air to
 * push through. For each car, how much of a slipstream it's in (0..1): most
 * right behind a car ahead, fading out with distance (up to SLIPSTREAM.range)
 * and with how far it is to the side (up to SLIPSTREAM.width). Every car gets
 * it, the player included; it's what lets a quicker car get a run on the one
 * ahead along a straight. `L` is the track length (gaps wrap round the lap).
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
      if (ds <= 0 || ds > SLIPSTREAM.range) continue;
      const side = Math.abs(b.lateral - a.lateral);
      if (side >= SLIPSTREAM.width) continue;
      // Both going forwards, roughly the same way (not a spun car facing us).
      if (Math.cos(a.heading - b.heading) < 0.8 || b.speed < 5) continue;
      const f = (1 - ds / SLIPSTREAM.range) * (1 - side / SLIPSTREAM.width);
      if (f > best) best = f;
    }
    out[i] = best;
  }
}
