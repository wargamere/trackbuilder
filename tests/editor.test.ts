import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDLING } from '../src/config/handling.ts';
import { TRACK, WORLD } from '../src/config/track.ts';
import { dist, polylineLength, wrap, type Vec2 } from '../src/core/math.ts';
import { rng } from '../src/core/random.ts';
import { fitCrossings, loopDist, rollingHeights, smoothHeights, softWeights, withHeights } from '../src/editor/heights.ts';
import { LazyPen } from '../src/editor/pen.ts';
import { getSampleTrack, trackFromControl, trackFromStroke } from '../src/editor/pipeline.ts';
import { nearestSample, planSection, spliceSection } from '../src/editor/splice.ts';
import { crossingsOf } from '../src/editor/validation.ts';
import { Viewport } from '../src/editor/viewport.ts';
import { AuthorLap, medalFor, medalTimes, nextMedal } from '../src/race/medals.ts';
import { RecordBook } from '../src/race/records.ts';
import { leftOf } from '../src/track/spline.ts';
import type { Track } from '../src/track/track.ts';

/** Where each dot sits on the centre line (as the editor works it out). */
function dotSamples(t: Track): number[] {
  return t.def.control.map((d) => nearestSample(t.center, d).index);
}

/** A stroke that leaves the road at sample `i`, bulges `out` metres sideways and rejoins at `j`. */
function detour(t: Track, i: number, j: number, out: number): Vec2[] {
  const c = t.center;
  const n = c.points.length;
  const pts: Vec2[] = [];
  const count = wrap(j - i, n);
  for (let k = 0; k <= count; k++) {
    const s = wrap(i + k, n);
    const l = leftOf(c.tangents[s]);
    const bulge = Math.sin((k / count) * Math.PI) * out;
    pts.push({ x: c.points[s].x + l.x * bulge, y: c.points[s].y + l.y * bulge });
  }
  return pts;
}

test('redrawing a section replaces just that stretch and keeps the other dots exactly', () => {
  const t = getSampleTrack(0);
  const n = t.center.points.length;
  const i = Math.floor(n * 0.3);
  const j = i + 40;
  const stroke = detour(t, i, j, 30);
  const res = spliceSection(t, t.def.control, dotSamples(t), stroke, 'normal');
  assert.ok(res.ok);
  if (!res.ok) return;
  // Dots well away from the redrawn stretch are untouched.
  const samples = dotSamples(t);
  const far = t.def.control.filter((_, k) => {
    const s = samples[k];
    return wrap(s - i, n) > 40 + 20 && wrap(i - s, n) > 20;
  });
  for (const d of far) assert.ok(res.dots.some((e) => e.x === d.x && e.y === d.y), `dot ${d.x},${d.y} moved`);
  // The new road passes close to the top of the bulge, and the track is still valid.
  const built = trackFromControl({ id: 'spliced', name: 'spliced', control: res.dots });
  assert.ok(built.ok, !built.ok ? built.issue : '');
  const apex = stroke[Math.floor(stroke.length / 2)];
  assert.ok(nearestSample(built.track!.center, apex).d < 6, 'follows the new line');
  // The start line stayed where it was.
  assert.deepEqual(res.dots[0], t.def.control[0]);
});

test('drawing against the direction of travel redraws the same stretch', () => {
  const t = getSampleTrack(0);
  const n = t.center.points.length;
  const i = Math.floor(n * 0.3);
  const fwd = detour(t, i, i + 40, 30);
  const back = [...fwd].reverse();
  const a = planSection(t.center, fwd);
  const b = planSection(t.center, back);
  assert.ok(a && b && !a.reversed && b.reversed);
  assert.equal(a?.from, b?.from);
  assert.equal(a?.to, b?.to);
});

test('a "redraw" that goes all the way round is treated as a new track', () => {
  const t = getSampleTrack(0);
  const n = t.center.points.length;
  const stroke = detour(t, 5, n - 3, 4);
  const res = spliceSection(t, t.def.control, dotSamples(t), stroke, 'normal');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.whole, true);
});

test('soft editing moves neighbours along the track by a smoothly falling share', () => {
  const pos = [0, 10, 20, 40, 60, 90, 960, 990];
  const w = softWeights(pos, 0, 50, 1000, true);
  assert.equal(w[0], 1);
  assert.ok(w[1] > w[2] && w[2] > w[3] && w[3] > w[4]);
  assert.equal(w[5], 0);
  assert.ok(w[7] > w[6] && w[6] > 0, 'reaches back round the loop');
  const open = softWeights(pos, 0, 50, 1000, false);
  assert.equal(open[7], 0, 'an open path does not wrap');
});

test('random hills stay in range and gentle; smoothing evens them out', () => {
  const t = getSampleTrack(1);
  const L = t.center.length;
  const pos = dotSamples(t).map((s) => s * t.center.spacing);
  for (let seed = 1; seed <= 20; seed++) {
    const hs = rollingHeights(pos, L, rng(seed));
    assert.ok(hs.every((h) => h >= 0 && h <= TRACK.maxHeight));
    for (let k = 0; k < pos.length; k++) {
      const j = (k + 1) % pos.length;
      const d = loopDist(pos[k], pos[j], L);
      if (d > 5) assert.ok(Math.abs(hs[j] - hs[k]) / d < TRACK.maxGrade * 0.7, `seed ${seed}: steep between dots ${k} and ${j}`);
    }
    const res = trackFromControl({ id: `hills${seed}`, name: 'h', control: withHeights(t.def.control, hs) });
    assert.ok(res.ok, `seed ${seed}: ${!res.ok && res.issue}`);
  }
  const even = Array.from({ length: 50 }, (_, k) => k * 20);
  const spiky = even.map((_, k) => (k % 2 ? 10 : 0));
  const smooth = smoothHeights(spiky, even, 1000, true);
  const range = (a: number[]) => Math.max(...a) - Math.min(...a);
  assert.ok(range(smooth) < range(spiky) / 2);
});

test('crossings are nudged to be level or a proper bridge', () => {
  const curve = (f: (t: number) => Vec2) => Array.from({ length: 401 }, (_, i) => f(i / 400));
  const base = trackFromStroke(
    curve((u) => ({ x: Math.sin((u + 0.25) * Math.PI * 2) * 220, y: Math.sin((u + 0.25) * Math.PI * 4) * 120 })),
    'eight',
  );
  assert.ok(base.ok);
  if (!base.ok) return;
  const t = base.track;
  const L = t.center.length;
  const pos = dotSamples(t).map((s) => s * t.center.spacing);
  for (const gap of [2, 4.5]) {
    // One road `gap` metres above the other at the crossing: neither level nor a bridge.
    let hs = pos.map((s) => 2 + (gap * (1 - Math.cos((s / L - 0.25) * Math.PI * 2))) / 2);
    let res = trackFromControl({ id: 'x', name: 'x', control: withHeights(t.def.control, hs) });
    assert.equal(!res.ok && res.issue, 'crossing-height');
    for (let k = 0; k < 4 && !res.ok && res.track; k++) {
      hs = fitCrossings(hs, pos, L, t.center.spacing, crossingsOf(res.track.center));
      res = trackFromControl({ id: `x${k}`, name: 'x', control: withHeights(t.def.control, hs) });
    }
    assert.ok(res.ok, `gap ${gap}: ${!res.ok && res.issue}`);
  }
});

test('the lazy pen smooths out hand wobble but ends where the pointer did', () => {
  const pen = new LazyPen(1);
  const raw: Vec2[] = [];
  for (let k = 0; k <= 300; k++) raw.push({ x: k, y: Math.sin(k * 1.7) * 1.5 + Math.cos(k * 0.9) * 0.8 });
  const out: Vec2[] = [pen.start(raw[0], 4)];
  for (const p of raw.slice(1)) {
    const tip = pen.move(p);
    if (tip) out.push(tip);
  }
  const end = pen.finish();
  if (end) out.push(end);
  assert.deepEqual(out[out.length - 1], raw[raw.length - 1]);
  // The wobble (extra length over the straight distance) is mostly gone.
  const straight = dist(raw[0], raw[raw.length - 1]);
  assert.ok(polylineLength(out) - straight < (polylineLength(raw) - straight) * 0.25);
});

test('zooming keeps the point under the cursor in place, within limits', () => {
  const vp = new Viewport();
  vp.setScreen(1280, 720, 60, 60);
  const before = vp.toWorld(900, 300);
  vp.zoomAt(900, 300, 3);
  const after = vp.toWorld(900, 300);
  assert.ok(dist(before, after) < 1e-6);
  vp.zoomAt(900, 300, 100);
  assert.equal(vp.zoom, 8);
  vp.panBy(-1e6, -1e6);
  const c = vp.toWorld(640, 360);
  assert.ok(Math.abs(c.x) <= WORLD.width / 2 && Math.abs(c.y) <= WORLD.height / 2, 'cannot pan off the paper');
  vp.zoomAt(100, 100, 0.01);
  assert.equal(vp.zoom, 1);
  const fit = vp.toWorld(640, 360);
  assert.ok(Math.abs(fit.x) < 1e-6 && Math.abs(fit.y) < 1e-6, 'zoomed right out, the paper is centred again');
});

test('medal times come from the bot’s flying lap and are stable', () => {
  const t = getSampleTrack(2);
  const a = new AuthorLap(t).finish();
  const b = new AuthorLap(t).finish();
  assert.ok(a !== null && a > 10 && a < 120, `author ${a}`);
  assert.equal(a, b, 'deterministic');
  // Done in slices, the same answer.
  const sliced = new AuthorLap(t);
  while (!sliced.run(777));
  assert.equal(sliced.result, a);
  const m = medalTimes(a!);
  assert.ok(m.gold < m.silver && m.silver < m.bronze);
  assert.equal(medalFor(m.gold, m), 'gold');
  assert.equal(medalFor(m.gold + 0.01, m), 'silver');
  assert.equal(medalFor(m.bronze + 0.01, m), null);
  assert.equal(nextMedal(null), 'bronze');
  assert.equal(nextMedal('gold'), null);
  // It is measured once and kept with the track's records.
  const book = new RecordBook();
  book.get('medal-test').author = a;
  book.save('medal-test');
  assert.equal(new RecordBook().summary('medal-test').author, a);
  assert.ok(a! * HANDLING.tickRate > 100);
});
