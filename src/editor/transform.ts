import { WORLD } from '../config/track.ts';
import type { Dot } from '../core/math.ts';
import { quantizeControl } from './smoothing.ts';

export type Transform = 'grow' | 'shrink' | 'rotate' | 'mirror';

/**
 * Scales, rotates (90° clockwise) or mirrors (left-right) the whole track
 * about its middle, keeping heights. The result is moved, and if need be
 * shrunk, to stay inside the drawable area, then rounded to the dot grid.
 */
export function transformDots(dots: readonly Dot[], how: Transform): Dot[] {
  if (!dots.length) return [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const d of dots) {
    x0 = Math.min(x0, d.x);
    x1 = Math.max(x1, d.x);
    y0 = Math.min(y0, d.y);
    y1 = Math.max(y1, d.y);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const f = how === 'grow' ? 1.1 : how === 'shrink' ? 1 / 1.1 : 1;
  let out = dots.map((d) => {
    const x = d.x - cx;
    const y = d.y - cy;
    const p = how === 'rotate' ? { x: -y, y: x } : how === 'mirror' ? { x: -x, y } : { x: x * f, y: y * f };
    return { ...d, x: p.x + cx, y: p.y + cy };
  });
  // Keep it on the paper: shrink if it's too big, then slide it back inside.
  const margin = 12;
  const W = WORLD.width / 2 - margin;
  const H = WORLD.height / 2 - margin;
  const span = (k: 'x' | 'y') => Math.max(...out.map((d) => d[k])) - Math.min(...out.map((d) => d[k]));
  const fit = Math.min(1, (W * 2) / Math.max(1e-6, span('x')), (H * 2) / Math.max(1e-6, span('y')));
  if (fit < 1) out = out.map((d) => ({ ...d, x: cx + (d.x - cx) * fit, y: cy + (d.y - cy) * fit }));
  const shift = (k: 'x' | 'y', lim: number) => {
    const lo = Math.min(...out.map((d) => d[k]));
    const hi = Math.max(...out.map((d) => d[k]));
    return lo < -lim ? -lim - lo : hi > lim ? lim - hi : 0;
  };
  const sx = shift('x', W);
  const sy = shift('y', H);
  return quantizeControl(out.map((d) => ({ ...d, x: d.x + sx, y: d.y + sy })));
}
