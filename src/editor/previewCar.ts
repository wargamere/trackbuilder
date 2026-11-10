import { HANDLING } from '../config/handling.ts';
import { AI } from '../config/race.ts';
import { AuthorLap, TRACE_TICKS } from '../race/medals.ts';
import { racingLine } from '../race/racingLine.ts';
import type { Track } from '../track/track.ts';

/** Wait this long after the last change before working out the lap (s). */
const SETTLE = 0.45;
/** Physics ticks simulated per frame while working it out. */
const TICKS_PER_FRAME = 1200;

export interface CarPose {
  x: number;
  y: number;
  heading: number;
  /** 0..1: fades in when the lap starts playing. */
  alpha: number;
}

/**
 * The little car that laps the track on the editor map: the gold-medal bot's
 * flying lap on the track as it is, worked out a slice per frame once editing
 * pauses (so drawing never stutters), then played back on a loop at real
 * speed. Its lap time is the track's gold medal time.
 */
export class PreviewCar {
  private track: Track | null = null;
  private wait = SETTLE;
  private stage: 'line' | 'sim' | 'play' | 'none' = 'none';
  private sim: AuthorLap | null = null;
  private trace: number[] = [];
  private t = 0;
  private shown = 0;
  /** The gold lap (s) once worked out; null while working or if the bot couldn't finish. */
  lap: number | null = null;

  /** Starts over for `track` (null: nothing to drive). The same track carries on. */
  set(track: Track | null): void {
    if (track === this.track) return;
    this.track = track;
    this.stage = track ? 'line' : 'none';
    this.wait = SETTLE;
    this.sim = null;
    this.trace = [];
    this.lap = null;
    this.t = 0;
    this.shown = 0;
  }

  /** Still working out the lap. */
  get working(): boolean {
    return this.stage === 'line' || this.stage === 'sim';
  }

  /** One frame: a slice of the work, or the car moves on. `busy`: the user is editing, so hold off. */
  update(dt: number, busy: boolean): void {
    const track = this.track;
    if (!track) return;
    if (busy && this.working) this.wait = SETTLE;
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    switch (this.stage) {
      case 'line':
        // The racing line is the slow part of setting up the bot: a frame of its own.
        racingLine(track);
        this.stage = 'sim';
        return;
      case 'sim':
        this.sim ??= new AuthorLap(track, AI.medalDifficulty, true);
        if (!this.sim.run(TICKS_PER_FRAME)) return;
        this.lap = this.sim.result ?? null;
        this.trace = this.lap !== null ? this.sim.trace : [];
        this.sim = null;
        this.stage = this.trace.length >= 6 ? 'play' : 'none';
        return;
      case 'play': {
        const lap = this.trace.length / 3 / (HANDLING.tickRate / TRACE_TICKS);
        this.t = (this.t + dt) % lap;
        this.shown = Math.min(1, this.shown + dt * 2);
        return;
      }
      default:
    }
  }

  /** Where the car is now, or null. */
  pose(): CarPose | null {
    if (this.stage !== 'play') return null;
    const tr = this.trace;
    const n = tr.length / 3;
    const u = this.t * (HANDLING.tickRate / TRACE_TICKS);
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    let da = tr[j * 3 + 2] - tr[i * 3 + 2];
    da = Math.atan2(Math.sin(da), Math.cos(da));
    return {
      x: tr[i * 3] + (tr[j * 3] - tr[i * 3]) * f,
      y: tr[i * 3 + 1] + (tr[j * 3 + 1] - tr[i * 3 + 1]) * f,
      heading: tr[i * 3 + 2] + da * f,
      alpha: this.shown,
    };
  }
}
