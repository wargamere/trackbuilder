import { INK } from '../config/track.ts';
import type { Corner } from './corners.ts';

/**
 * Limited ink, the game's twist. A track is drawn from a fixed pot of ink. The
 * share of ink left over and the number of tight corners set the track's score
 * multiplier, which scales every lap score on that track.
 */
export interface InkStats {
  /** Metres of ink the track used. */
  used: number;
  /** Fraction of the pot left over, 0..1. */
  left: number;
  tightCorners: number;
  inkMult: number;
  cornerBonus: number;
  /** Final multiplier = inkMult + cornerBonus. */
  multiplier: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function inkStats(length: number, tightCorners: readonly Corner[]): InkStats {
  const used = Math.min(length, INK.max);
  const left = 1 - used / INK.max;
  const inkMult = inkMultiplier(left);
  const cornerBonus = round2(Math.min(INK.cornerBonusMax, tightCorners.length * INK.cornerBonus));
  return {
    used,
    left,
    tightCorners: tightCorners.length,
    inkMult,
    cornerBonus,
    multiplier: round2(inkMult + cornerBonus),
  };
}

/** The ink part of the multiplier for a given fraction of unused ink. */
export const inkMultiplier = (left: number): number => round2(1 + INK.leftWeight * left);

/** Fraction of ink left while a stroke of `strokeLength` metres is being drawn. */
export const inkLeftWhileDrawing = (strokeLength: number): number => Math.max(0, 1 - strokeLength / INK.max);
