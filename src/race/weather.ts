import { WEATHER } from '../config/race.ts';
import type { Weather as WeatherKind } from '../core/screen.ts';

/** A change in the weather: from `t` s into the run, rain (1) or dry (0). */
interface Change {
  t: number;
  rain: number;
}

/**
 * The weather through a run, and how wet the road is. Dry stays dry and
 * rain stays rain; changing weather starts dry, then rain comes (and maybe
 * stops again) at random points in the race, or every few minutes in
 * practice. The road gets wet in the rain and dries out after it, the racing
 * line first (the cars clear it), so for a while there's a dry line on a
 * damp track. Deterministic for a given random source.
 */
export class Weather {
  readonly kind: WeatherKind;
  /** How hard it's raining now (0..1). */
  rain: number;
  /** How wet the road is on the racing line and off it (0..1). */
  lineWet: number;
  offWet: number;
  /** Seconds into the run. */
  time = 0;
  private readonly changes: Change[] = [];
  private target: number;
  private readonly rand: () => number;
  /** In practice: when the next change is generated from. */
  private readonly practice: boolean;

  /** `raceSeconds`: about how long the race lasts (Infinity: practice, changing every few minutes). */
  constructor(kind: WeatherKind, raceSeconds: number, rand: () => number = Math.random) {
    this.kind = kind;
    this.rand = rand;
    const wet = kind === 'rain' ? 1 : 0;
    this.rain = this.target = this.lineWet = this.offWet = wet;
    this.practice = !Number.isFinite(raceSeconds);
    if (kind !== 'changing') return;
    const W = WEATHER;
    if (this.practice) this.planPractice(0);
    else {
      const between = (a: number, b: number) => raceSeconds * (a + (b - a) * rand());
      this.changes.push({ t: between(W.rainFrom, W.rainTo), rain: 1 });
      if (rand() < W.stopChance) this.changes.push({ t: between(W.stopFrom, W.stopTo), rain: 0 });
    }
  }

  /** Practice: the next change after `from` s, the opposite of the one before. */
  private planPractice(from: number): void {
    const W = WEATHER;
    const last = this.changes.length ? this.changes[this.changes.length - 1].rain : this.target;
    this.changes.push({ t: from + W.practiceMin + (W.practiceMax - W.practiceMin) * this.rand(), rain: 1 - last });
  }

  /** Moves the weather on by `dt` s. */
  step(dt: number): void {
    if (this.kind !== 'changing') return;
    const W = WEATHER;
    this.time += dt;
    while (this.changes.length && this.changes[0].t <= this.time) {
      const c = this.changes.shift();
      if (!c) break;
      this.target = c.rain;
      if (this.practice) this.planPractice(c.t);
    }
    // Rain comes in, or eases off, over a little while.
    const ramp = dt / W.rainRamp;
    this.rain = this.target > this.rain ? Math.min(this.target, this.rain + ramp) : Math.max(this.target, this.rain - ramp);
    // The road gets wet as fast as it rains; it dries on its own, the line first.
    const toward = (w: number, tau: number) => w + (this.rain - w) * (1 - Math.exp(-dt / tau));
    this.lineWet = this.rain > this.lineWet ? toward(this.lineWet, W.wetting) : toward(this.lineWet, W.dryingLine);
    this.offWet = this.rain > this.offWet ? toward(this.offWet, W.wetting) : toward(this.offWet, W.dryingOff);
  }

  /** How wet the road is `off` m from the racing line. */
  wetnessAt(off: number): number {
    const W = WEATHER;
    const k = Math.min(1, Math.max(0, (Math.abs(off) - W.lineHalf) / W.lineBlend));
    return this.lineWet + (this.offWet - this.lineWet) * k;
  }

  /** The next change if it's within the forecast (WEATHER.forecast s): rain coming, or stopping. */
  forecast(): { to: 'rain' | 'dry'; in: number } | null {
    const c = this.changes[0];
    if (!c || c.t - this.time > WEATHER.forecast || (c.rain > 0) === this.target > 0) return null;
    return { to: c.rain > 0 ? 'rain' : 'dry', in: Math.max(0, c.t - this.time) };
  }
}
