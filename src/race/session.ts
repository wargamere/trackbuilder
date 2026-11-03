import { HANDLING } from '../config/handling.ts';
import { RACE } from '../config/race.ts';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export type RaceEvent =
  | { type: 'count'; n: number }
  | { type: 'go' }
  | { type: 'lapStart' }
  | { type: 'split'; index: number; time: number; delta: number | null }
  | { type: 'lap'; lap: number; time: number; best: boolean }
  | { type: 'lapInvalid' }
  | { type: 'finished' }
  | { type: 'wrongWay'; on: boolean };

/** The car's position along the track after one physics tick. */
export interface Progress {
  /** Distance along the track, 0..length. */
  s: number;
  /** Signed distance from the centre line. */
  lateral: number;
  /** Velocity along the track direction (negative = going the wrong way). */
  along: number;
}

/** Best lap so far on this track, carried between runs. */
export interface BestLap {
  time: number;
  /** Time at each checkpoint (excluding the finish). */
  splits: number[];
}

/**
 * Time-trial rules: countdown, lap timing with sub-tick precision, checkpoints
 * in order (so shortcuts don't count), split deltas against the best lap and a
 * wrong-way warning. Fed once per physics tick; knows nothing about rendering.
 */
export class RaceSession {
  readonly dt = 1 / HANDLING.tickRate;
  readonly length: number;
  readonly lapsToRun: number;
  phase: RacePhase = 'countdown';
  /** Physics ticks since the session began (the countdown included). */
  tick = 0;
  /** Session time (s) when the current lap started, or null before the first crossing. */
  lapStart: number | null = null;
  /** Session time of the first crossing (start of the run). */
  runStart: number | null = null;
  /** Session time the run ended. */
  runEnd: number | null = null;
  readonly laps: number[] = [];
  lastLap: number | null = null;
  best: BestLap | null;
  /** True when the best lap was set during this run. */
  newBest = false;
  wrongWay = false;

  private readonly checkpoints: number[];
  private nextCheckpoint = 0;
  private splits: number[] = [];
  private wrongWayTicks = 0;
  private countdownTicks: number;

  /** How far from the centre line a checkpoint still counts. */
  private readonly reach: number;

  constructor(length: number, best: BestLap | null = null, laps: number = RACE.laps, roadWidth = 12) {
    this.length = length;
    this.reach = roadWidth / 2 + RACE.checkpointMargin;
    this.best = best;
    this.lapsToRun = laps;
    this.countdownTicks = Math.round(RACE.countdown * HANDLING.tickRate);
    this.checkpoints = [];
    for (let k = 1; k < RACE.checkpoints; k++) this.checkpoints.push((length * k) / RACE.checkpoints);
  }

  get canDrive(): boolean {
    return this.phase !== 'countdown';
  }

  /** Countdown digit to show (3, 2, 1), or 0 once it's over. */
  get countdownValue(): number {
    if (this.phase !== 'countdown') return 0;
    return Math.ceil((this.countdownTicks - this.tick) / HANDLING.tickRate);
  }

  /** Seconds since the session started at the given interpolation point within the current tick. */
  time(alpha = 1): number {
    return (this.tick - 1 + alpha) * this.dt;
  }

  /** Current lap time for display, or null before the first crossing. */
  lapTime(alpha = 1): number | null {
    if (this.lapStart === null) return null;
    if (this.phase === 'finished' && this.runEnd !== null) return this.lastLap;
    return Math.max(0, this.time(alpha) - this.lapStart);
  }

  totalTime(): number | null {
    return this.runStart !== null && this.runEnd !== null ? this.runEnd - this.runStart : null;
  }

  /** Advances one physics tick. `prev` and `now` are the car's progress before and after the tick. */
  step(prev: Progress, now: Progress, out: RaceEvent[]): void {
    if (this.phase === 'countdown') {
      const before = this.countdownValue;
      this.tick++;
      const after = this.countdownValue;
      if (this.tick === 1 || (after !== before && after > 0)) out.push({ type: 'count', n: after });
      if (this.tick >= this.countdownTicks) {
        this.phase = 'racing';
        out.push({ type: 'go' });
      }
      return;
    }
    this.tick++;

    // Wrong way?
    const wrong = now.along < -RACE.wrongWaySpeed;
    this.wrongWayTicks = wrong ? this.wrongWayTicks + 1 : 0;
    const ww = this.wrongWayTicks > RACE.wrongWaySeconds * HANDLING.tickRate;
    if (ww !== this.wrongWay && (ww || now.along > 0)) {
      this.wrongWay = ww;
      out.push({ type: 'wrongWay', on: ww });
    }

    if (this.phase !== 'racing') return;
    const L = this.length;
    const ds = (now.s - prev.s + L) % L; // forward progress this tick
    if (ds <= 0 || ds > RACE.maxProgressPerTick) return; // not moving forward along the track, or a jump
    const near = Math.abs(now.lateral) <= this.reach;
    const t0 = (this.tick - 1) * this.dt;
    const crossedAt = (mark: number): number | null => {
      const d = (mark - prev.s + L) % L;
      if (d <= 0 || d > ds) return null;
      return t0 + (d / ds) * this.dt; // interpolate within the tick
    };

    // Checkpoints, strictly in order.
    if (this.lapStart !== null && near && this.nextCheckpoint < this.checkpoints.length) {
      const t = crossedAt(this.checkpoints[this.nextCheckpoint]);
      if (t !== null) {
        const split = t - this.lapStart;
        const k = this.nextCheckpoint;
        this.splits.push(split);
        this.nextCheckpoint++;
        const ref = this.best?.splits[k];
        out.push({ type: 'split', index: k, time: split, delta: ref !== undefined ? split - ref : null });
      }
    }

    // Finish line (s = 0 / L).
    const tf = crossedAt(L);
    if (tf === null || !near) return;
    if (this.lapStart === null) {
      this.lapStart = tf;
      this.runStart = tf;
      out.push({ type: 'lapStart' });
      return;
    }
    if (this.nextCheckpoint < this.checkpoints.length) {
      // Missed a checkpoint: this lap doesn't count, a new one starts here.
      out.push({ type: 'lapInvalid' });
    } else {
      const lapTime = tf - this.lapStart;
      this.laps.push(lapTime);
      this.lastLap = lapTime;
      const isBest = !this.best || lapTime < this.best.time;
      if (isBest) {
        this.best = { time: lapTime, splits: [...this.splits] };
        this.newBest = true;
      }
      out.push({ type: 'lap', lap: this.laps.length, time: lapTime, best: isBest });
      if (this.laps.length >= this.lapsToRun) {
        this.phase = 'finished';
        this.runEnd = tf;
        out.push({ type: 'finished' });
        return;
      }
    }
    this.lapStart = tf;
    this.nextCheckpoint = 0;
    this.splits = [];
  }
}

/** 83.456 -> "1:23.45" */
export function formatTime(t: number | null | undefined): string {
  if (t === null || t === undefined || !isFinite(t)) return '–:––.––';
  const cs = Math.floor(t * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Split delta: "-0.42" / "+1.05". */
export function formatDelta(d: number): string {
  const s = Math.abs(d).toFixed(2);
  return d < 0 ? `−${s}` : `+${s}`;
}
