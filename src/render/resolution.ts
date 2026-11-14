import { RESOLUTION } from '../config/handling.ts';

/**
 * Automatic resolution while racing: when the frames come too slowly and the
 * game's own work per frame isn't what's holding them up (so it's the
 * graphics card, filling a big high-DPI screen), it renders fewer pixels,
 * one step at a time; when frames come easily again for a good while, it
 * goes back up. The scale multiplies the quality setting's pixel ratio.
 * Plain logic (no WebGL), fed one frame at a time, so it's testable.
 */
export class ResolutionGovernor {
  /** The share of the quality setting's pixel ratio to render at (one of RESOLUTION.steps). */
  scale = 1;
  private step = 0;
  /** The window being measured: frames, their wall-clock time and the game's own time in them (s). */
  private frames = 0;
  private wall = 0;
  private busy = 0;
  /** Windows in a row with frames coming slowly (and not because of our own work), or easily. */
  private slow = 0;
  private easy = 0;
  /** Seconds since the last change (the drawing buffer is reallocated on a change: not too often). */
  private since = Infinity;

  /** Back to full resolution (a new race, or the quality setting changed). */
  reset(): void {
    this.scale = 1;
    this.step = 0;
    this.frames = this.wall = this.busy = 0;
    this.slow = this.easy = 0;
    this.since = Infinity;
  }

  /**
   * One frame: `dt` the wall-clock time since the last (s), `cpu` the time
   * the game spent on it (s). Returns true when the scale changed.
   */
  frame(dt: number, cpu: number): boolean {
    const R = RESOLUTION;
    this.since += dt;
    // (A stall: a tab switch, an ad, a breakpoint. Not a measure of anything.)
    if (dt <= 0 || dt > R.stall) return false;
    this.frames++;
    this.wall += dt;
    this.busy += cpu;
    if (this.wall < R.window) return false;
    const interval = this.wall / this.frames;
    const share = this.busy / this.wall;
    this.frames = this.wall = this.busy = 0;
    // Slow, and our own work takes well under the time a frame took: waiting on the GPU.
    if (interval > R.slowFrame && share < R.cpuShare) {
      this.slow++;
      this.easy = 0;
    } else if (interval < R.easyFrame) {
      this.easy++;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.easy = 0;
    }
    if (this.since < R.minGap) return false;
    if (this.slow >= R.downAfter && this.step < R.steps.length - 1) {
      this.step++;
    } else if (this.easy >= R.upAfter && this.step > 0) {
      this.step--;
    } else return false;
    this.scale = R.steps[this.step];
    this.slow = 0;
    this.easy = 0;
    this.since = 0;
    return true;
  }
}
