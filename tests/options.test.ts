import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { WORLD, type TrackOptions } from '../src/config/track.ts';
import type { Dot } from '../src/core/math.ts';
import { getSampleTrack, trackFromControl } from '../src/editor/pipeline.ts';
import { transformDots } from '../src/editor/transform.ts';
import { validateCenterline } from '../src/editor/validation.ts';
import { locatorFor } from '../src/track/locator.ts';
import { buildKerbGeometry, buildRoadGeometry } from '../src/track/mesh.ts';
import { pitLayout } from '../src/track/pits.ts';
import { placeTrees } from '../src/track/placement.ts';
import { buildCenterline } from '../src/track/spline.ts';
import { trackStats } from '../src/track/stats.ts';
import { surfaceFor } from '../src/track/surface.ts';
import { buildTrack, contentId, type Track } from '../src/track/track.ts';
import { decodeTrack, encodeTrack } from '../src/track/code.ts';
import { TrackLibrary } from '../src/track/library.ts';

/** Stadium: two straights (±`half` m) joined by half circles of radius `gap`. */
function stadium(options: Partial<TrackOptions> = {}, gap = 300, half = 800): Track {
  const control: Dot[] = [];
  for (let x = -half; x <= half; x += 50) control.push({ x, y: -gap });
  for (let a = 1; a < 12; a++) control.push({ x: half + gap * Math.sin((a / 12) * Math.PI), y: -gap * Math.cos((a / 12) * Math.PI) });
  for (let x = half; x >= -half; x -= 50) control.push({ x, y: gap });
  for (let a = 1; a < 12; a++) control.push({ x: -half - gap * Math.sin((a / 12) * Math.PI), y: gap * Math.cos((a / 12) * Math.PI) });
  return buildTrack({ id: `stadium-${JSON.stringify(options)}-${gap}-${half}`, name: 'stadium', control, options });
}

const with_ = (t: Track, options: Partial<TrackOptions>) => buildTrack({ ...t.def, id: `${t.def.id}+${JSON.stringify(options)}`, options: { ...t.def.options, ...options } });

test('road width changes the road, the barrier line and how close stretches may be', () => {
  for (const width of [8, 10, 12, 13.5, 15, 20]) {
    const t = with_(getSampleTrack(0), { width });
    assert.equal(t.center.width, width);
    assert.ok(Math.abs(t.center.wallOffset - (width / 2 + 2.8)) < 1e-9);
    // Measure the road mesh across a straight sample.
    const pos = buildRoadGeometry(t.center, surfaceFor(t)).ground.getAttribute('position');
    let widest = 0;
    for (let r = 0; r < t.center.points.length; r++) widest = Math.max(widest, Math.hypot(pos.getX(r * 2) - pos.getX(r * 2 + 1), pos.getZ(r * 2) - pos.getZ(r * 2 + 1)));
    assert.ok(Math.abs(widest - width) < 0.05, `width ${width}: mesh ${widest}`);
  }
  // Two straights 14.5 m apart (centre to centre): fine for a narrow road, too close for a wide one.
  const hairpin: Dot[] = [];
  for (let x = -200; x <= 200; x += 25) hairpin.push({ x, y: 0 });
  for (let x = 200; x >= -200; x -= 25) hairpin.push({ x, y: 14.5 });
  const ok = validateCenterline(buildCenterline(hairpin, 0, undefined, 10));
  const bad = validateCenterline(buildCenterline(hairpin, 0, undefined, 15));
  assert.ok(!bad.ok && bad.issue === 'too-close', JSON.stringify(bad));
  assert.ok(ok.ok || ok.issue !== 'too-close', JSON.stringify(ok));
});

test('gravel run-off is slower than grass, tarmac run-off is as fast as the road', () => {
  const speedOn = (options: Partial<TrackOptions>, lateral: number) => {
    const t = stadium({ walls: false, ...options });
    const car = new CarPhysics(t);
    Object.assign(car.state, { x: -700, z: -300 - lateral, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
    for (let k = 0; k < HANDLING.tickRate * 3; k++) car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    return car.state.speed;
  };
  const road = speedOn({}, 0);
  const lat = 7.6; // in the run-off band: both wheels past the road edge (6.2 m), inside the barrier line
  const grass = speedOn({ runoff: 'grass' }, lat);
  const gravel = speedOn({ runoff: 'gravel' }, lat);
  const tarmac = speedOn({ runoff: 'tarmac' }, lat);
  assert.ok(gravel < grass - 1, `gravel ${gravel.toFixed(1)} vs grass ${grass.toFixed(1)}`);
  assert.ok(Math.abs(tarmac - road) < 0.5, `tarmac ${tarmac.toFixed(1)} vs road ${road.toFixed(1)}`);
  // Beyond the run-off band it's grass again, whatever the run-off.
  assert.ok(Math.abs(speedOn({ runoff: 'tarmac' }, 25) - speedOn({ runoff: 'grass' }, 25)) < 0.01);
});

test('kerb styles: raised and flat kerbs are drawn, none means no kerbs at all', () => {
  const base = getSampleTrack(2);
  const raised = buildKerbGeometry(with_(base, { kerbs: 'raised' }));
  const flat = buildKerbGeometry(with_(base, { kerbs: 'flat' }));
  assert.ok(raised && flat);
  const a = raised.getAttribute('position');
  const b = flat.getAttribute('position');
  assert.equal(a.count, b.count);
  let lower = 0;
  for (let i = 0; i < a.count; i++) {
    assert.ok(b.getY(i) <= a.getY(i) + 1e-6, 'a flat kerb is never higher');
    if (b.getY(i) < a.getY(i) - 0.05) lower++;
  }
  assert.ok(lower > a.count / 6, 'the crown is gone');
  const none = with_(base, { kerbs: 'none' });
  assert.equal(buildKerbGeometry(none), null);
  const loc = locatorFor(none);
  assert.ok(loc.kerbSide.every((k) => k === 0), 'no kerb counts as road');
});

test('pits sit beside the start straight, clear of the track, with no trees on them', () => {
  const t = stadium({}, 100, 180);
  const pits = pitLayout(t);
  assert.ok(pits, 'the stadium start straight has room');
  if (!pits) return;
  assert.ok(pits.doors.length >= 3 && pits.from < 0 && pits.to > 0);
  const c = t.center;
  for (const q of pits.footprint) {
    for (const p of c.points) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      // Only the start straight itself may be near.
      if (Math.abs(p.y - c.points[0].y) > 1) assert.ok(d > c.width / 2 + 8, `footprint ${d.toFixed(1)} m from the track`);
    }
  }
  for (const tree of placeTrees(t)) {
    for (const q of pits.footprint) assert.ok(Math.hypot(tree.x - q.x, tree.z - q.y) > 11, 'tree on the pits');
  }
  assert.equal(pitLayout(with_(t, { pits: false })), null);
  // A start on a tight corner has no room for pits.
  const circle = buildTrack({
    id: 'circle-pits',
    name: 'c',
    control: Array.from({ length: 24 }, (_, i) => ({ x: 60 * Math.cos((i / 24) * Math.PI * 2), y: 60 * Math.sin((i / 24) * Math.PI * 2) })),
  });
  assert.equal(pitLayout(circle), null);
});

test('scenery density: few, normal and lots of trees', () => {
  const base = getSampleTrack(0);
  const n = (trees: TrackOptions['trees']) => placeTrees(with_(base, { trees })).length;
  assert.ok(n('sparse') < n('normal') * 0.6 && n('dense') > n('normal') * 1.3, `${n('sparse')} ${n('normal')} ${n('dense')}`);
});

test('track stats: length, straights, gradient, elevation and tightest radius', () => {
  const s = trackStats(stadium({}, 300));
  assert.ok(Math.abs(s.longestStraight - 1600) < 120, `straight ${s.longestStraight}`);
  // The spline tightens a little where the straights meet the half circles.
  assert.ok(s.tightestRadius > 150 && s.tightestRadius <= 310, `radius ${s.tightestRadius}`);
  assert.equal(s.maxGradient, 0);
  assert.equal(s.elevation, 0);
  assert.equal(s.terrain, 'flat');
  const hilly = trackStats(
    buildTrack({ id: 'hilly-stats', name: 'h', control: getSampleTrack(1).def.control.map((d, i) => ({ ...d, h: i % 8 < 4 ? 16 : 0 })) }),
  );
  assert.equal(hilly.terrain, 'hilly');
  assert.ok(hilly.maxGradient > 0 && hilly.maxGradient <= 45.01);
});

test('rotate, mirror and resize keep the track on the paper and undo cleanly', () => {
  const dots = getSampleTrack(2).def.control;
  const inside = (ds: Dot[]) => ds.every((d) => Math.abs(d.x) <= WORLD.width / 2 && Math.abs(d.y) <= WORLD.height / 2);
  let r = dots.map((d) => ({ ...d }));
  for (let k = 0; k < 4; k++) {
    r = transformDots(r, 'rotate');
    assert.ok(inside(r));
  }
  const m2 = transformDots(transformDots(dots, 'mirror'), 'mirror');
  m2.forEach((d, i) => assert.ok(Math.abs(d.x - dots[i].x) <= 0.5 && Math.abs(d.y - dots[i].y) <= 0.5));
  // Heights come along.
  const hilly = dots.map((d, i) => ({ ...d, h: i % 3 ? 0 : 5 }));
  assert.deepEqual(
    transformDots(hilly, 'mirror').map((d) => d.h ?? 0),
    hilly.map((d) => (d.h ? d.h : 0)),
  );
  // Growing a big track never pushes it off the paper.
  let g = getSampleTrack(0).def.control.map((d) => ({ ...d }));
  for (let k = 0; k < 6; k++) g = transformDots(g, 'grow');
  assert.ok(inside(g));
  assert.ok(trackFromControl({ id: 'grown', name: 'g', control: g }).track);
});

test('any road width from 8 to 20 m, and per-corner banking, survive a track code; v3 codes still load', () => {
  const dots: Dot[] = [{ x: -100, y: -50, h: 4, b: 22 }, { x: 0, y: -80 }, { x: 100, y: -50, b: 0 }, { x: 120, y: 40 }, { x: 0, y: 70 }, { x: -120, y: 40 }];
  for (const width of [8, 9.5, 13.5, 20]) {
    const d = decodeTrack(encodeTrack('w', dots, { width }));
    assert.ok(d.ok);
    if (d.ok) {
      assert.equal(d.options.width, width);
      assert.deepEqual(d.dots, dots);
    }
  }
  // Written by the version with preset widths and no per-corner banking.
  const v3 = decodeTrack('IC1.AwdWMyBjb2Rl1YEEBjj_nP8IkAN3D5ADeABQ6AIA3wN4AN8DdwCz');
  assert.ok(v3.ok);
  if (v3.ok) {
    assert.equal(v3.options.width, 15);
    assert.equal(v3.options.kerbs, 'flat');
    assert.equal(v3.options.laps, 5);
    assert.equal(v3.options.theme, 'snow');
    assert.ok(v3.dots.every((d) => d.b === undefined));
  }
  // Bank overrides are part of a track's identity; none keeps the old id.
  const plain = dots.map(({ b: _b, ...d }) => d);
  assert.notEqual(contentId(dots), contentId(plain));
  assert.equal(contentId(plain), contentId(plain.map((d) => ({ ...d }))));
});

test('a corner can be banked on its own; other corners keep the track level', () => {
  const base = getSampleTrack(2);
  const t0 = with_(base, { banking: 1 });
  const k = t0.kerbs[0];
  const other = t0.kerbs[t0.kerbs.length - 1];
  const n = t0.center.points.length;
  // Give the first corner's dots a 30° override.
  const inCorner = (d: Dot) => {
    let best = 0;
    let bd = Infinity;
    t0.center.points.forEach((p, i) => {
      const dd = (p.x - d.x) ** 2 + (p.y - d.y) ** 2;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    return (best - (k.start - 4) + n) % n <= k.count + 8;
  };
  const control = base.def.control.map((d) => (inCorner(d) ? { ...d, b: 30 } : { ...d }));
  assert.ok(control.some((d) => d.b !== undefined), 'the corner has dots');
  const t1 = buildTrack({ ...base.def, id: 'bank-one', control, options: { banking: 1 } });
  const deg = (t: Track, i: number) => (Math.abs(t.center.bank[i]) * 180) / Math.PI;
  assert.ok(deg(t1, k.apex) > deg(t0, k.apex) + 8, `apex ${deg(t0, k.apex).toFixed(1)} -> ${deg(t1, k.apex).toFixed(1)}`);
  assert.ok(Math.abs(deg(t1, other.apex) - deg(t0, other.apex)) < 0.5, 'another corner is unchanged');
  // Banking 0 everywhere else, but this corner still banks.
  const off = buildTrack({ ...base.def, id: 'bank-one-off', control, options: { banking: 0 } });
  assert.ok(deg(off, k.apex) > 10 && deg(off, other.apex) < 0.01);
});

test('nothing is saved unless you save it; clear empties My tracks', () => {
  const lib = new TrackLibrary();
  lib.clear();
  assert.equal(lib.list().length, 0);
  const def = { ...getSampleTrack(0).def, id: 'mine', name: 'Mine', builtIn: undefined, control: getSampleTrack(0).def.control.map((d, i) => (i === 1 ? { ...d, x: d.x + 3 } : d)) };
  assert.equal(lib.has(contentId(def.control, def.options)), false);
  lib.save(def);
  assert.equal(lib.has(contentId(def.control, def.options)), true);
  lib.clear();
  assert.equal(lib.list().length, 0);
  assert.equal(lib.has(contentId(def.control, def.options)), false);
});

test('off track means the whole car past the edge; kerbs count as track', () => {
  const t = stadium({ walls: false });
  const place = (lateral: number) => {
    const car = new CarPhysics(t);
    Object.assign(car.state, { x: -700, z: -300 - lateral, heading: 0, vx: 10, vz: 0, trackIndex: -1 });
    car.step({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    return car.state.offTrack;
  };
  assert.equal(place(0), false);
  assert.equal(place(6.5), false, 'two wheels off is not off track');
  assert.equal(place(7.8), true, 'the whole car past the edge');
  assert.equal(place(-7.8), true);
});
