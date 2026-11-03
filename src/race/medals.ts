import { CarPhysics } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import type { Track } from '../track/track.ts';
import { botInput, type BotOptions } from './bot.ts';

export type MedalId = 'gold' | 'silver' | 'bronze';

/** Medal targets as multiples of the bot's lap ("author time"). */
export const MEDALS: readonly { id: MedalId; factor: number }[] = [
  { id: 'gold', factor: 1 },
  { id: 'silver', factor: 1.1 },
  { id: 'bronze', factor: 1.25 },
];

/** Bump when the physics or the bot change, so stored author times are recomputed. */
export const AUTHOR_VERSION = 3;

export type MedalTimes = Record<MedalId, number>;

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
 * Times the test bot on a flying lap: it starts behind the line, drives one
 * lap to get up to speed and is timed over the second. Runs in slices so the
 * game can spread it over a few frames. Deterministic for a given track.
 * The default pace sets the medal times; AI cars qualify with their own.
 */
export class AuthorLap {
  private readonly car: CarPhysics;
  private readonly track: Track;
  private readonly length: number;
  private tick = 0;
  private prevS: number;
  private crossings: number[] = [];
  private travelled = 0;
  private readonly maxTicks: number;
  private readonly aggression: number;
  private readonly opts: BotOptions;
  /** Lap time in seconds, null if the bot could not finish, undefined while running. */
  result: number | null | undefined = undefined;

  constructor(track: Track, aggression = 0.8, opts: BotOptions = {}) {
    this.track = track;
    this.aggression = aggression;
    this.opts = opts;
    this.car = new CarPhysics(track);
    this.length = track.center.length;
    this.prevS = this.car.state.s;
    // Two laps at a crawl of 8 m/s is the most we'll wait.
    this.maxTicks = Math.ceil(((this.length * 2.2) / 8) * HANDLING.tickRate);
  }

  /** Runs up to `budget` physics ticks; returns true when finished. */
  run(budget: number): boolean {
    if (this.result !== undefined) return true;
    const L = this.length;
    for (let k = 0; k < budget; k++) {
      this.car.step(botInput(this.car.state, this.track, this.aggression, this.opts));
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
        if (this.crossings.length === 1) this.travelled = s;
        if (this.crossings.length === 2) {
          // A real lap covers the whole track (not a spin back over the line).
          this.result = this.travelled > L * 0.9 ? this.crossings[1] - this.crossings[0] : null;
          return true;
        }
      }
      this.prevS = s;
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
