import type { CarState } from '../car/physics.ts';
import { FLAGS } from '../config/race.ts';
import { clamp } from '../core/math.ts';

/** One car as race control sees it. */
export interface ControlCar {
  st: CarState;
  /** How far round the race it is (m; see RaceSession.raceDistance). */
  dist: number;
  /** Racing on the track: started, not finished, not in a pit stop. */
  racing: boolean;
  /** Its hardest hit this tick (m/s into a barrier or a car). */
  hit: number;
  /**
   * Out of the race (retired, or taken off the track): it leads nobody and
   * nobody closes up on it. While it still stands on the track it is `racing`
   * too, so the flags come out for it.
   */
  out?: boolean;
}

export type ControlEvent = { type: 'yellow'; s: number } | { type: 'sc-out' } | { type: 'sc-in' } | { type: 'green' };

/** Where yellow flags are out: around track position `s` (m), until `clearAt` (s). */
export interface YellowZone {
  s: number;
  clearAt: number;
}

/**
 * Race control: yellow flags where a car has crashed or stopped, and (when
 * it's switched on) the safety car when a car is stuck. Under the safety car
 * every car is held to its pace, and cars further back may close up to
 * FLAGS.scGap behind the car ahead, so the field bunches up. After
 * FLAGS.scMin s it comes in at the end of the leader's lap, then it's green.
 * Plain data: the race screen feeds it the cars each tick and applies the
 * speed caps and pace it gives.
 */
export class RaceControl {
  readonly length: number;
  readonly lapsToRun: number;
  readonly safetyCarOn: boolean;
  time = 0;
  /** The safety car: not out, out, or coming in at the end of this lap. */
  sc: 'none' | 'out' | 'in' = 'none';
  /** How many times it has come out this race. */
  scCount = 0;
  readonly yellows: YellowZone[] = [];
  private scSince = 0;
  private scInLap = 0;
  private stopped: number[] = [];
  private stranded: number[] = [];

  constructor(length: number, lapsToRun: number, safetyCarOn: boolean) {
    this.length = length;
    this.lapsToRun = lapsToRun;
    this.safetyCarOn = safetyCarOn;
  }

  /** One tick (`dt` s): incidents, yellow flags, the safety car. What happened goes in `out`. */
  step(dt: number, cars: readonly ControlCar[], out: ControlEvent[]): void {
    const F = FLAGS;
    this.time += dt;
    let stuck = false;
    cars.forEach((c, i) => {
      const slow = c.racing && Math.abs(c.st.speed) < F.stoppedSpeed;
      this.stopped[i] = slow ? (this.stopped[i] ?? 0) + dt : 0;
      // (Stranded: all but stopped, for longer: not just slow past an incident, or about to set off.)
      const still = c.racing && Math.abs(c.st.speed) < F.strandedSpeed;
      this.stranded[i] = still ? (this.stranded[i] ?? 0) + dt : 0;
      if ((slow && this.stopped[i] >= F.stoppedTime) || (c.racing && c.hit >= F.crashSpeed)) this.flag(c.st.s, out);
      if (this.stranded[i] >= F.safetyCarAfter) stuck = true;
    });
    for (let k = this.yellows.length - 1; k >= 0; k--) if (this.yellows[k].clearAt <= this.time) this.yellows.splice(k, 1);

    let leader = 0;
    for (const c of cars) if (!c.out) leader = Math.max(leader, c.dist);
    const leaderLap = Math.floor(leader / this.length);
    if (this.sc === 'none') {
      // Not in the last laps: there'd be no racing left after it.
      if (this.safetyCarOn && stuck && leaderLap < this.lapsToRun - F.scLastLaps) {
        this.sc = 'out';
        this.scSince = this.time;
        this.scCount++;
        out.push({ type: 'sc-out' });
      }
    } else if (this.sc === 'out') {
      if (this.time - this.scSince >= F.scMin) {
        this.sc = 'in';
        this.scInLap = leaderLap;
        out.push({ type: 'sc-in' });
      }
    } else if (leaderLap > this.scInLap) {
      this.sc = 'none';
      out.push({ type: 'green' });
    }
  }

  /** An incident at `s`: yellow flags there (kept out while it lasts). */
  private flag(s: number, out: ControlEvent[]): void {
    const clearAt = this.time + FLAGS.yellowHold;
    const z = this.yellows.find((y) => Math.abs(this.ahead(y.s, s)) < 40);
    if (z) {
      z.clearAt = Math.max(z.clearAt, clearAt);
      return;
    }
    this.yellows.push({ s, clearAt });
    out.push({ type: 'yellow', s });
  }

  /** Signed distance (m) from `from` forward to `to`, wrapped to -L/2..L/2. */
  private ahead(from: number, to: number): number {
    const L = this.length;
    let d = (to - from) % L;
    if (d > L / 2) d -= L;
    if (d <= -L / 2) d += L;
    return d;
  }

  /** Yellow flags are out at track position `s`. */
  yellowAt(s: number): boolean {
    return this.yellows.some((y) => {
      const d = this.ahead(y.s, s);
      return d >= -FLAGS.yellowBefore && d <= FLAGS.yellowAfter;
    });
  }

  /** How far ahead (m) the next yellow flags are from `s`, within `range`; null if none. */
  yellowAhead(s: number, range: number): number | null {
    let best: number | null = null;
    for (const y of this.yellows) {
      const d = this.ahead(s, y.s - FLAGS.yellowBefore);
      if (d >= 0 && d <= range && (best === null || d < best)) best = d;
    }
    return best;
  }

  /**
   * The most car `i` may go (m/s) under the safety car: its pace for the
   * leader, more for a car that's further than FLAGS.scGap behind the one
   * ahead (to close up), less for one that's closer. Infinity when it isn't out.
   */
  cap(i: number, cars: readonly ControlCar[]): number {
    const F = FLAGS;
    if (this.sc === 'none') return Infinity;
    const me = cars[i].dist;
    let gap = Infinity;
    cars.forEach((c, j) => {
      if (j === i || c.out) return;
      const d = c.dist - me;
      if (d > 0 && d < gap) gap = d;
    });
    if (gap === Infinity) return F.scSpeed;
    return clamp(F.scSpeed + (gap - F.scGap) * F.scCatchUp, F.scSpeed * 0.5, F.scSpeed + F.scMaxCatch);
  }
}
