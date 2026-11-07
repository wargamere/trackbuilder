import { CarPhysics } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import type { Track } from '../track/track.ts';
import { AI } from '../config/race.ts';
import { aiPace } from './ai.ts';
import { RacingDriver } from './driver.ts';

export type MedalId = 'gold' | 'silver' | 'bronze';

/** Medal targets as multiples of the bot's lap ("author time"). */
export const MEDALS: readonly { id: MedalId; factor: number }[] = [
  { id: 'gold', factor: 1 },
  { id: 'silver', factor: 1.1 },
  { id: 'bronze', factor: 1.25 },
];

/** Bump when the physics or the bot change, so stored author times are recomputed. */
export const AUTHOR_VERSION = 5;

export type MedalTimes = Record<MedalId, number>;

/** Physics ticks between the points of a recorded lap (AuthorLap.trace). */
export const TRACE_TICKS = 4;

export function medalTimes(author: number): MedalTimes {
  // Rounded up to the hundredth shown on screen, so "equal on screen" earns the medal.
  const t = (f: number) => Math.ceil(author * f * 100) / 100;
  return { gold: t(1), silver: t(1.1), bronze: t(1.25) };
}

/** Best medal a lap time earns, or null. */
export function medalFor(time: number, m: MedalTimes): MedalId | null {
  for (const { id } of MEDALS) if (time <= m[id]) return id;
  return null;
}

/** The next medal to aim for after `current` (null when gold is already won). */
export function nextMedal(current: MedalId | null): MedalId | null {
  if (current === 'gold') return null;
  if (current === 'silver') return 'gold';
  if (current === 'bronze') return 'silver';
  return 'bronze';
}

/**
 * Times an AI driver on a flying lap: it starts behind the line, drives one
 * lap to get up to speed and is timed over the second. Runs in slices so the
 * game can spread it over a few frames. Deterministic for a given track.
 * At the medal difficulty it sets the medal times; AI cars qualify with theirs.
 */
export class AuthorLap {
  private readonly car: CarPhysics;
  private readonly length: number;
  private tick = 0;
  private prevS: number;
  private crossings: number[] = [];
  private travelled = 0;
  private readonly maxTicks: number;
  private readonly driver: RacingDriver;
  /** Lap time in seconds, null if the bot could not finish, undefined while running. */
  result: number | null | undefined = undefined;
  /** With `record`: the timed lap as x, z, heading every TRACE_TICKS ticks (from the line round to it). */
  readonly trace: number[] = [];
  private readonly record: boolean;

  constructor(track: Track, difficulty: number = AI.medalDifficulty, record = false) {
    this.record = record;
    this.driver = new RacingDriver(track, aiPace(difficulty, track));
    this.car = new CarPhysics(track);
    this.length = track.center.length;
    this.prevS = this.car.state.s;
    // A warm-up lap and a timed one at a crawl of 8 m/s is the most we'll wait.
    this.maxTicks = Math.ceil(((this.length * 2.2) / 8) * HANDLING.tickRate);
  }

  /** Runs up to `budget` physics ticks; returns true when finished. */
  run(budget: number): boolean {
    if (this.result !== undefined) return true;
    const L = this.length;
    for (let k = 0; k < budget; k++) {
      this.car.step(this.driver.drive(this.car.state));
      this.tick++;
      const s = this.car.state.s;
      let ds = s - this.prevS;
      if (ds < -L / 2) ds += L;
      if (ds > L / 2) ds -= L;
      this.travelled += ds;
      // Crossed the line forwards: interpolate the moment within the tick.
      if (this.prevS > L * 0.75 && s < L * 0.25) {
        const before = L - this.prevS;
        const f = before / Math.max(1e-9, before + s);
        this.crossings.push((this.tick - 1 + f) / HANDLING.tickRate);
        // The first crossing is just after the start: the lap from there is the warm-up.
        // The one after it, started at full speed, is timed.
        if (this.crossings.length === 2) this.travelled = s;
        if (this.crossings.length === 3) {
          // A real lap covers the whole track (not a spin back over the line).
          this.result = this.travelled > L * 0.9 ? this.crossings[2] - this.crossings[1] : null;
          return true;
        }
      }
      this.prevS = s;
      if (this.record && this.crossings.length === 2 && this.tick % TRACE_TICKS === 0) {
        const st = this.car.state;
        this.trace.push(st.x, st.z, st.heading);
      }
      if (this.tick >= this.maxTicks) {
        this.result = null;
        return true;
      }
    }
    return false;
  }

  /** Runs to the end in one go (tests, small tracks). */
  finish(): number | null {
    while (!this.run(10000));
    return this.result ?? null;
  }
}
