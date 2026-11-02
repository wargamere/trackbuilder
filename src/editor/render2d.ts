import { TRACK, WORLD } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';
import { leftOf } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

/** World (metres, origin at the centre of the drawable area) -> CSS pixels. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export const PAPER = {
  bg: '#f4efe1',
  gridMinor: 'rgba(60, 100, 170, 0.10)',
  gridMajor: 'rgba(60, 100, 170, 0.22)',
  border: 'rgba(27, 58, 138, 0.35)',
  ink: '#1b3a8a',
  inkWash: 'rgba(27, 58, 138, 0.13)',
  asphalt: '#4a4f58',
  edge: '#f8f8f4',
  kerbRed: '#d8342c',
  kerbWhite: '#ffffff',
  error: '#d63a3a',
  errorWash: 'rgba(214, 58, 58, 0.16)',
  close: '#f2b705',
} as const;

/** Fits the world rectangle into the free part of the screen. */
export function fitView(w: number, h: number, top: number, bottom: number): View {
  const margin = Math.max(8, Math.min(w, h) * 0.025);
  const availW = w - margin * 2;
  const availH = h - top - bottom - margin * 2;
  const scale = Math.max(0.1, Math.min(availW / WORLD.width, availH / WORLD.height));
  return { scale, ox: w / 2, oy: top + margin + availH / 2 };
}

export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale });
export const toWorld = (v: View, x: number, y: number): Vec2 => ({ x: (x - v.ox) / v.scale, y: (y - v.oy) / v.scale });

function pathLoop(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec2[], closed: boolean): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = v.ox + pts[i].x * v.scale;
    const y = v.oy + pts[i].y * v.scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (closed) ctx.closePath();
}

/** Paper background, grid, and the dashed border of the drawable area. */
export function drawPaper(ctx: CanvasRenderingContext2D, v: View, w: number, h: number): void {
  ctx.fillStyle = PAPER.bg;
  ctx.fillRect(0, 0, w, h);
  const x0 = v.ox - (WORLD.width / 2) * v.scale;
  const y0 = v.oy - (WORLD.height / 2) * v.scale;
  const x1 = v.ox + (WORLD.width / 2) * v.scale;
  const y1 = v.oy + (WORLD.height / 2) * v.scale;
  const grid = (step: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Lines are anchored on the world origin so the grid stays put when resizing.
    const sx = Math.floor(-v.ox / v.scale / step) * step;
    for (let wx = sx; v.ox + wx * v.scale <= w; wx += step) {
      const x = Math.round(v.ox + wx * v.scale) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    const sy = Math.floor(-v.oy / v.scale / step) * step;
    for (let wy = sy; v.oy + wy * v.scale <= h; wy += step) {
      const y = Math.round(v.oy + wy * v.scale) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  };
  grid(WORLD.gridMinor, PAPER.gridMinor);
  grid(WORLD.gridMajor, PAPER.gridMajor);

  // Shade outside the drawable area slightly.
  ctx.fillStyle = 'rgba(27, 58, 138, 0.05)';
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.fill('evenodd');
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = PAPER.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.setLineDash([]);
}

/** The raw stroke while drawing: a wash as wide as the road, plus the ink line. */
export function drawStroke(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec2[], failed = false): void {
  if (pts.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  pathLoop(ctx, v, pts, false);
  ctx.strokeStyle = failed ? PAPER.errorWash : PAPER.inkWash;
  ctx.lineWidth = TRACK.roadWidth * v.scale;
  ctx.stroke();
  ctx.strokeStyle = failed ? PAPER.error : PAPER.ink;
  ctx.lineWidth = Math.max(2, 0.25 * TRACK.roadWidth * v.scale);
  if (failed) ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export interface RoadStyle {
  asphalt: string;
  edge: string;
  arrows: boolean;
}

/** Road ribbon with edge lines, kerbs, direction arrows and the start/finish line. */
export function drawTrack(ctx: CanvasRenderingContext2D, v: View, track: Track, style?: Partial<RoadStyle>): void {
  const s: RoadStyle = { asphalt: PAPER.asphalt, edge: PAPER.edge, arrows: true, ...style };
  const c = track.center;
  const w = TRACK.roadWidth * v.scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Kerbs first, so the road covers their inner half.
  drawKerbs(ctx, v, track);

  pathLoop(ctx, v, c.points, true);
  ctx.strokeStyle = s.edge;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.strokeStyle = s.asphalt;
  ctx.lineWidth = Math.max(w - Math.max(1.5, 0.12 * w), w * 0.75);
  ctx.stroke();

  if (s.arrows) drawArrows(ctx, v, track);
  drawStartLine(ctx, v, c.points[0], c.tangents[0]);
}

function drawKerbs(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const c = track.center;
  const n = c.points.length;
  const off = TRACK.roadWidth / 2 + TRACK.kerbWidth * 0.25;
  ctx.lineWidth = Math.max(2, TRACK.kerbWidth * 1.6 * v.scale);
  ctx.lineCap = 'butt';
  const stripe = 2; // samples per stripe (~5 m)
  for (const k of track.kerbs) {
    // Outside of a right-hander is the left side.
    const side = k.sign > 0 ? 1 : -1;
    for (let j = 0; j < k.count; j += stripe) {
      ctx.strokeStyle = (j / stripe) % 2 === 0 ? PAPER.kerbRed : PAPER.kerbWhite;
      ctx.beginPath();
      for (let m = 0; m <= stripe && j + m <= k.count; m++) {
        const i = (k.start + j + m) % n;
        const l = leftOf(c.tangents[i]);
        const p = { x: c.points[i].x + l.x * off * side, y: c.points[i].y + l.y * off * side };
        const x = v.ox + p.x * v.scale;
        const y = v.oy + p.y * v.scale;
        if (m === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.lineCap = 'round';
}

function drawArrows(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const c = track.center;
  const every = Math.max(1, Math.round(70 / c.spacing));
  const size = Math.max(3, TRACK.roadWidth * 0.22 * v.scale);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = Math.max(1.5, size * 0.35);
  for (let i = every; i < c.points.length - every / 2; i += every) {
    const p = toScreen(v, c.points[i]);
    const t = c.tangents[i];
    const l = leftOf(t);
    ctx.beginPath();
    ctx.moveTo(p.x - t.x * size + l.x * size, p.y - t.y * size + l.y * size);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(p.x - t.x * size - l.x * size, p.y - t.y * size - l.y * size);
    ctx.stroke();
  }
}

/** Chequered start/finish band across the road. */
export function drawStartLine(ctx: CanvasRenderingContext2D, v: View, p: Vec2, t: Vec2): void {
  const l = leftOf(t);
  const cols = 6;
  const rows = 2;
  const half = TRACK.roadWidth / 2;
  const depth = 1.6; // metres per row
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      ctx.fillStyle = (r + k) % 2 === 0 ? '#111' : '#fff';
      const a = -half + (k / cols) * TRACK.roadWidth;
      const b = -half + ((k + 1) / cols) * TRACK.roadWidth;
      const d0 = (r - rows / 2) * depth;
      const d1 = d0 + depth;
      const corner = (side: number, along: number) =>
        toScreen(v, { x: p.x + l.x * side + t.x * along, y: p.y + l.y * side + t.y * along });
      const q = [corner(a, d0), corner(b, d0), corner(b, d1), corner(a, d1)];
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let m = 1; m < 4; m++) ctx.lineTo(q[m].x, q[m].y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Flag on a pole planted beside point `p` (the start, while drawing). */
export function drawFlag(ctx: CanvasRenderingContext2D, v: View, p: Vec2): void {
  const s = toScreen(v, p);
  const h = Math.max(18, 26 * v.scale);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x, s.y - h);
  ctx.stroke();
  const fw = h * 0.6;
  const fh = h * 0.4;
  const cells = 3;
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < cells; k++) {
      ctx.fillStyle = (r + k) % 2 === 0 ? '#111' : '#fff';
      ctx.fillRect(s.x + (k * fw) / cells, s.y - h + (r * fh) / 2, fw / cells + 0.5, fh / 2 + 0.5);
    }
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1;
  ctx.strokeRect(s.x, s.y - h, fw, fh);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

/** Ring around the start that shows where releasing will close the loop. */
export function drawCloseZone(ctx: CanvasRenderingContext2D, v: View, p: Vec2, active: boolean, time: number): void {
  const s = toScreen(v, p);
  const r = TRACK.closeRadius * v.scale;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fillStyle = active ? 'rgba(242, 183, 5, 0.28)' : 'rgba(242, 183, 5, 0.10)';
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = -time * 20;
  ctx.strokeStyle = PAPER.close;
  ctx.lineWidth = active ? 3 : 2;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/** Pulsing ring marking where a track problem is. */
export function drawProblem(ctx: CanvasRenderingContext2D, v: View, p: Vec2, time: number): void {
  const s = toScreen(v, p);
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);
  const r = Math.max(14, 16 * v.scale) * (1 + 0.25 * pulse);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = PAPER.error;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = `rgba(214, 58, 58, ${0.12 + 0.12 * pulse})`;
  ctx.fill();
}

/** Screen-space box of the flag drawn by drawFlag() at `p`, for hit testing. */
export function flagRect(v: View, p: Vec2): { x: number; y: number; w: number; h: number } {
  const s = toScreen(v, p);
  const h = Math.max(18, 26 * v.scale);
  return { x: s.x - 6, y: s.y - h - 4, w: h * 0.6 + 12, h: h * 0.55 + 8 };
}

export interface DotStyle {
  /** Radius in CSS pixels. */
  r: number;
  hover: number;
  selected: number;
  /** Index whose dot gets a "close the loop here" ring (open paths). */
  closeTarget: number;
  /** Index the start flag would move to (while dragging the flag). */
  startPreview: number;
}

/** Editable dots: white with an ink outline; the start dot is filled with ink. */
export function drawDots(ctx: CanvasRenderingContext2D, v: View, dots: readonly Vec2[], st: Partial<DotStyle> = {}): void {
  const r = st.r ?? 5;
  dots.forEach((p, i) => {
    const s = toScreen(v, p);
    const big = i === st.hover || i === st.selected;
    ctx.beginPath();
    ctx.arc(s.x, s.y, big ? r + 2.5 : r, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? PAPER.ink : i === st.selected ? PAPER.close : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = i === st.selected ? '#1b1b1b' : PAPER.ink;
    ctx.stroke();
    if (i === st.closeTarget || i === st.startPreview) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = PAPER.close;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });
}

/** Preview of an unfinished dots path: road-width wash, ink line, dashed closing hint. */
export function drawChain(ctx: CanvasRenderingContext2D, v: View, line: readonly Vec2[], dots: readonly Vec2[]): void {
  drawStroke(ctx, v, line);
  if (dots.length >= 3) {
    const a = toScreen(v, dots[dots.length - 1]);
    const b = toScreen(v, dots[0]);
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = PAPER.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
