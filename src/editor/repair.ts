import { TRACK, WORLD, type TrackOptions } from '../config/track.ts';
import { dist, type Dot, type Vec2 } from '../core/math.ts';
import { resampleClosed, sampleClosedCatmullRom } from '../track/spline.ts';
import { clampHeight, loopDist, pathPositions, smoothHeights, softWeight } from './heights.ts';
import { trackFromControl } from './pipeline.ts';
import { quantizeControl, relaxTightCorners, simplifyLoop } from './smoothing.ts';
import { crossingKind, crossingsOf, type TrackIssue } from './validation.ts';

/** Where a polyline loop crosses itself (to leave alone when pushing roads apart). */
export function selfCrossings(p: readonly Vec2[]): Vec2[] {
  const n = p.length;
  const out: Vec2[] = [];
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = p[j];
      const d = p[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
  return out;
}

/**
 * Pairs of points on unrelated stretches of road closer than `minSep`, the way
 * the track's validation sees it: from each point, the road either side of it
 * until it first gets `minSep` away is its own; anything else that close is a
 * different part of the track coming back. Crossings are left out.
 */
export function tooClose(p: readonly Vec2[], minSep: number, skip: (v: Vec2) => boolean): [number, number, number][] {
  const n = p.length;
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let fwd = 1;
    while (fwd < n && dist(p[i], p[(i + fwd) % n]) < minSep) fwd++;
    let back = 1;
    while (back < n && dist(p[i], p[(i - back + n) % n]) < minSep) back++;
    for (let k = fwd; k <= n - back; k++) {
      const j = (i + k) % n;
      if (j <= i) continue;
      const d = dist(p[i], p[j]);
      if (d < minSep && !(skip(p[i]) && skip(p[j]))) out.push([i, j, d]);
    }
  }
  return out;
}

/**
 * Pushes apart stretches of road that come back too close to each other, only
 * where they really are too close, a little at a time and smoothing the push
 * along the road, so the layout keeps its shape. Crossings (a figure of
 * eight) are left alone. Null if it can't be done without moving the road
 * more than `maxMove` metres anywhere. (Also used by scripts/buildTracks.ts.)
 */
export function separate(p0: readonly Vec2[], minSep: number, maxMove = 12): Vec2[] | null {
  const spacing = 3;
  let p = resampleClosed(p0, spacing).points as Vec2[];
  const start = p.map((v) => ({ ...v }));
  const xs = selfCrossings(p);
  const skip = (v: Vec2) => xs.some((x) => dist(x, v) < minSep * 3);
  for (let it = 0; it < 300; it++) {
    const pairs = tooClose(p, minSep, skip);
    if (!pairs.length) {
      // How far the road moved, at most (m): a little is fine, a lot isn't the same track any more.
      let moved = 0;
      const q = resampleClosed(p, spacing).points;
      for (let i = 0; i < Math.min(q.length, start.length); i += 4) moved = Math.max(moved, Math.min(...start.map((v) => dist(v, q[i]))));
      return moved < maxMove ? p : null;
    }
    const n = p.length;
    const disp = p.map(() => ({ x: 0, y: 0 }));
    for (const [i, j, d] of pairs) {
      const push = ((minSep - d) / 2) * 0.35;
      const ux = (p[j].x - p[i].x) / Math.max(d, 1e-6);
      const uy = (p[j].y - p[i].y) / Math.max(d, 1e-6);
      disp[i].x -= ux * push;
      disp[i].y -= uy * push;
      disp[j].x += ux * push;
      disp[j].y += uy * push;
    }
    const sm = disp.map((_, i) => {
      let x = 0;
      let y = 0;
      let w = 0;
      for (let k = -5; k <= 5; k++) {
        const q = disp[(i + k + n) % n];
        const wk = 1 - Math.abs(k) / 6;
        x += q.x * wk;
        y += q.y * wk;
        w += wk;
      }
      return { x: (x / w) * 1.8, y: (y / w) * 1.8 };
    });
    p = resampleClosed(
      p.map((v, i) => ({ x: v.x + sm[i].x, y: v.y + sm[i].y })),
      spacing,
    ).points as Vec2[];
  }
  return null;
}

/** What "Fix it" did (one or more). `closed`: the editor joined up the ends of a line that didn't close. */
export type Fix = 'closed' | 'corners' | 'spread' | 'narrowed' | 'grown' | 'bridged' | 'slopes';

/** Scales a loop of dots about its middle (keeping heights), then keeps it on the paper. */
export function scaleDots(dots: readonly Dot[], f: number): Dot[] {
  const xs = dots.map((d) => d.x);
  const ys = dots.map((d) => d.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let out = dots.map((d) => ({ ...d, x: cx + (d.x - cx) * f, y: cy + (d.y - cy) * f }));
  const W = WORLD.width / 2 - 12;
  const H = WORLD.height / 2 - 12;
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

/** Pushes apart roads that come too close, on the dense loop (heights carried along), back to dots. */
function spreadRoads(dots: readonly Dot[], minSep: number): Dot[] | null {
  const dense = sampleClosedCatmullRom(dots, 3);
  const moved = separate(dense, minSep, 30);
  if (!moved) return null;
  const n = moved.length;
  const m = dense.length;
  return quantizeControl(simplifyLoop(moved.map((p, i) => ({ x: p.x, y: p.y, h: dense[Math.min(m - 1, Math.round((i / n) * m))].h ?? 0 }))));
}

/**
 * Lifts the later of two crossing roads over the earlier one (a bridge, 7.5 m
 * clear), or drops it under if the earlier is already high. Only crossings
 * that aren't fine as they are: too shallow or too near the start line for a
 * level crossing, or at an awkward height in between.
 */
function bridgeCrossings(dots: readonly Dot[], issue: TrackIssue | null, options: TrackOptions, every = false): Dot[] {
  const res = trackFromControl({ id: 'repair', name: '', control: [...dots], options });
  const c = res.track?.center;
  if (!c) return [...dots];
  const pos = pathPositions([...dots, dots[0]]);
  const L = pos[dots.length];
  const scale = L / c.length;
  const out = dots.map((d) => d.h ?? 0);
  for (const x of crossingsOf(c)) {
    const kind = crossingKind(x.dh);
    const bad = kind === 'bad' || (kind === 'flat' && (every || x.angle < TRACK.minCrossingAngle || issue === 'crossing-start'));
    if (!bad) continue;
    const early = Math.min(x.i, x.j);
    const late = Math.max(x.i, x.j);
    const hEarly = c.height[early];
    const hLate = c.height[late];
    const up = hEarly + 7.5;
    const want = up <= TRACK.maxHeight ? up : Math.max(0, hEarly - 7.5);
    const delta = want - hLate;
    const at = late * c.spacing * scale;
    for (let i = 0; i < dots.length; i++) out[i] += delta * softWeight(loopDist(pos[i], at, L), 55);
  }
  return dots.map((d, i) => {
    const h = clampHeight(out[i]);
    const r: Dot = h ? { ...d, h } : { x: d.x, y: d.y };
    if (d.b !== undefined) r.b = d.b;
    return r;
  });
}

/**
 * Every level crossing becomes a road over a road (a bridge, or a tunnel for
 * the road underneath): the later road is lifted 7.5 m over the earlier one,
 * as Fix it does. Null if there's no level crossing to lift.
 */
export function liftCrossings(dots: readonly Dot[], options: TrackOptions): Dot[] | null {
  const flat = (d: readonly Dot[]) => {
    const c = trackFromControl({ id: 'lift', name: '', control: [...d], options }).track?.center;
    return c ? crossingsOf(c).filter((x) => crossingKind(x.dh) === 'flat').length : 0;
  };
  if (!flat(dots)) return null;
  let d = [...dots];
  for (let round = 0; round < 3 && flat(d); round++) d = bridgeCrossings(d, null, options, true);
  return d;
}

/**
 * "Fix it": makes a closed loop of dots that isn't a valid track into one,
 * changing as little as it can. Repeatedly looks at what's wrong and mends
 * that: opens up corners too tight to drive, pushes apart roads that come too
 * close (or, if that would move them too far, narrows the road), grows a track
 * too short, turns a crossing that can't be level into a bridge, and eases
 * slopes too steep. Null if it can't (or the track was fine).
 */
export function repairTrack(dots: readonly Dot[], options: TrackOptions): { dots: Dot[]; options: TrackOptions; fixes: Fix[] } | null {
  let d = dots.map((p) => ({ ...p }));
  let o = { ...options };
  const fixes = new Set<Fix>();
  for (let round = 0; round < 10; round++) {
    const res = trackFromControl({ id: 'repair', name: '', control: d, options: o });
    if (res.ok) return fixes.size ? { dots: d, options: o, fixes: [...fixes] } : null;
    const len = res.track?.center.length ?? 0;
    switch (res.issue) {
      case 'too-short':
        d = scaleDots(d, (TRACK.minLength * 1.15) / Math.max(1, len));
        fixes.add('grown');
        break;
      case 'too-tight': {
        const before = JSON.stringify(d);
        d = quantizeControl(relaxTightCorners(d, TRACK.minRadius + 1.5, 200));
        // Too few dots there to round it off: more dots, then again.
        if (JSON.stringify(d) === before) d = quantizeControl(simplifyLoop(relaxTightCorners(sampleClosedCatmullRom(d, 4), TRACK.minRadius + 1.5, 200)));
        fixes.add('corners');
        break;
      }
      case 'too-close': {
        const spread = spreadRoads(d, o.width + TRACK.separationMargin + 1);
        if (spread) {
          d = spread;
          fixes.add('spread');
        } else if (o.width > TRACK.minWidth) {
          o = { ...o, width: Math.max(TRACK.minWidth, o.width - 2) };
          fixes.add('narrowed');
        } else return null;
        break;
      }
      case 'shallow-crossing':
      case 'crossing-height':
      case 'crossing-start':
        d = bridgeCrossings(d, res.issue, o);
        fixes.add('bridged');
        break;
      case 'too-steep': {
        const pos = pathPositions([...d, d[0]]);
        const hs = smoothHeights(
          d.map((p) => p.h ?? 0),
          pos.slice(0, d.length),
          pos[d.length],
          true,
          3,
        );
        d = d.map((p, i) => ({ ...p, h: clampHeight(hs[i]) }));
        fixes.add('slopes');
        break;
      }
      default:
        return null;
    }
  }
  return null;
}
