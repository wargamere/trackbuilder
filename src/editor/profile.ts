import { STR } from '../config/strings.ts';
import { TRACK } from '../config/track.ts';
import type { Dot } from '../core/math.ts';
import type { Track } from '../track/track.ts';
import { heightColor, PAPER } from './render2d.ts';
import { crossingKind, crossingsOf } from './validation.ts';

/** Screen rectangle of the height profile strip. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Inner plot area (leaves room for the axis labels). */
function plot(r: Rect): Rect {
  const left = 34;
  const pad = 8;
  return { x: r.x + left, y: r.y + pad + 4, w: r.w - left - pad, h: r.h - pad * 2 - 4 };
}

/** Colour of stretches at the steepest allowed slope. */
const STEEPEST = '#e8901a';

/** Height range shown: always 0..max height, so handles don't jump while dragging. */
const TOP = TRACK.maxHeight;

export const profileX = (r: Rect, s: number, length: number): number => {
  const p = plot(r);
  return p.x + (s / length) * p.w;
};
export const profileY = (r: Rect, h: number): number => {
  const p = plot(r);
  return p.y + p.h - (h / TOP) * p.h;
};
/** Metres of height per screen pixel in the profile. */
export const profileMetresPerPx = (r: Rect): number => TOP / plot(r).h;
/** Track position under screen x. */
export const profileS = (r: Rect, x: number, length: number): number => {
  const p = plot(r);
  return Math.max(0, Math.min(length, ((x - p.x) / p.w) * length));
};

export const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Index of the dot handle under (x, y), or -1. */
export function profileDotAt(r: Rect, dots: readonly Dot[], pos: readonly number[], length: number, x: number, y: number): number {
  let best = -1;
  let bestD = 12 * 12;
  dots.forEach((d, i) => {
    const dx = profileX(r, pos[i], length) - x;
    const dy = profileY(r, d.h ?? 0) - y;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  });
  return best;
}

export interface ProfileState {
  dots: readonly Dot[];
  pos: readonly number[];
  hover: number;
  selected: number;
  /** Track position of the cursor, or null. */
  cursor: number | null;
}

/**
 * The track's height along its length: the road profile (amber at the steepest allowed slope),
 * markers where the track crosses itself (grey level crossing, blue bridge, red
 * neither), the start line, and a draggable handle for every dot.
 */
export function drawProfile(ctx: CanvasRenderingContext2D, r: Rect, track: Track, st: ProfileState): void {
  const c = track.center;
  const L = c.length;
  const p = plot(r);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 253, 246, 0.94)';
  ctx.strokeStyle = 'rgba(27, 58, 138, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 10);
  ctx.fill();
  ctx.stroke();

  // Grid every 10 m with labels.
  ctx.font = '700 10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (let hgt = 0; hgt <= TOP; hgt += 10) {
    const y = Math.round(profileY(r, hgt)) + 0.5;
    ctx.strokeStyle = hgt === 0 ? 'rgba(27, 58, 138, 0.35)' : 'rgba(27, 58, 138, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, y);
    ctx.lineTo(p.x + p.w, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(27, 58, 138, 0.7)';
    ctx.fillText(`${hgt} m`, p.x - 5, y);
  }
  ctx.textAlign = 'left';

  // Crossings.
  for (const x of crossingsOf(c)) {
    const kind = crossingKind(x.dh);
    const col = kind === 'bridge' ? '#2d6fd6' : kind === 'flat' ? 'rgba(60, 60, 60, 0.5)' : PAPER.error;
    for (const i of [x.i, x.j]) {
      const sx = profileX(r, i * c.spacing, L);
      ctx.strokeStyle = col;
      ctx.lineWidth = kind === 'bad' ? 2.5 : 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, p.y);
      ctx.lineTo(sx, p.y + p.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Filled profile.
  const n = c.points.length;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y + p.h);
  for (let i = 0; i <= n; i++) ctx.lineTo(profileX(r, Math.min(L, i * c.spacing), L), profileY(r, c.height[i % n]));
  ctx.lineTo(p.x + p.w, p.y + p.h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(27, 58, 138, 0.10)';
  ctx.fill();
  // Profile line, coloured by height; amber where it is as steep as allowed (steeper dots get eased to this).
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const j = i + 1;
    ctx.strokeStyle = Math.abs(c.grade[i]) >= TRACK.maxGrade * 0.97 ? STEEPEST : heightColor(c.height[i]);
    ctx.beginPath();
    ctx.moveTo(profileX(r, i * c.spacing, L), profileY(r, c.height[i]));
    ctx.lineTo(profileX(r, Math.min(L, j * c.spacing), L), profileY(r, c.height[j % n]));
    ctx.stroke();
  }

  // Start line.
  ctx.fillStyle = '#111';
  ctx.fillRect(p.x - 1, p.y, 2, p.h);

  // Cursor.
  if (st.cursor !== null) {
    const x = profileX(r, st.cursor, L);
    ctx.strokeStyle = PAPER.close;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, p.y);
    ctx.lineTo(x, p.y + p.h);
    ctx.stroke();
  }

  // Dot handles.
  st.dots.forEach((d, i) => {
    const x = profileX(r, st.pos[i], L);
    const y = profileY(r, d.h ?? 0);
    const big = i === st.hover || i === st.selected;
    ctx.beginPath();
    ctx.arc(x, y, big ? 6.5 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? PAPER.ink : i === st.selected ? PAPER.close : '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = PAPER.ink;
    ctx.stroke();
  });

  // Title.
  ctx.font = '800 10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(27, 58, 138, 0.75)';
  ctx.textAlign = 'right';
  ctx.fillText(STR.editor.profileTitle, p.x + p.w, r.y + 9);
  ctx.restore();
}
