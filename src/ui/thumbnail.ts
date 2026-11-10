import { sampleClosedCatmullRom } from '../track/spline.ts';
import type { TrackDef } from '../track/track.ts';
import { PAPER } from '../editor/render2d.ts';

/** A small picture of a track: the road on pale grass, a yellow dot at the start (library cards, starting shapes). */
export function drawThumbnail(canvas: HTMLCanvasElement, dots: TrackDef['control']): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = 160;
  const hgt = 90;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#e8efd9';
  ctx.fillRect(0, 0, w, hgt);
  const pts = sampleClosedCatmullRom(dots, 4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const s = Math.min((w - 16) / Math.max(1, maxX - minX), (hgt - 16) / Math.max(1, maxY - minY));
  const ox = w / 2 - ((minX + maxX) / 2) * s;
  const oy = hgt / 2 - ((minY + maxY) / 2) * s;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)));
  ctx.closePath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(3.5, 14 * s);
  ctx.stroke();
  ctx.strokeStyle = PAPER.asphalt;
  ctx.lineWidth = Math.max(2.5, 12 * s);
  ctx.stroke();
  const st = dots[0];
  ctx.fillStyle = PAPER.close;
  ctx.beginPath();
  ctx.arc(ox + st.x * s, oy + st.y * s, 3.5, 0, Math.PI * 2);
  ctx.fill();
}
