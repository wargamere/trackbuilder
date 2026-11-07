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

/** Grip of a new set of `c` (a share of the road's), in the rain or the dry. */
export function compoundGrip(c: Compound, wet: boolean): number {
  const t = TYRES.compounds[c];
  return wet ? t.rainGrip : t.grip;
}

/** How much of the brakes' bite `c` gives (all of it in the dry). */
export function compoundBrake(c: Compound, wet: boolean): number {
  return wet ? TYRES.compounds[c].rainBrake : 1;
}

/** Laps a set of `c` lasts before it goes off, where mediums last `mediumLife` laps (in the dry). */
export function compoundLife(c: Compound, wet: boolean, mediumLife: number): number {
  const t = TYRES.compounds[c];
  return mediumLife * (wet ? t.rainLife : t.life);
}

/** With tyre wear off every car is on a standard set: medium's grip, and the rain's. */
export const standardGrip = (wet: boolean): number => (wet ? CONDITIONS.rainGrip : 1);
