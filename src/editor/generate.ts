import { DEFAULT_OPTIONS, type TrackOptions, WORLD } from '../config/track.ts';
import { dist, type Dot, type Vec2 } from '../core/math.ts';
import { rng } from '../core/random.ts';
import type { TrackDef } from '../track/track.ts';
import { pathPositions, rollingHeights, withHeights } from './heights.ts';
import { trackFromControl } from './pipeline.ts';
import { evenControl, quantizeControl, relaxTightCorners, simplifyLoop } from './smoothing.ts';
import { crossingsOf } from './validation.ts';

/** The kinds of track the editor can make up. */
export type GenStyle = 'gp' | 'flowing' | 'technical' | 'street' | 'oval' | 'kart';
export const GEN_STYLES: readonly GenStyle[] = ['gp', 'flowing', 'technical', 'street', 'oval', 'kart'];

/**
 * How each style is made: a box it fits in (m), its length range, how many
 * random points its outline starts from and how hard its edges are bent, how
 * tight its corners may stay (m), and its options.
 */
interface Recipe {
  box: { w: number; h: number };
  length: [number, number];
  points: [number, number];
  bends: readonly number[];
  minRadius: number;
  /** Points closer than this (m) are pushed apart. */
  spread: number;
  options: (rand: () => number) => Partial<TrackOptions>;
  /** Share of tracks that get rolling hills, and how big. */
  hills: number;
  hillRange: [number, number];
}

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

const RECIPES: Record<Exclude<GenStyle, 'street' | 'oval'>, Recipe> = {
  // A full circuit: long straights, a mix of fast and slow bends.
  gp: {
    box: { w: 600, h: 330 },
    length: [1500, 2350],
    points: [8, 12],
    bends: [0.32, 0.16],
    minRadius: 12,
    spread: 50,
    options: (r) => ({ width: pick(r, [12, 13, 14, 15]), kerbs: 'raised', runoff: pick(r, ['gravel', 'tarmac'] as const), pits: true, banking: pick(r, [0, 1] as const) }),
    hills: 0.4,
    hillRange: [4, 14],
  },
  // Few, long, sweeping bends: nothing tight.
  flowing: {
    box: { w: 620, h: 340 },
    length: [1300, 2200],
    points: [5, 8],
    bends: [0.22, 0.1],
    minRadius: 32,
    spread: 70,
    options: (r) => ({ width: pick(r, [13, 14, 15]), kerbs: 'raised', runoff: 'tarmac', banking: 1, pits: true }),
    hills: 0.6,
    hillRange: [6, 18],
  },
  // Lots of corners, some tight; shorter straights.
  technical: {
    box: { w: 520, h: 300 },
    length: [1100, 1900],
    points: [11, 15],
    bends: [0.42, 0.26],
    minRadius: 8,
    spread: 42,
    options: (r) => ({ width: pick(r, [10, 11, 12]), kerbs: 'raised', runoff: pick(r, ['gravel', 'grass'] as const), banking: 0, pits: true }),
    hills: 0.35,
    hillRange: [3, 10],
  },
  // A small, twisty kart track: narrow, tight hairpins.
  kart: {
    box: { w: 240, h: 150 },
    length: [550, 1000],
    points: [8, 12],
    bends: [0.4, 0.22],
    minRadius: 6,
    spread: 26,
    options: () => ({ width: 8, kerbs: 'flat', runoff: 'tarmac', banking: 0, pits: false, laps: 5, trees: 'sparse' }),
    hills: 0,
    hillRange: [0, 0],
  },
};

/** Convex hull (monotone chain). */
function hull(pts: readonly Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A random circuit outline: the hull of random points, its edges bent in and out, points too close pushed apart. */
function hullShape(r: Recipe, rand: () => number): Vec2[] | null {
  const n = r.points[0] + Math.floor(rand() * (r.points[1] - r.points[0] + 1));
  const pts = Array.from({ length: n }, () => ({ x: (rand() * 2 - 1) * r.box.w * 0.45, y: (rand() * 2 - 1) * r.box.h * 0.42 }));
  let loop = hull(pts);
  if (loop.length < 4) return null;
  for (const amount of r.bends) {
    const out: Vec2[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      const L = dist(a, b);
      if (L < r.spread * 1.4) continue;
      const nx = -(b.y - a.y) / L;
      const ny = (b.x - a.x) / L;
      const m = (rand() * 2 - 1) * L * amount;
      out.push({ x: (a.x + b.x) / 2 + nx * m, y: (a.y + b.y) / 2 + ny * m });
    }
    loop = out;
  }
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < loop.length; i++) {
      for (let j = i + 1; j < loop.length; j++) {
        const d = dist(loop[i], loop[j]);
        if (d >= r.spread || d < 1e-6) continue;
        const push = (r.spread - d) / 2 / d;
        const dx = (loop[j].x - loop[i].x) * push;
        const dy = (loop[j].y - loop[i].y) * push;
        loop[i] = { x: loop[i].x - dx, y: loop[i].y - dy };
        loop[j] = { x: loop[j].x + dx, y: loop[j].y + dy };
      }
    }
  }
  return loop;
}

/**
 * A street circuit: the outline of a random block of city squares (a
 * polyomino with no holes), so it's all straights and right-angle corners.
 */
function streetShape(rand: () => number): Vec2[] | null {
  const cols = 6;
  const rows = 4;
  const cell = 95;
  const on = new Set<number>();
  const key = (x: number, y: number) => y * cols + x;
  const start = key(Math.floor(rand() * cols), Math.floor(rand() * rows));
  on.add(start);
  const want = 6 + Math.floor(rand() * 7);
  for (let guard = 0; on.size < want && guard < 500; guard++) {
    const cells = [...on];
    const c = cells[Math.floor(rand() * cells.length)];
    const x = c % cols;
    const y = Math.floor(c / cols);
    const [dx, dy] = pick(rand, [[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    on.add(key(nx, ny));
  }
  // No holes: every empty cell must reach the outside.
  const outside = new Set<number>();
  const stack: [number, number][] = [];
  for (let x = -1; x <= cols; x++) for (const y of [-1, rows]) stack.push([x, y]);
  for (let y = 0; y < rows; y++) for (const x of [-1, cols]) stack.push([x, y]);
  const seen = new Set<string>();
  while (stack.length) {
    const [x, y] = stack.pop() as [number, number];
    const id = `${x},${y}`;
    if (seen.has(id) || x < -1 || y < -1 || x > cols || y > rows) continue;
    seen.add(id);
    const inside = x >= 0 && y >= 0 && x < cols && y < rows;
    if (inside && on.has(key(x, y))) continue;
    if (inside) outside.add(key(x, y));
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let k = 0; k < cols * rows; k++) if (!on.has(k) && !outside.has(k)) return null;
  // The boundary: directed edges with the block on their left, chained into one loop.
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && on.has(key(x, y));
  const next = new Map<string, string>();
  const add = (a: [number, number], b: [number, number]) => next.set(`${a[0]},${a[1]}`, `${b[0]},${b[1]}`);
  for (const c of on) {
    const x = c % cols;
    const y = Math.floor(c / cols);
    if (!filled(x, y - 1)) add([x, y], [x + 1, y]);
    if (!filled(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!filled(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!filled(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const first = next.keys().next().value as string;
  const loop: Vec2[] = [];
  let at = first;
  for (let guard = 0; guard < 1000; guard++) {
    const [x, y] = at.split(',').map(Number);
    loop.push({ x: x * cell, y: y * cell });
    const to = next.get(at);
    if (!to) return null;
    at = to;
    if (at === first) break;
  }
  if (loop.length !== next.size) return null; // (two touching blocks: not one loop)
  // Corners only (drop points along straight runs), then some kinks for a chicane or two.
  const corners = loop.filter((p, i) => {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[(i + 1) % loop.length];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
  return corners.length >= 4 ? corners : null;
}

/** An oval, or a tri-oval: two long straights and two big banked ends. */
function ovalShape(rand: () => number): Vec2[] {
  const half = 160 + rand() * 90;
  const r = 70 + rand() * 40;
  const tri = rand() < 0.5;
  const pts: Vec2[] = [];
  const ends = 9;
  for (let k = 0; k <= ends; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / ends;
    pts.push({ x: half + Math.cos(a) * r, y: Math.sin(a) * r });
  }
  for (let k = 0; k <= ends; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / ends;
    pts.push({ x: -half + Math.cos(a) * r, y: Math.sin(a) * r });
  }
  // The tri-oval's front straight bows out in the middle.
  if (tri) pts.splice(ends + 1, 0, { x: 0, y: r + 35 });
  return pts;
}

/**
 * A loop of straight edges with extra points `cut` m either side of each
 * corner and along the straights, so the smooth line through them keeps its
 * straights straight and turns in a short, tight corner.
 */
function squareUp(p: readonly Vec2[], cut: number, every = 40): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const L = dist(a, b);
    out.push(a);
    if (L < cut * 2.5) continue;
    const along = [cut];
    const inner = L - 2 * cut;
    const k = Math.max(0, Math.ceil(inner / every) - 1);
    for (let j = 1; j <= k; j++) along.push(cut + (inner * j) / (k + 1));
    along.push(L - cut);
    for (const d of along) out.push({ x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L });
  }
  return out;
}

/**
 * Scales a loop about its centre to fit `box` and `maxLength`, and up to at
 * least `minLength`, but never past the drawable area.
 */
function fit(p: readonly Vec2[], box: { w: number; h: number }, minLength: number, maxLength: number): Vec2[] {
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  let L = 0;
  for (let i = 0; i < p.length; i++) L += dist(p[i], p[(i + 1) % p.length]);
  const room = Math.min((WORLD.width - 40) / w, (WORLD.height - 40) / h);
  const s = Math.min(room, Math.max(minLength / L, Math.min(box.w / w, box.h / h, maxLength / L)));
  return p.map((q) => ({ x: (q.x - cx) * s, y: (q.y - cy) * s }));
}

/** The same loop starting at its longest straight, a little way along it (the start line). */
function startOnLongestStraight(dense: Dot[]): Dot[] {
  const n = dense.length;
  const k = dense.map((b, i) => {
    const a = dense[(i - 2 + n) % n];
    const c = dense[(i + 2) % n];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const den = Math.hypot(ux, uy) * Math.hypot(vx, vy) * Math.hypot(c.x - a.x, c.y - a.y);
    return den > 1e-9 ? Math.abs((2 * (ux * vy - uy * vx)) / den) : 0;
  });
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < n; i++) {
    if (k[i] > 1 / 120 || k[(i - 1 + n) % n] <= 1 / 120) continue;
    let j = 0;
    while (j < n && k[(i + j) % n] <= 1 / 120) j++;
    if (j > bestLen) {
      bestLen = j;
      best = i;
    }
  }
  const at = (best + Math.round(bestLen * 0.35)) % n;
  return [...dense.slice(at), ...dense.slice(0, at)];
}

/**
 * Makes up a track in `style` from `seed`: a random outline of that kind,
 * smoothed into dots, started on its longest straight, with options to suit
 * (and hills on some). Tries the following seeds until one builds a valid
 * track that doesn't cross itself; null if none of them does.
 */
export function generateTrack(style: GenStyle, seed: number, name: string): TrackDef | null {
  for (let attempt = 0; attempt < 60; attempt++) {
    const rand = rng((seed + attempt * 7919) >>> 0);
    let shape: Vec2[] | null;
    let minRadius: number;
    let options: Partial<TrackOptions>;
    let hills = 0;
    let hillRange: [number, number] = [0, 0];
    let length: [number, number];
    let box: { w: number; h: number };
    if (style === 'street') {
      shape = streetShape(rand);
      minRadius = 11;
      length = [1100, 2000];
      box = { w: 600, h: 340 };
      options = { width: pick(rand, [10, 11, 12]), kerbs: 'flat', runoff: 'tarmac', walls: true, barrier: 'concrete', banking: 0, pits: true, trees: 'sparse' };
    } else if (style === 'oval') {
      shape = ovalShape(rand);
      minRadius = 40;
      length = [1100, 1700];
      box = { w: 590, h: 320 };
      options = { width: 15, kerbs: 'flat', runoff: 'tarmac', banking: 2, pits: true, trees: 'sparse', laps: 5 };
    } else {
      const r = RECIPES[style];
      shape = hullShape(r, rand);
      minRadius = r.minRadius;
      length = r.length;
      box = r.box;
      options = r.options(rand);
      hills = r.hills;
      hillRange = r.hillRange;
    }
    if (!shape) continue;
    let outline = fit(shape, box, length[0], length[1]);
    if (style === 'street') outline = squareUp(outline, 14 + rand() * 8);
    let dense = evenControl(outline);
    if (rand() < 0.5) dense = [dense[0], ...dense.slice(1).reverse()];
    dense = startOnLongestStraight(dense);
    let dots = quantizeControl(simplifyLoop(relaxTightCorners(dense, minRadius)));
    if (hills > 0 && rand() < hills) {
      const pos = pathPositions([...dots, dots[0]]);
      dots = withHeights(dots, rollingHeights(pos.slice(0, dots.length), pos[dots.length], rand, hillRange));
    }
    const def: TrackDef = { id: 'editing', name, control: dots, options: { ...DEFAULT_OPTIONS, ...options } };
    const res = trackFromControl(def);
    if (!res.ok || crossingsOf(res.track.center).length) continue;
    const L = res.track.center.length;
    if (L < length[0] * 0.8 || L > length[1] * 1.15) continue;
    return def;
  }
  return null;
}
