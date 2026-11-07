/**
 * Builds the baked built-in track data (src/track/data/*.ts):
 *  - 20 generated tracks: random loops from fixed seeds, kept only if they
 *    make a valid, crossing-free road an AI can lap;
 *  - 30 real-world circuit layouts, from the open GeoJSON outlines in
 *    bacinger/f1-circuits (MIT licence, see THIRD_PARTY_NOTICES.md), scaled
 *    to fit the drawing area.
 *
 * Usage: node scripts/buildTracks.ts <path to a checkout of bacinger/f1-circuits>
 * The output is plain data; the game never runs this.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACK, type TrackOptions } from '../src/config/track.ts';
import { dist, type Dot, type Vec2 } from '../src/core/math.ts';
import { rng } from '../src/core/random.ts';
import { pathPositions, rollingHeights, softWeight, withHeights } from '../src/editor/heights.ts';
import { trackFromControl } from '../src/editor/pipeline.ts';
import { evenControl, quantizeControl, relaxTightCorners, simplifyLoop } from '../src/editor/smoothing.ts';
import { separate } from '../src/editor/repair.ts';
import { crossingsOf } from '../src/editor/validation.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { resampleClosed } from '../src/track/spline.ts';
import type { Track } from '../src/track/track.ts';

/** Longest a built-in may be (the catalog's compact layout target), and the box it must fit in (m, centred). */
const MAX_LENGTH = 2350;
const BOX = { w: 600, h: 330 };

interface Baked {
  id: string;
  name: string;
  place?: string;
  options: Partial<TrackOptions>;
  dots: Dot[];
}

// ---------------------------------------------------------------- shared helpers

/** Signed curvature of a closed dense loop at each point (1/m). */
function curvatures(p: readonly Vec2[]): number[] {
  const n = p.length;
  const k: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 2 + n) % n];
    const b = p[i];
    const c = p[(i + 2) % n];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const den = Math.hypot(ux, uy) * Math.hypot(vx, vy) * Math.hypot(c.x - a.x, c.y - a.y);
    k.push(den > 1e-9 ? (2 * (ux * vy - uy * vx)) / den : 0);
  }
  return k;
}

/** The same loop starting at index `i`. */
const rotate = <T>(p: readonly T[], i: number): T[] => [...p.slice(i), ...p.slice(0, i)];

/**
 * Puts the start on a straight: if the first real bend ahead of the start is
 * close, the start moves back up the straight it's on, so the line comes
 * about `lead` m before that bend (but never back past the previous bend).
 */
function startOnStraight(p: Vec2[], spacing: number, lead: number): Vec2[] {
  const n = p.length;
  const k = curvatures(p);
  const bend = (i: number) => Math.abs(k[((i % n) + n) % n]) > 1 / 45;
  // The bend the start runs into: the first one ahead (or, if the start is in a bend, that one).
  let at = 0;
  while (at < n && !bend(at)) at++;
  if (at * spacing >= lead * 0.8) return p;
  if (at === 0) while (at > -n && bend(at - 1)) at--;
  // The straight before it, and a start `lead` m before the bend on it (keeping 25 % of it behind).
  let run = 0;
  while (run < n && !bend(at - 1 - run)) run++;
  const back = Math.min(Math.round(lead / spacing), Math.round(run * 0.75));
  return rotate(p, (((at - back) % n) + n) % n);
}

/** Builds and checks a candidate: valid, an AI can lap it at medal pace and flat out. */
function check(def: Baked, allowCrossings: boolean): { ok: true; track: Track; lap: number } | { ok: false; why: string } {
  const res = trackFromControl({ id: def.id, name: def.name, control: def.dots, options: def.options, builtIn: true });
  if (!res.ok) return { ok: false, why: res.issue };
  const t = res.track;
  if (!allowCrossings && crossingsOf(t.center).length) return { ok: false, why: 'crossing' };
  const lap = new AuthorLap(t).finish();
  if (lap === null) return { ok: false, why: 'AI could not lap it' };
  if (new AuthorLap(t, 1).finish() === null) return { ok: false, why: 'fastest AI could not lap it' };
  return { ok: true, track: t, lap };
}

// ---------------------------------------------------------------- generated tracks

/** Convex hull (monotone chain), anticlockwise in maths axes. */
function hull(pts: Vec2[]): Vec2[] {
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

/**
 * A random circuit shape: the hull of a few random points, its edges bent in
 * and out at their middles (twice, the second time less), points too close
 * together pushed apart.
 */
function randomShape(rand: () => number): Vec2[] | null {
  const n = 6 + Math.floor(rand() * 8);
  const pts = Array.from({ length: n }, () => ({ x: (rand() * 2 - 1) * 270, y: (rand() * 2 - 1) * 140 }));
  let loop = hull(pts);
  if (loop.length < 4) return null;
  for (const amount of [0.32, 0.16]) {
    const out: Vec2[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a);
      const L = dist(a, b);
      if (L < 70) continue;
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
        if (d >= 50 || d < 1e-6) continue;
        const push = (50 - d) / 2 / d;
        const dx = (loop[j].x - loop[i].x) * push;
        const dy = (loop[j].y - loop[i].y) * push;
        loop[i] = { x: loop[i].x - dx, y: loop[i].y - dy };
        loop[j] = { x: loop[j].x + dx, y: loop[j].y + dy };
      }
    }
  }
  return loop;
}

/** Fits a loop into BOX (centred) and under MAX_LENGTH, scaling about its centre (never up by more than `maxUp`). */
function fit(p: readonly Vec2[], maxUp = 1): Vec2[] {
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  let L = 0;
  for (let i = 0; i < p.length; i++) L += dist(p[i], p[(i + 1) % p.length]);
  const s = Math.min(maxUp, BOX.w / w, BOX.h / h, MAX_LENGTH / L);
  return p.map((q) => ({ x: (q.x - cx) * s, y: (q.y - cy) * s }));
}

const CLASSIC_NAMES: Record<string, string[]> = {
  meadow: ['Willow Run', 'Fox Hollow', 'Bramble Park', 'Riverside Ribbon', 'Kestrel Heights', 'Meadowlark', 'Thornfield', 'Pinecrest', 'Harbour Hook', 'Granite Gate'],
  desert: ['Copper Canyon', 'Saltflat Speedway', 'Sunset Mesa', 'Dune Sprint', 'Cinder Valley', 'Mirage Mile', 'Red Rock Run', 'Scorpion Bend'],
  snow: ['Frostbite Ring', 'Glacier Pass', 'Aurora Loop', 'Pine Needle', 'Icefall Bends'],
};

function generated(count: number): Baked[] {
  const out: Baked[] = [];
  const used = new Set<string>();
  const themes: TrackOptions['theme'][] = ['meadow', 'desert', 'meadow', 'snow', 'meadow', 'desert'];
  for (let seed = 1; out.length < count && seed < 5000; seed++) {
    const rand = rng(seed * 7919);
    const shape = randomShape(rand);
    if (!shape) continue;
    // A smooth dense loop through it, sized to fit, the right way round, starting on its longest straight.
    let dense = evenControl(fit(shape, 1.25));
    if (rand() < 0.5) dense = [dense[0], ...dense.slice(1).reverse()];
    const k = curvatures(dense);
    let best = 0;
    let bestLen = 0;
    for (let i = 0; i < dense.length; i++) {
      if (Math.abs(k[i]) > 1 / 120 || Math.abs(k[(i - 1 + dense.length) % dense.length]) <= 1 / 120) continue;
      let j = 0;
      while (j < dense.length && Math.abs(k[(i + j) % dense.length]) <= 1 / 120) j++;
      if (j > bestLen) {
        bestLen = j;
        best = i;
      }
    }
    dense = rotate(dense, (best + Math.round(bestLen * 0.35)) % dense.length);
    let dots = quantizeControl(simplifyLoop(relaxTightCorners(dense, 10)));
    const theme = themes[out.length % themes.length];
    const options: Partial<TrackOptions> = {
      theme,
      width: [12, 12, 10, 14, 12, 15][Math.floor(rand() * 6)],
      banking: ([0, 1, 1, 2] as const)[Math.floor(rand() * 4)],
      time: rand() < 0.25 ? 'sunset' : 'day',
      runoff: theme === 'desert' ? 'gravel' : (['grass', 'grass', 'gravel', 'tarmac'] as const)[Math.floor(rand() * 4)],
      kerbs: rand() < 0.8 ? 'raised' : 'flat',
      barrier: rand() < 0.35 ? 'tyres' : 'concrete',
      trees: theme === 'desert' ? 'sparse' : (['normal', 'normal', 'dense', 'sparse'] as const)[Math.floor(rand() * 4)],
    };
    // Rolling hills on about half of them.
    if (rand() < 0.5) {
      const pos = pathPositions([...dots, dots[0]]);
      dots = withHeights(dots, rollingHeights(pos.slice(0, dots.length), pos[dots.length], rand, [4, 16]));
    }
    const names = CLASSIC_NAMES[theme].filter((n) => !used.has(n));
    if (!names.length) continue;
    const name = names[0];
    const def: Baked = { id: `classic-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, name, options, dots };
    const c = check(def, false);
    if (!c.ok) continue;
    const t = c.track;
    if (t.center.length < 1100 || t.kerbs.length < 5) continue;
    used.add(name);
    out.push(def);
    console.log(`  ${name.padEnd(18)} seed ${seed} ${t.center.length.toFixed(0)} m, ${t.kerbs.length} bends, ${def.dots.length} dots, gold ${c.lap.toFixed(2)} s ${theme}${def.dots.some((d) => d.h) ? ' hills' : ''}`);
  }
  if (out.length < count) throw new Error(`only ${out.length} generated tracks`);
  return out;
}

// ---------------------------------------------------------------- real circuits

interface Real {
  file: string;
  name: string;
  place: string;
  /** The outline runs the other way round from the race. */
  reverse?: boolean;
  options: Partial<TrackOptions>;
}

const day = { banking: 0, kerbs: 'raised', pits: true } as const;
const REAL: Real[] = [
  { file: 'bh-2002', name: 'Sakhir', place: 'Bahrain', options: { ...day, theme: 'desert', time: 'sunset', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'sa-2021', name: 'Jeddah', place: 'Saudi Arabia', options: { ...day, theme: 'desert', time: 'sunset', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'au-1953', name: 'Melbourne', place: 'Australia', options: { ...day, theme: 'meadow', runoff: 'gravel' } },
  { file: 'jp-1962', name: 'Suzuka', place: 'Japan', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense', barrier: 'tyres' } },
  { file: 'cn-2004', name: 'Shanghai', place: 'China', options: { ...day, theme: 'meadow', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'us-2022', name: 'Miami', place: 'United States', options: { ...day, theme: 'meadow', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'it-1953', name: 'Imola', place: 'Italy', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense' } },
  { file: 'mc-1929', name: 'Monaco', place: 'Monaco', options: { ...day, theme: 'meadow', runoff: 'tarmac', trees: 'sparse', width: 10 } },
  { file: 'ca-1978', name: 'Montréal', place: 'Canada', options: { ...day, theme: 'meadow', runoff: 'grass', trees: 'dense' } },
  { file: 'es-1991', name: 'Barcelona', place: 'Spain', options: { ...day, theme: 'desert', runoff: 'gravel', trees: 'sparse' } },
  { file: 'at-1969', name: 'Spielberg', place: 'Austria', options: { ...day, theme: 'meadow', runoff: 'tarmac', trees: 'dense' } },
  { file: 'gb-1948', name: 'Silverstone', place: 'United Kingdom', options: { ...day, theme: 'meadow', runoff: 'tarmac' } },
  { file: 'hu-1986', name: 'Budapest', place: 'Hungary', options: { ...day, theme: 'meadow', runoff: 'gravel' } },
  { file: 'be-1925', name: 'Spa-Francorchamps', place: 'Belgium', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense', barrier: 'tyres' } },
  { file: 'nl-1948', name: 'Zandvoort', place: 'Netherlands', options: { ...day, theme: 'desert', runoff: 'gravel', trees: 'sparse' } },
  { file: 'it-1922', name: 'Monza', place: 'Italy', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense' } },
  { file: 'az-2016', name: 'Baku', place: 'Azerbaijan', options: { ...day, theme: 'desert', runoff: 'tarmac', trees: 'sparse', width: 10 } },
  { file: 'sg-2008', name: 'Singapore', place: 'Singapore', reverse: true, options: { ...day, theme: 'meadow', time: 'sunset', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'us-2012', name: 'Austin', place: 'United States', options: { ...day, theme: 'meadow', runoff: 'tarmac' } },
  { file: 'mx-1962', name: 'Mexico City', place: 'Mexico', options: { ...day, theme: 'meadow', runoff: 'grass', trees: 'sparse' } },
  { file: 'br-1940', name: 'São Paulo', place: 'Brazil', options: { ...day, theme: 'meadow', runoff: 'grass' } },
  { file: 'us-2023', name: 'Las Vegas', place: 'United States', options: { ...day, theme: 'desert', time: 'sunset', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'qa-2004', name: 'Lusail', place: 'Qatar', options: { ...day, theme: 'desert', time: 'sunset', runoff: 'gravel', trees: 'sparse' } },
  { file: 'ae-2009', name: 'Yas Marina', place: 'Abu Dhabi', options: { ...day, theme: 'desert', time: 'sunset', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'pt-2008', name: 'Portimão', place: 'Portugal', options: { ...day, theme: 'desert', runoff: 'gravel', trees: 'sparse' } },
  { file: 'tr-2005', name: 'Istanbul', place: 'Turkey', options: { ...day, theme: 'meadow', runoff: 'tarmac', trees: 'sparse' } },
  { file: 'my-1999', name: 'Sepang', place: 'Malaysia', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense' } },
  { file: 'de-1932', name: 'Hockenheim', place: 'Germany', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense' } },
  { file: 'de-1927', name: 'Nürburg', place: 'Germany', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense', barrier: 'tyres' } },
  { file: 'it-1914', name: 'Mugello', place: 'Italy', options: { ...day, theme: 'meadow', runoff: 'gravel', trees: 'dense' } },
];

/** The outline in metres: x east, y south (the editor's axes), centred, closed (no repeated last point). */
function outline(dir: string, file: string): Vec2[] {
  const data = JSON.parse(readFileSync(join(dir, 'circuits', `${file}.geojson`), 'utf8'));
  const feat = data.features ? data.features[0] : data;
  const coords: [number, number][] = feat.geometry.type === 'MultiLineString' ? feat.geometry.coordinates[0] : feat.geometry.coordinates;
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lon0 = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const p = coords.map(([lon, lat]) => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * 110540 }));
  if (dist(p[0], p[p.length - 1]) < 1) p.pop();
  return p;
}

/** Turned so it fills the box best (a whole number of degrees), then fitted to the canvas. */
function bestTurn(p: readonly Vec2[]): Vec2[] {
  let best: Vec2[] = [];
  let bestScale = 0;
  for (let deg = 0; deg < 180; deg += 3) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const q = p.map((v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c }));
    const xs = q.map((v) => v.x);
    const ys = q.map((v) => v.y);
    const k = Math.min(BOX.w / (Math.max(...xs) - Math.min(...xs)), BOX.h / (Math.max(...ys) - Math.min(...ys)));
    if (k > bestScale) {
      bestScale = k;
      best = q;
    }
  }
  return fit(best);
}

/**
 * Where a road crosses over another (a figure of eight): the later of the two
 * roads rises over the earlier one on a smooth hump.
 */
function bridgeOver(dots: Dot[], t: Track, rise: number, half: number): Dot[] {
  const xs = crossingsOf(t.center);
  if (!xs.length) return dots;
  const c = t.center;
  const pos = pathPositions([...dots, dots[0]]);
  const L = pos[dots.length];
  return dots.map((d, i) => {
    let h = 0;
    for (const x of xs) {
      const at = Math.max(x.i, x.j) * c.spacing * (L / c.length);
      const r = Math.min(Math.abs(pos[i] - at), L - Math.abs(pos[i] - at));
      h = Math.max(h, rise * softWeight(r, half));
    }
    return h > 0.25 ? { ...d, h: Math.round(h * 2) / 2 } : d;
  });
}

function real(dir: string): Baked[] {
  const out: Baked[] = [];
  for (const r of REAL) {
    let p = outline(dir, r.file);
    if (r.reverse) p = [p[0], ...p.slice(1).reverse()];
    p = bestTurn(p);
    const { points } = resampleClosed(p, 2.5);
    const base = startOnStraight(points, 2.5, 60);
    let done: { def: Baked; lap: number; t: Track } | null = null;
    const tried: string[] = [];
    // As sharp as the road allows; narrower where the real road comes back close by, and
    // only then pushed apart a little where even that isn't enough.
    const attempts: { width: number; push: boolean }[] = [];
    for (const width of [r.options.width ?? 12, 10, 9, 8]) attempts.push({ width, push: false });
    for (const width of [10, 9, 8]) attempts.push({ width, push: true });
    for (const { width, push } of attempts) {
      const pushed = push ? separate(base, width + TRACK.separationMargin + 0.75) : base;
      if (!pushed) {
        tried.push(`w${width} pushed: moved too far`);
        continue;
      }
      const dense = resampleClosed(pushed, TRACK.controlSpacing).points;
      for (const radius of [6, 10]) {
        // (Simplifying to dots can tighten a hairpin a little again: open those up on the dots.)
        let dots = quantizeControl(relaxTightCorners(quantizeControl(simplifyLoop(relaxTightCorners(dense, radius, 200))), 5.5, 200));
        const def: Baked = { id: `world-${r.file}`, name: r.name, place: r.place, options: { ...r.options, width }, dots };
        const first = trackFromControl({ id: def.id, name: def.name, control: dots, options: def.options, builtIn: true });
        if (first.track && crossingsOf(first.track.center).length) {
          dots = bridgeOver(dots, first.track, 7.5, 50);
          def.dots = dots;
        }
        const c = check(def, true);
        if (c.ok) {
          done = { def, lap: c.lap, t: c.track };
          break;
        }
        tried.push(`r${radius}/w${width}${push ? ' pushed' : ''}: ${c.why}`);
      }
      if (done) break;
    }
    if (!done) throw new Error(`${r.name}: ${tried.join(', ')}`);
    out.push(done.def);
    const bridges = crossingsOf(done.t.center).length;
    console.log(`  ${r.name.padEnd(18)} ${done.t.center.length.toFixed(0)} m, width ${done.def.options.width}, ${done.def.dots.length} dots, gold ${done.lap.toFixed(2)} s${bridges ? `, ${bridges} bridge` : ''}${tried.length ? ` (after ${tried.join('; ')})` : ''}`);
  }
  return out;
}

// ---------------------------------------------------------------- output

const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function write(file: string, exportName: string, header: string, tracks: Baked[]): void {
  const body = tracks
    .map((t) => {
      const pts = t.dots.flatMap((d) => [d.x, d.y]).map(fmtNum).join(',');
      const hs = t.dots.some((d) => d.h) ? `\n    hs: [${t.dots.map((d) => fmtNum(d.h ?? 0)).join(',')}],` : '';
      const place = t.place ? `\n    place: ${JSON.stringify(t.place)},` : '';
      return `  {\n    id: ${JSON.stringify(t.id)},\n    name: ${JSON.stringify(t.name)},${place}\n    options: ${JSON.stringify(t.options)},\n    pts: [${pts}],${hs}\n  },`;
    })
    .join('\n');
  const src = `${header}\nimport type { BakedTrack } from '../catalog.ts';\n\nexport const ${exportName}: BakedTrack[] = [\n${body}\n];\n`;
  writeFileSync(file, src);
}

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/buildTracks.ts <path to bacinger/f1-circuits>');
console.log('Generated tracks:');
const classic = generated(20);
write(
  'src/track/data/classic.ts',
  'CLASSIC_TRACKS',
  '/** Generated by scripts/buildTracks.ts (random loops from fixed seeds). Do not edit by hand. */',
  classic,
);
console.log('Real-world circuits:');
const world = real(dir);
write(
  'src/track/data/world.ts',
  'WORLD_TRACKS',
  [
    '/**',
    ' * Generated by scripts/buildTracks.ts. Do not edit by hand.',
    ' *',
    ' * Real-world circuit layouts, scaled down to fit the game, made from the',
    ' * GeoJSON outlines in https://github.com/bacinger/f1-circuits',
    ' * (Copyright (c) 2019-2025 Tomislav Bacinger, MIT licence: see',
    ' * THIRD_PARTY_NOTICES.md). Unofficial: not associated with or endorsed by',
    ' * any circuit, series or rights holder.',
    ' */',
  ].join('\n'),
  world,
);
