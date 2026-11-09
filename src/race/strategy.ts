import { compoundLife } from '../car/tyres.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, CONDITIONS, TYRES, type Compound } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import type { Track } from '../track/track.ts';
import { racingLine, speedProfile } from './racingLine.ts';

const works = new WeakMap<Track, number>();

/**
 * How hard a lap of `track` works the tyres: the speed turned through in the
 * bends (Σ v·|dθ|) plus the speed shed under braking, on the racing line
 * flat out. Longer tracks and more and faster bends work them harder.
 * Worked out once per track.
 */
export function trackWork(track: Track): number {
  const known = works.get(track);
  if (known !== undefined) return known;
  const line = racingLine(track);
  const top = AI.pace[AI.pace.length - 1];
  const plan = speedProfile(track, line, { grip: top[0], maxSpeed: HANDLING.maxSpeed * top[1], brake: top[2] });
  const n = plan.speed.length;
  let work = 0;
  for (let i = 0; i < n; i++) {
    work += plan.speed[i] * Math.abs(line.curvature[i]) * line.ds[i];
    work += Math.max(0, plan.speed[i] - plan.speed[(i + 1) % n]);
  }
  works.set(track, work);
  return work;
}

/** Laps medium tyres last on `track` before they go off: TYRES.lifeEasy on an easy track down to lifeHard on a hard one. */
export function trackTyreLife(track: Track): number {
  const T = TYRES;
  const hard = clamp((trackWork(track) - T.workEasy) / (T.workHard - T.workEasy), 0, 1);
  return T.lifeEasy + (T.lifeHard - T.lifeEasy) * hard;
}

/** About how much time a pit stop costs on `track` (s): the service, and slowing for it and getting going again. */
export function pitLoss(_track: Track): number {
  return CONDITIONS.service + CONDITIONS.pitLossExtra;
}

/** The kind of tyres an AI prefers for a stint that won't reach the finish (by grid slot: a mix in the field). */
export function preferredCompound(slot: number): Compound {
  return (['medium', 'hard', 'soft'] as const)[slot % 3];
}

/**
 * The tyres to fit for `lapsLeft` laps: wets in the rain; in the dry the
 * quickest kind that lasts to the finish (going off at most
 * CONDITIONS.pitEndSlack laps before it), else `preference` (there will be
 * another stop anyway).
 */
export function pickCompound(lapsLeft: number, mediumLife: number, wet: boolean, preference: Compound): Compound {
  if (wet) return 'wet';
  for (const c of ['soft', 'medium', 'hard'] as const) if (compoundLife(c, false, mediumLife) + CONDITIONS.pitEndSlack >= lapsLeft) return c;
  return preference;
}
