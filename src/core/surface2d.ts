/** A full-screen 2D canvas sized for the device pixel ratio (capped at 2). */
export class Surface2D {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Size in CSS pixels. */
  w = 1;
  h = 1;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    // Measure the container: the canvas itself reads 0x0 while its layer is hidden.
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(this.w * this.dpr);
    const ph = Math.round(this.h * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  /** Resets the transform so drawing happens in CSS pixels. */
  begin(): CanvasRenderingContext2D {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return this.ctx;
  }
}
