import { TRACK, WORLD } from '../config/track.ts';
import { wrap, type Dot, type Vec2 } from '../core/math.ts';
import { kerbAt, kerbLayout } from '../track/kerbs.ts';
import { pitLayout } from '../track/pits.ts';
import { edgeOffsets, leftOf, sampleAt } from '../track/spline.ts';
import { PLACED_SPEC, placedOn, runoffLayout, type Placed, type PlacedKind } from '../track/extras.ts';
import type { Track } from '../track/track.ts';
import { crossingKind, crossingsOf } from './validation.ts';

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
  /** Dirt and snow roads. */
  dirt: '#8a6744',
  snow: '#dfe6ee',
  edge: '#f8f8f4',
  kerbRed: '#d8342c',
  kerbWhite: '#ffffff',
  error: '#d63a3a',
  errorWash: 'rgba(214, 58, 58, 0.16)',
  close: '#f2b705',
} as const;

/** Fits the world rectangle into the free part of the screen. */
export function fitView(w: number, h: number, top: number, bottom: number, left = 0, right = 0): View {
  const margin = Math.max(8, Math.min(w, h) * 0.025);
  const availW = w - left - right - margin * 2;
  const availH = h - top - bottom - margin * 2;
  const scale = Math.max(0.1, Math.min(availW / WORLD.width, availH / WORLD.height));
  return { scale, ox: left + margin + availW / 2, oy: top + margin + availH / 2 };
}

export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale });
export const toWorld = (v: View, x: number, y: number): Vec2 => ({ x: (x - v.ox) / v.scale, y: (y - v.oy) / v.scale });

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

/** Smooth open path through the points (quadratic curves through the midpoints). */
function smoothPath(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec2[]): void {
  const X = (p: Vec2) => v.ox + p.x * v.scale;
  const Y = (p: Vec2) => v.oy + p.y * v.scale;
  ctx.beginPath();
  ctx.moveTo(X(pts[0]), Y(pts[0]));
  if (pts.length === 2) {
    ctx.lineTo(X(pts[1]), Y(pts[1]));
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    ctx.quadraticCurveTo(X(a), Y(a), (X(a) + X(b)) / 2, (Y(a) + Y(b)) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(X(last), Y(last));
}

/** The stroke while drawing: a wash as wide as the road, plus the ink line. */
export function drawStroke(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec2[], failed = false): void {
  if (pts.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  smoothPath(ctx, v, pts);
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
  /** Colour the road by its height (the editor's Height mode). */
  heights: boolean;
  /** Barrier lines along the edges. */
  walls: boolean;
}

/** Road colour for a height: slate blue at ground level through green to orange at the top. */
export function heightColor(h: number): string {
  const t = Math.max(0, Math.min(1, h / TRACK.maxHeight));
  const hue = 210 - 190 * t;
  return `hsl(${hue.toFixed(0)}, ${(22 + 60 * Math.min(1, t * 2.5)).toFixed(0)}%, ${(42 + 8 * t).toFixed(0)}%)`;
}

/** Stretches of road that pass over another (sample ranges, drawn last with a shadow). */
const overpassCache = new WeakMap<Track, { from: number; count: number }[]>();
export function overpasses(track: Track): { from: number; count: number }[] {
  let o = overpassCache.get(track);
  if (o) return o;
  const c = track.center;
  o = [];
  for (const x of crossingsOf(c)) {
    if (crossingKind(x.dh) !== 'bridge') continue;
    const upper = x.dh > 0 ? x.j : x.i;
    const half = Math.ceil((c.width / Math.max(0.3, Math.sin(x.angle)) + 10) / c.spacing);
    o.push({ from: upper - half, count: half * 2 + 1 });
  }
  overpassCache.set(track, o);
  return o;
}

function strokeRun(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec2[], from: number, count: number): void {
  const n = pts.length;
  ctx.beginPath();
  for (let k = 0; k <= count; k++) {
    const p = pts[wrap(from + k, n)];
    const x = v.ox + p.x * v.scale;
    const y = v.oy + p.y * v.scale;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** The asphalt of samples [from, from + count], coloured by height if asked. */
function paintRoad(ctx: CanvasRenderingContext2D, v: View, track: Track, s: RoadStyle, from: number, count: number): void {
  const c = track.center;
  const w = c.width * v.scale;
  ctx.strokeStyle = s.edge;
  ctx.lineWidth = w;
  strokeRun(ctx, v, c.points, from, count);
  ctx.lineWidth = Math.max(w - Math.max(1.5, 0.12 * w), w * 0.75);
  if (!s.heights) {
    ctx.strokeStyle = s.asphalt;
    strokeRun(ctx, v, c.points, from, count);
    return;
  }
  const n = c.points.length;
  const run = 3;
  for (let k = 0; k < count; k += run) {
    ctx.strokeStyle = heightColor(c.height[wrap(from + k + 1, n)]);
    strokeRun(ctx, v, c.points, from + k, Math.min(run, count - k));
  }
}

/** Barrier line colour and thickness (m) for each style. */
const WALL_LINES = {
  concrete: ['rgba(40, 44, 52, 0.55)', 0.5],
  tyres: ['rgba(20, 22, 26, 0.75)', 0.6],
  tecpro: ['rgba(35, 87, 184, 0.85)', 0.9],
  armco: ['rgba(120, 128, 140, 0.9)', 0.35],
} as const;

/** Thin barrier lines just outside the kerbs (or further out), coloured by the kind of barrier. */
function drawWallLines(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const c = track.center;
  const off = c.wallOffset;
  const [colour, width] = WALL_LINES[track.options.barrier];
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1, width * v.scale);
  for (const side of [1, -1]) {
    ctx.beginPath();
    c.points.forEach((p, i) => {
      const l = leftOf(c.tangents[i]);
      const x = v.ox + (p.x + l.x * off * side) * v.scale;
      const y = v.oy + (p.y + l.y * off * side) * v.scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

/** Map colours of the run-off kinds (by OPTION_CHOICES.runoff index; grass is the paper). */
const RUNOFF_FILL = [null, '#d9c79f', '#8d939d'] as const;

/** Gravel or tarmac run-off out to the barrier line, side by side and stretch by stretch (it can be painted). */
function drawRunoff(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const c = track.center;
  const n = c.points.length;
  const lay = runoffLayout(track);
  const { left, right } = edgeOffsets(c);
  const outer = c.wallOffset + 0.4;
  const at = (i: number, lat: number): [number, number] => {
    const l = leftOf(c.tangents[i]);
    return [v.ox + (c.points[i].x + l.x * lat) * v.scale, v.oy + (c.points[i].y + l.y * lat) * v.scale];
  };
  for (const side of [1, -1] as const) {
    const kinds = side === 1 ? lay.left : lay.right;
    // Runs of the same kind, each one polygon: along the road edge, back along the outer edge.
    let i = 0;
    while (i < n) {
      const kind = kinds[i];
      let j = i;
      while (j < n && kinds[j] === kind) j++;
      const fill = RUNOFF_FILL[kind];
      if (fill) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (let k = i; k <= Math.min(j, n); k++) {
          const s = k % n;
          const e = (side === 1 ? left[s] : right[s]) - 0.2;
          const [x, y] = at(s, e * side);
          if (k === i) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let k = Math.min(j, n); k >= i; k--) {
          const s = k % n;
          const kc = c.curvature[s];
          const inside = (kc > 0 && side === -1) || (kc < 0 && side === 1);
          const e = side === 1 ? left[s] : right[s];
          const o = inside ? Math.max(e, Math.min(outer, 0.9 / Math.max(1e-6, Math.abs(kc)))) : outer;
          const [x, y] = at(s, o * side);
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
      i = j;
    }
  }
}

/** Map colours and short labels of placed things. */
const PLACED_LOOK: Record<PlacedKind, { fill: string; edge: string; icon: string }> = {
  grandstand: { fill: '#2f6fd8', edge: '#1b3a8a', icon: '🏟' },
  garages: { fill: '#e9ebef', edge: '#5b6067', icon: '🔧' },
  tower: { fill: '#45627f', edge: '#1d2b3a', icon: '🗼' },
  building: { fill: '#9aa0a8', edge: '#4b5058', icon: '🏢' },
  trees: { fill: '#3e7d48', edge: '#24502b', icon: '🌲' },
  billboard: { fill: '#f2b705', edge: '#8a6a00', icon: '▭' },
  brakeboards: { fill: '#ffffff', edge: '#1d1f23', icon: '3·2·1' },
  bump: { fill: '#f2c200', edge: '#7a6200', icon: '' },
};

/** Scenery placed by hand and bump kerbs, as outlines on the map; ones the road now runs over are shown struck out. */
export function drawPlaced(ctx: CanvasRenderingContext2D, v: View, track: Track, list: readonly Placed[]): void {
  const ok = new Set(placedOn(track).map((q) => `${q.kind}@${q.x},${q.y}`));
  for (const p of list) {
    const s = PLACED_SPEC[p.kind];
    const look = PLACED_LOOK[p.kind];
    const good = ok.has(`${p.kind}@${p.x},${p.y}`);
    ctx.save();
    ctx.translate(v.ox + p.x * v.scale, v.oy + p.y * v.scale);
    ctx.rotate(p.rot);
    const w = Math.max(3, s.w * v.scale);
    const d = Math.max(p.kind === 'bump' ? 2 : 3, s.d * v.scale);
    ctx.globalAlpha = good ? 1 : 0.45;
    ctx.fillStyle = look.fill;
    ctx.strokeStyle = good ? look.edge : PAPER.error;
    ctx.lineWidth = 1.5;
    if (p.kind === 'trees') {
      ctx.beginPath();
      ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
      // The front (the side facing the road).
      if (p.kind !== 'bump' && d > 4) {
        ctx.fillStyle = look.edge;
        ctx.fillRect(-w / 2, d / 2 - Math.max(1.5, d * 0.15), w, Math.max(1.5, d * 0.15));
      }
    }
    if (!good) {
      ctx.strokeStyle = PAPER.error;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -d / 2);
      ctx.lineTo(w / 2, d / 2);
      ctx.stroke();
    }
    ctx.restore();
    if (look.icon && v.scale * s.w > 26) {
      ctx.font = `${Math.round(Math.min(18, 6 + v.scale * 2.2))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1b1d22';
      ctx.fillText(look.icon, v.ox + p.x * v.scale, v.oy + p.y * v.scale - (s.d * v.scale) / 2 - 9);
    }
  }
  ctx.globalAlpha = 1;
}

/** Road ribbon with edge lines, kerbs, direction arrows and the start/finish line; bridges on top. */
export function drawTrack(ctx: CanvasRenderingContext2D, v: View, track: Track, style?: Partial<RoadStyle>): void {
  const surface = track.options.road;
  const asphalt = surface === 'dirt' ? PAPER.dirt : surface === 'snow' ? PAPER.snow : PAPER.asphalt;
  const s: RoadStyle = { asphalt, edge: surface === 'snow' ? '#9aa6b4' : PAPER.edge, arrows: true, heights: false, walls: false, ...style };
  const c = track.center;
  const n = c.points.length;
  const w = c.width * v.scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawPits(ctx, v, track);
  drawRunoff(ctx, v, track);
  if (s.walls) drawWallLines(ctx, v, track);
  // Kerbs first, so the road covers their inner half.
  if (track.options.kerbs !== 'none') drawKerbs(ctx, v, track);
  paintRoad(ctx, v, track, s, 0, n);
  if (s.arrows) drawArrows(ctx, v, track);
  drawStartLine(ctx, v, c.points[0], c.tangents[0], c.width);

  // Bridges: a soft shadow, then the upper road again over the one below.
  ctx.lineCap = 'butt';
  for (const o of overpasses(track)) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = w * 1.45;
    strokeRun(ctx, v, c.points, o.from, o.count);
    paintRoad(ctx, v, track, s, o.from, o.count);
    // Rails.
    ctx.strokeStyle = '#d9dce2';
    ctx.lineWidth = Math.max(1, 0.6 * v.scale);
    for (const side of [1, -1]) {
      ctx.beginPath();
      for (let k = 0; k <= o.count; k++) {
        const i = wrap(o.from + k, n);
        const l = leftOf(c.tangents[i]);
        const off = (c.width / 2 + 1.2) * side;
        const x = v.ox + (c.points[i].x + l.x * off) * v.scale;
        const y = v.oy + (c.points[i].y + l.y * off) * v.scale;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.lineCap = 'round';
}

function drawKerbs(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const c = track.center;
  const n = c.points.length;
  const layout = kerbLayout(track);
  ctx.lineWidth = Math.max(2, TRACK.kerbWidth * 1.6 * v.scale);
  ctx.lineCap = 'butt';
  const stripe = 2; // samples per stripe (~5 m)
  for (const k of layout.runs) {
    const side = k.side;
    for (let j = 0; j < k.count; j += stripe) {
      ctx.strokeStyle = (j / stripe) % 2 === 0 ? PAPER.kerbRed : PAPER.kerbWhite;
      ctx.beginPath();
      for (let m = 0; m <= stripe && j + m <= k.count; m++) {
        const i = (((k.from + j + m) % n) + n) % n;
        const e = kerbAt(layout, i, side);
        const off = e ? e[0] + (e[1] - e[0]) * 0.4 : c.width / 2;
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
  const size = Math.max(3, c.width * 0.22 * v.scale);
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
export function drawStartLine(ctx: CanvasRenderingContext2D, v: View, p: Vec2, t: Vec2, width: number = TRACK.roadWidth): void {
  const l = leftOf(t);
  const cols = 6;
  const rows = 2;
  const half = width / 2;
  const depth = 1.6; // metres per row
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      ctx.fillStyle = (r + k) % 2 === 0 ? '#111' : '#fff';
      const a = -half + (k / cols) * width;
      const b = -half + ((k + 1) / cols) * width;
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

/** The pen's string while drawing: from the ink tip to the pointer. */
export function drawPenString(ctx: CanvasRenderingContext2D, v: View, tip: Vec2, pointer: Vec2): void {
  const a = toScreen(v, tip);
  const b = toScreen(v, pointer);
  ctx.strokeStyle = 'rgba(27, 58, 138, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
  ctx.strokeStyle = PAPER.ink;
  ctx.stroke();
}

/** Red wash over the stretch of road a section redraw is about to replace. */
export function drawReplaced(ctx: CanvasRenderingContext2D, v: View, track: Track, from: number, to: number): void {
  const c = track.center;
  const n = c.points.length;
  const count = wrap(to - from, n);
  if (count < 1) return;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(214, 58, 58, 0.35)';
  ctx.lineWidth = c.width * v.scale * 1.3;
  strokeRun(ctx, v, c.points, from, count);
}

/** A ring marking a spot on the road (where a section redraw will join, the profile cursor). */
export function drawMarker(ctx: CanvasRenderingContext2D, v: View, p: Vec2, color: string = PAPER.close): void {
  const s = toScreen(v, p);
  ctx.beginPath();
  ctx.arc(s.x, s.y, Math.max(7, (TRACK.roadWidth / 2) * v.scale + 3), 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** Small height tags ("12 m") beside the given dots. */
export function drawHeightTags(ctx: CanvasRenderingContext2D, v: View, dots: readonly Dot[], which: readonly number[]): void {
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const placed: { x: number; y: number; w: number }[] = [];
  for (const i of which) {
    const d = dots[i];
    if (!d) continue;
    const s = toScreen(v, d);
    const text = `${(d.h ?? 0).toFixed((d.h ?? 0) % 1 ? 1 : 0)} m`;
    const tw = ctx.measureText(text).width;
    const x = s.x + 9;
    const y = s.y - 12;
    // Skip tags that would sit on top of one already drawn (the first ones are the important ones).
    if (placed.some((p) => Math.abs(p.y - y) < 17 && x < p.x + p.w + 4 && p.x < x + tw + 10)) continue;
    placed.push({ x: x - 3, y, w: tw + 6 });
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(x - 3, y - 8, tw + 6, 16);
    ctx.strokeStyle = heightColor(d.h ?? 0);
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 3, y - 8, tw + 6, 16);
    ctx.fillStyle = '#1b1b1b';
    ctx.fillText(text, x, y);
  }
}

/** The pit lane and garages beside the start straight, with a "PIT" label. */
function drawPits(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const pits = pitLayout(track);
  if (!pits) return;
  const c = track.center;
  const at = (s: number, lat: number) => {
    const { p, t } = sampleAt(c, s);
    const l = leftOf(t);
    return toScreen(v, { x: p.x + l.x * lat * pits.side, y: p.y + l.y * lat * pits.side });
  };
  const band = (l0: number, l1: number, fill: string) => {
    ctx.beginPath();
    for (let s = pits.from; s <= pits.to + 0.01; s += 2.5) {
      const q = at(s, l0);
      if (s === pits.from) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    for (let s = pits.to; s >= pits.from - 0.01; s -= 2.5) {
      const q = at(s, l1);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  band(pits.lane[0], pits.lane[1], 'rgba(74, 79, 88, 0.85)');
  band(pits.building[0], pits.building[1], 'rgba(242, 183, 5, 0.85)');
  // Garages as dots along the front of the building.
  ctx.fillStyle = '#7a5a00';
  const r = Math.max(1.5, 1.4 * v.scale);
  for (const s of pits.doors) {
    const q = at(s, pits.building[0] + 2.5);
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const mid = at((pits.from + pits.to) / 2, pits.building[1] + 5 + 6 / v.scale);
  ctx.font = '800 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7a5a00';
  ctx.fillText('PIT', mid.x, mid.y);
  ctx.textAlign = 'left';
}

/** Numbered corner markers just outside each corner, with the bank angle underneath. */
export function drawCornerLabels(ctx: CanvasRenderingContext2D, v: View, track: Track): void {
  const c = track.center;
  const r = 10;
  ctx.font = '800 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  track.kerbs.forEach((k, idx) => {
    const i = k.apex;
    const l = leftOf(c.tangents[i]);
    const side = k.sign > 0 ? 1 : -1; // outside of a right-hander is on the left
    const off = c.width / 2 + TRACK.kerbWidth + (r + 8) / v.scale;
    const p = toScreen(v, { x: c.points[i].x + l.x * off * side, y: c.points[i].y + l.y * off * side });
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(27, 58, 138, 0.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = PAPER.close;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(idx + 1), p.x, p.y + 0.5);
    const bank = Math.round((Math.abs(c.bank[i]) * 180) / Math.PI);
    if (bank > 0) {
      ctx.fillStyle = PAPER.ink;
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.fillText(`${bank}°`, p.x, p.y + r + 7);
      ctx.font = '800 11px system-ui, sans-serif';
    }
  });
  ctx.textAlign = 'left';
}

/**
 * The preview car: a little top-down car in the player's paint at (x, y),
 * facing `heading`. Never smaller than a few pixels, so it shows zoomed out.
 */
export function drawCar(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, heading: number, color: string, alpha = 1): void {
  const s = toScreen(v, { x, y });
  const len = Math.max(17, 4.3 * v.scale);
  const wid = Math.max(8.5, 2 * v.scale);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(s.x, s.y);
  ctx.rotate(heading);
  // Shadow, body, cockpit, front wing.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  roundRect(ctx, -len / 2 + 1.5, -wid / 2 + 1.5, len, wid, wid * 0.35);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = Math.max(1, wid * 0.14);
  roundRect(ctx, -len / 2, -wid / 2, len, wid, wid * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(20, 30, 50, 0.85)';
  roundRect(ctx, -len * 0.08, -wid * 0.3, len * 0.26, wid * 0.6, wid * 0.2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(len * 0.36, -wid * 0.32, len * 0.08, wid * 0.64);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** One piece of confetti (screen px). */
export interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  life: number;
  color: string;
  w: number;
}

const CONFETTI_COLORS = ['#f2b705', '#d8342c', '#2f6fd6', '#2fa84f', '#e8559a', '#1b3a8a', '#ffffff'];

/** A burst of confetti from screen point (x, y). */
export function confettiBurst(x: number, y: number, count = 90, rand: () => number = Math.random): Confetto[] {
  return Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.3;
    const sp = 260 + rand() * 520;
    return {
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      a: rand() * Math.PI,
      va: (rand() - 0.5) * 16,
      life: 1.4 + rand() * 0.9,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)],
      w: 5 + rand() * 5,
    };
  });
}

/** Moves confetti on by `dt` (gravity, air) and drops the pieces that are done. */
export function stepConfetti(ps: Confetto[], dt: number): Confetto[] {
  const drag = Math.exp(-2.2 * dt);
  for (const p of ps) {
    p.vx *= drag;
    p.vy = p.vy * drag + 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.a += p.va * dt;
    p.life -= dt;
  }
  return ps.filter((p) => p.life > 0);
}

export function drawConfetti(ctx: CanvasRenderingContext2D, ps: readonly Confetto[]): void {
  for (const p of ps) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.scale(1, Math.abs(Math.cos(p.a * 1.7)) * 0.8 + 0.2);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
    ctx.restore();
  }
}
