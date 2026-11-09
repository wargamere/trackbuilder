import { compoundLife } from '../car/tyres.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, CONDITIONS, DEFAULT_SETUP, SETUP, TYRES, type CarSetup, type Compound, type WingLevel } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import type { Track } from '../track/track.ts';
import { planLapTime, racingLine, roadPace, speedProfile, type Pace } from './racingLine.ts';

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
 * The tyres to fit for `lapsLeft` laps: wets on a wet road (more than half
 * wet); in the dry the quickest kind that lasts to the finish (going off at
 * most CONDITIONS.pitEndSlack laps before it), else `preference` (there will
 * be another stop anyway).
 */
export function pickCompound(lapsLeft: number, mediumLife: number, wetness: number, preference: Compound): Compound {
  if (wetness >= 0.5) return 'wet';
  for (const c of ['soft', 'medium', 'hard'] as const) if (compoundLife(c, 0, mediumLife) + CONDITIONS.pitEndSlack >= lapsLeft) return c;
  return preference;
}

const wingLaps = new WeakMap<Track, Record<WingLevel, number>>();

/** The flat-out planned lap on `track` with each wing (s): low wing wins where the straights are long, high where the bends are fast. */
export function wingLapTimes(track: Track): Record<WingLevel, number> {
  const known = wingLaps.get(track);
  if (known) return known;
  const line = racingLine(track);
  const top = AI.pace[AI.pace.length - 1];
  const base: Pace = roadPace({ grip: top[0], maxSpeed: HANDLING.maxSpeed * top[1], brake: top[2] }, track);
  const lap = (w: WingLevel) => planLapTime(line, speedProfile(track, line, { ...base, downforce: SETUP.wing[w].downforce, drag: SETUP.wing[w].drag }));
  const times = { low: lap('low'), medium: lap('medium'), high: lap('high') };
  wingLaps.set(track, times);
  return times;
}

/** The quickest wing for `track` (ties go to medium). */
export function bestWing(track: Track): WingLevel {
  const t = wingLapTimes(track);
  let best: WingLevel = 'medium';
  for (const w of ['low', 'high'] as const) if (t[w] < t[best] - 0.02) best = w;
  return best;
}

/** The setup the AI teams run on `track` (and the one suggested to you): the quickest wing, standard gears and brakes. */
export function suggestedSetup(track: Track): CarSetup {
  return { ...DEFAULT_SETUP, wing: bestWing(track) };
}

const lapTimes = new WeakMap<Track, number>();

/** About how long a lap of `track` takes in a race (s): the medal pace's planned lap. */
export function trackLapTime(track: Track): number {
  const known = lapTimes.get(track);
  if (known !== undefined) return known;
  const line = racingLine(track);
  const p = AI.pace[3];
  const t = planLapTime(line, speedProfile(track, line, roadPace({ grip: p[0], maxSpeed: HANDLING.maxSpeed * p[1], brake: p[2] }, track)));
  lapTimes.set(track, t);
  return t;
}
