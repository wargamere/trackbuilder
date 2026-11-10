/**
 * Fixed-timestep accumulator. Frames of any length are turned into a whole
 * number of fixed physics steps; the leftover fraction is returned so the
 * renderer can interpolate between the last two physics states.
 */
export class FixedStep {
  readonly dt: number;
  /** Physics steps taken since the last reset. */
  tick = 0;
  private acc = 0;

  constructor(hz: number) {
    this.dt = 1 / hz;
  }

  /**
   * Adds one frame's real time and runs `step` as many times as it covers.
   * Returns the interpolation factor (0..1) between the previous and current state.
   */
  advance(frameDt: number, step: () => void, maxSteps = 30): number {
    // Long stalls (tab switch, breakpoint) are dropped rather than replayed.
    this.acc += Math.min(Math.max(frameDt, 0), 0.25);
    let n = 0;
    // The epsilon absorbs float error, so e.g. a 1/60 s frame is exactly two 1/120 s steps.
    while (this.acc >= this.dt - 1e-9 && n < maxSteps) {
      step();
      this.acc -= this.dt;
      this.tick++;
      n++;
    }
    if (this.acc < 0) this.acc = 0;
    if (n === maxSteps) this.acc = 0;
    return Math.min(1, this.acc / this.dt);
  }

  reset(): void {
    this.acc = 0;
    this.tick = 0;
  }
}
