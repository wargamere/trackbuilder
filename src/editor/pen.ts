import type { Vec2 } from '../core/math.ts';

/**
 * A "lazy" pen for freehand drawing: the ink tip trails the pointer on a short
 * string and only moves when the string is pulled tight. Hand wobble smaller
 * than the string never reaches the paper, so lines come out smooth, while the
 * tip still follows every deliberate turn.
 */
export class LazyPen {
  /** String length in world metres. */
  private radius: number;
  tip: Vec2 | null = null;
  /** Latest pointer position (for drawing the string). */
  pointer: Vec2 | null = null;

  constructor(radius: number) {
    this.radius = radius;
  }

  start(p: Vec2, radius: number): Vec2 {
    this.radius = radius;
    this.tip = { x: p.x, y: p.y };
    this.pointer = { x: p.x, y: p.y };
    return { ...this.tip };
  }

  /** Moves the pointer; returns the new tip position if the tip moved, else null. */
  move(p: Vec2): Vec2 | null {
    this.pointer = { x: p.x, y: p.y };
    const t = this.tip;
    if (!t) return this.start(p, this.radius);
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.radius) return null;
    const k = (d - this.radius) / d;
    t.x += dx * k;
    t.y += dy * k;
    return { x: t.x, y: t.y };
  }

  /** Lifts the pen: the tip catches up with the pointer so the line ends where the pointer did. */
  finish(): Vec2 | null {
    const t = this.tip;
    const p = this.pointer;
    this.tip = null;
    if (!t || !p || (t.x === p.x && t.y === p.y)) return null;
    return { x: p.x, y: p.y };
  }
}
