import { HANDLING } from '../config/handling.ts';
import { RACE } from '../config/race.ts';
import { clamp } from '../core/math.ts';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export type RaceEvent =
  | { type: 'count'; n: number }
  | { type: 'go' }
  | { type: 'lapStart' }
  | { type: 'split'; index: number; time: number; delta: number | null }
  /**
   * A lap was completed. `valid` is false if the car broke track limits on it
   * or `missed` a checkpoint (cut across to a later stretch): it still counts
   * towards the race, but its time never does.
   */
  | { type: 'lap'; lap: number; time: number; best: boolean; valid: boolean; missed: boolean }
  /** The whole car went past the track edge: this lap's time won't count. */
  | { type: 'trackLimits' }
  /** A checkpoint was skipped (seen on reaching a later one): this lap's time won't count. */
  | { type: 'missedCheckpoint' }
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
  /** The whole car is past the track edge (kerbs count as track). */
  offTrack?: boolean;
}

/** Best lap so far on this track, carried between runs. */
export interface BestLap {
  time: number;
  /** Time at each checkpoint (excluding the finish). */
  splits: number[];
}

/**
 * Time-trial rules: countdown, lap timing with sub-tick precision, checkpoints
 * in order (a lap that skips one still counts, but its time doesn't), split
 * deltas against the best lap and a wrong-way warning. Fed once per physics
 * tick; knows nothing about rendering.
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
  /**
   * The chequered flag is out (someone has finished the race): this car's
   * race ends the next time it crosses the line, however many laps it has done.
   */
  flagged = false;
  /** Retired from the race (broken down): how far round it had got (m, see raceDistance), else null. */
  retiredAt: number | null = null;
  readonly laps: number[] = [];
  /** Per completed lap: false if track limits were broken or a checkpoint missed on it. */
  readonly lapValid: boolean[] = [];
  /** Track limits were broken on the lap being driven. */
  cut = false;

  /** The lap being driven won't count for its time (track limits, or a missed checkpoint). */
  get lapSpoilt(): boolean {
    return this.cut || this.missed;
  }
  private offTicks = 0;
  lastLap: number | null = null;
  best: BestLap | null;
  /** True when the best lap was set during this run. */
  newBest = false;
  wrongWay = false;

  private readonly checkpoints: number[];
  private nextCheckpoint = 0;
  /** A checkpoint was skipped on the lap being driven. */
  private missed = false;
  private splits: number[] = [];
  private wrongWayTicks = 0;
  private countdownTicks: number;

  /** How far from the centre line a checkpoint still counts. */
  private readonly reach: number;

  /**
   * `laps` may be Infinity (practice: lap after lap, never finished), and
   * `countdown` 0 (practice: drive straight away).
   */
  constructor(length: number, best: BestLap | null = null, laps: number = RACE.laps, roadWidth = 12, countdown: number = RACE.countdown) {
    this.length = length;
    this.reach = roadWidth / 2 + RACE.checkpointMargin;
    this.best = best;
    this.lapsToRun = laps;
    this.countdownTicks = Math.round(countdown * HANDLING.tickRate);
    if (this.countdownTicks <= 0) this.phase = 'racing';
    this.checkpoints = [];
    for (let k = 1; k < RACE.checkpoints; k++) this.checkpoints.push((length * k) / RACE.checkpoints);
  }

  /** Session time of the start (GO), when every car sets off. */
  get goTime(): number {
    return this.countdownTicks * this.dt;
  }

  /**
   * How far round the race the car is, for positions: completed laps, the
   * checkpoints passed this lap, plus the way on from the last one (negative
   * on the grid, before the line). Driving backwards never adds.
   */
  raceDistance(s: number): number {
    if (this.retiredAt !== null) return this.retiredAt;
    const L = this.length;
    let d = ((s % L) + L) % L;
    if (this.lapStart === null) {
      if (d > L / 2) d -= L;
      return Math.min(d, 0);
    }
    if (this.phase === 'finished') return this.laps.length * L;
    const cp = this.nextCheckpoint;
    const from = cp === 0 ? 0 : this.checkpoints[cp - 1];
    d = (s - from) % L;
    if (d > L / 2) d -= L;
    if (d <= -L / 2) d += L;
    return this.laps.length * L + from + clamp(d, 0, L - from);
  }

  /** Out of the race: it broke down before the finish (a DNF). */
  get retired(): boolean {
    return this.retiredAt !== null;
  }

  /**
   * The car at track position `s` has broken down: its race is over where it
   * is, unfinished (no total time; it keeps the distance it had covered).
   * Nothing happens before the start or after the finish.
   */
  retire(s: number): void {
    if (this.phase !== 'racing') return;
    this.retiredAt = this.raceDistance(s);
    this.phase = 'finished';
    this.wrongWay = false;
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
    if (this.phase === 'finished') return this.lastLap;
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
    // Track limits: off the track for a moment invalidates the lap being driven.
    this.offTicks = now.offTrack ? this.offTicks + 1 : 0;
    if (this.lapStart !== null && !this.cut && this.offTicks >= Math.round(RACE.trackLimitSeconds * HANDLING.tickRate)) {
      this.cut = true;
      out.push({ type: 'trackLimits' });
    }
    const L = this.length;
    // Avoid adding a whole lap to positive distances: that rounds away tiny
    // differences at a gate exactly on a centre-line vertex (notably Spielberg).
    const ds = now.s >= prev.s ? now.s - prev.s : now.s - prev.s + L;
    if (ds <= 0 || ds > RACE.maxProgressPerTick) return; // not moving forward along the track, or a jump
    const near = Math.abs(now.lateral) <= this.reach;
    const t0 = (this.tick - 1) * this.dt;
    const crossedAt = (mark: number): number | null => {
      const d = mark > prev.s ? mark - prev.s : mark - prev.s + L;
      if (d <= 0 || d > ds + 1e-7) return null;
      return t0 + clamp(d / ds, 0, 1) * this.dt; // interpolate within the tick
    };

    // Checkpoints, in order. Reaching a later one with an earlier one still to pass means that
    // one was missed: the lap goes on (and on counting towards the race) but is marked.
    if (this.lapStart !== null && near) {
      for (let k = this.nextCheckpoint; k < this.checkpoints.length; k++) {
        const t = crossedAt(this.checkpoints[k]);
        if (t === null) continue;
        if (this.nextCheckpoint < k && !this.missed) out.push({ type: 'missedCheckpoint' });
        while (this.nextCheckpoint < k) {
          this.splits.push(NaN);
          this.nextCheckpoint++;
          this.missed = true;
        }
        const split = t - this.lapStart;
        this.splits.push(split);
        this.nextCheckpoint++;
        const ref = this.best?.splits[k];
        out.push({ type: 'split', index: k, time: split, delta: ref !== undefined && !this.missed ? split - ref : null });
        break;
      }
    }

    // Finish line (s = 0 / L).
    // Unlike checkpoints, the finish has no consumed gate index. Require the
    // actual wrap so rounding just before it cannot start/finish two laps.
    const tf = now.s < prev.s ? crossedAt(L) : null;
    if (tf === null || !near) return;
    if (this.lapStart === null) {
      this.lapStart = tf;
      this.runStart = tf;
      this.cut = false;
      out.push({ type: 'lapStart' });
      return;
    }
    // A missed checkpoint (cut across to a later stretch, or ran far off the road past it)
    // doesn't throw the lap away: it counts towards the race like any other, but, like
    // breaking track limits, its time never counts.
    const missed = this.missed || this.nextCheckpoint < this.checkpoints.length;
    const lapTime = tf - this.lapStart;
    const valid = !this.cut && !missed;
    this.laps.push(lapTime);
    this.lapValid.push(valid);
    this.lastLap = lapTime;
    // Only clean laps can be bests (and so ghosts, medals and the score).
    const isBest = valid && (!this.best || lapTime < this.best.time);
    if (isBest) {
      this.best = { time: lapTime, splits: [...this.splits] };
      this.newBest = true;
    }
    out.push({ type: 'lap', lap: this.laps.length, time: lapTime, best: isBest, valid, missed });
    if (this.laps.length >= this.lapsToRun || this.flagged) {
      this.phase = 'finished';
      this.runEnd = tf;
      out.push({ type: 'finished' });
      return;
    }
    this.lapStart = tf;
    this.nextCheckpoint = 0;
    this.splits = [];
    this.cut = false;
    this.missed = false;
  }

  /** Fastest clean lap of this run, or null if no lap was clean. */
  bestOfRun(): number | null {
    const clean = this.laps.filter((_, i) => this.lapValid[i]);
    return clean.length ? Math.min(...clean) : null;
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
