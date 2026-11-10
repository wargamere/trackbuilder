import { CONDITIONS, TYRES, type Compound } from '../config/race.ts';

/**
 * How much of a set's grip is left at `x` of its life used (0 new, 1 the
 * moment it goes off): a steady fade, then off the cliff down to deadGrip,
 * where the car is heavily slower (see TYRES).
 */
export function tyreCurve(x: number): number {
  const T = TYRES;
  const u = Math.max(0, x);
  if (u <= 1) return 1 - T.fadeLoss * u;
  const k = Math.min(1, (u - 1) / T.cliff);
  return 1 - T.fadeLoss - (1 - T.fadeLoss - T.deadGrip) * k;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Grip of a new set of `c` (a share of the road's) on a road `wetness` wet (0 dry … 1 soaked). */
export function compoundGrip(c: Compound, wetness: number): number {
  const t = TYRES.compounds[c];
  return lerp(t.grip, t.rainGrip, wetness);
}

/** How much of the brakes' bite `c` gives on a road `wetness` wet (all of it in the dry). */
export function compoundBrake(c: Compound, wetness: number): number {
  return lerp(1, TYRES.compounds[c].rainBrake, wetness);
}

/** Laps a set of `c` lasts before it goes off on a road `wetness` wet, where mediums last `mediumLife` laps in the dry. */
export function compoundLife(c: Compound, wetness: number, mediumLife: number): number {
  const t = TYRES.compounds[c];
  return mediumLife * lerp(t.life, t.rainLife, wetness);
}

/** With tyre wear off every car is on a standard set: medium's grip, and the rain's on a wet road. */
export const standardGrip = (wetness: number): number => lerp(1, CONDITIONS.rainGrip, wetness);

/** …and the standard set's brakes. */
export const standardBrake = (wetness: number): number => lerp(1, CONDITIONS.rainBrake, wetness);
