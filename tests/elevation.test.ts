import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { DEFAULT_OPTIONS, OPTION_CHOICES, THEME_IDS, TRACK, type TrackOptions } from '../src/config/track.ts';
import { dist, type Dot, type Vec2 } from '../src/core/math.ts';
import { rng } from '../src/core/random.ts';
import { rollingHeights, withHeights } from '../src/editor/heights.ts';
import { getSampleTrack, SAMPLE_COUNT, trackFromControl, trackFromStroke } from '../src/editor/pipeline.ts';
import { crossingKind, findCrossings } from '../src/editor/validation.ts';
import { botInput } from '../src/race/bot.ts';
import { decodeTrack, encodeTrack } from '../src/track/code.ts';
import { buildKerbGeometry, buildRoadGeometry, SKIRT_DEPTH } from '../src/track/mesh.ts';
import { edgeOffsets, leftOf, surfaceY } from '../src/track/spline.ts';
import { forEachGroundProbe, type P3, surfaceFor, terrainHeight } from '../src/track/surface.ts';
import { buildTrack, contentId, type Track } from '../src/track/track.ts';

const curve = (n: number, f: (t: number) => Vec2): Vec2[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
/** Lissajous figure eight crossing itself at t = 0.25 and 0.75 (as drawn from phase 0.25). */
const figureEight = () => curve(400, (t) => ({ x: Math.sin((t + 0.25) * Math.PI * 2) * 220, y: Math.sin((t + 0.25) * Math.PI * 4) * 120 }));

/** Position of each dot along the track as a fraction of the lap. */
function dotFractions(t: Track): number[] {
  const c = t.center;
  return t.def.control.map((d) => {
    let best = 0;
    let bestD = Infinity;
    c.points.forEach((p, i) => {
      const dd = dist(p, d);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best / c.points.length;
  });
}

/** The figure eight with heights from `f(fraction of lap)`. */
function hillyEight(f: (u: number) => number) {
  const base = trackFromStroke(figureEight(), 'eight');
  assert.ok(base.ok);
  const t = base.track;
  const control = withHeights(
    t.def.control,
    dotFractions(t).map((u) => f(u)),
  );
  return trackFromControl({ id: 'eight-h', name: 'eight', control });
}

/** Height difference `a` between the two roads at the crossing (low at the start, high half a lap later). */
const rise = (a: number) => (u: number) => (a * (1 - Math.cos((u - 0.25) * Math.PI * 2))) / 2;

/** A track code written by version 4 of the format (desert, tyre barriers, flat kerbs, 13.5 m, a banked dot). */
const V4_CODE = 'IC1.BARGb3VyjREbAQY4_5z_BZADdyaQA3hwUOgCnwHfA3gC3wN3AQAAAAAJADM';

test('track codes keep heights and every option; old v1 and v2 codes still load', () => {
  const dots: Dot[] = [{ x: -100, y: -50, h: 2.5 }, { x: 0, y: -80, h: 12 }, { x: 100, y: -50, h: 40 }, { x: 120, y: 40 }, { x: 0, y: 70, h: 0.5 }, { x: -120, y: 40 }];
  const options: TrackOptions = {
    banking: 2,
    walls: false,
    theme: 'snow',
    width: 15,
    kerbs: 'flat',
    runoff: 'gravel',
    barrier: 'armco',
    barrierGap: 17,
    road: 'dirt',
    crossing: 'tunnel',
    pits: false,
    time: 'sunset',
    laps: 5,
    trees: 'dense',
  };
  const d = decodeTrack(encodeTrack('Hills', dots, options));
  assert.ok(d.ok);
  if (d.ok) {
    assert.deepEqual(d.dots, dots);
    assert.deepEqual(d.options, options);
  }
  // Every choice of every option survives on its own too.
  const every: [string, readonly unknown[]][] = [...Object.entries(OPTION_CHOICES), ['theme', THEME_IDS], ['barrierGap', [0, 1, 12, TRACK.maxBarrierGap]]];
  for (const [k, choices] of every) {
    for (const v of choices) {
      const e = decodeTrack(encodeTrack('o', dots, { [k]: v }));
      assert.ok(e.ok && (e.options as unknown as Record<string, unknown>)[k] === v, `${k}=${v}`);
    }
  }
  // ...and together with the newest bits set.
  const newest: TrackOptions = { ...options, theme: 'forest', barrier: 'tecpro', road: 'snow', kerbs: 'painted', barrierGap: TRACK.maxBarrierGap };
  const n = decodeTrack(encodeTrack('n', dots, newest));
  assert.ok(n.ok);
  if (n.ok) assert.deepEqual(n.options, newest);
  // Written by version 4 (before barrier distance, road surfaces and the newer landscapes).
  const v4 = decodeTrack(V4_CODE);
  assert.ok(v4.ok, 'a version 4 code still loads');
  if (v4.ok) {
    assert.equal(v4.name, 'Four');
    assert.deepEqual(v4.options, { ...DEFAULT_OPTIONS, theme: 'desert', barrier: 'tyres', kerbs: 'flat', width: 13.5 });
    assert.equal(v4.dots[4].b, 8);
  }
  // Written by the version with heights but only three options.
  const v2 = decodeTrack('IC1.AgdWMiBjb2RlCgY4_5z_CJADdw-QA3gqUOgCKd8DeADfA3cAeA');
  assert.ok(v2.ok);
  if (v2.ok) {
    assert.deepEqual(v2.options, { ...DEFAULT_OPTIONS, banking: 2, walls: false, theme: 'desert' });
    assert.deepEqual(v2.dots[0], { x: -100, y: -50, h: 4 });
    assert.deepEqual(v2.dots[2], { x: 100, y: -50, h: 10.5 });
  }
  // Written by the version before heights existed.
  const old = decodeTrack('IC1.AQhPbGQgY29kZQY4_5z_kAN3kAN4UOgC3wN43wN3_w');
  assert.ok(old.ok);
  if (old.ok) {
    assert.equal(old.name, 'Old code');
    assert.deepEqual(old.dots, [{ x: -100, y: -50 }, { x: 0, y: -80 }, { x: 100, y: -50 }, { x: 120, y: 40 }, { x: 0, y: 70 }, { x: -120, y: 40 }]);
    assert.deepEqual({ ...DEFAULT_OPTIONS, ...old.options }, DEFAULT_OPTIONS);
    assert.equal(contentId(old.dots, old.options), contentId(old.dots), 'old tracks keep their id (and records)');
  }
});

test('heights and options are part of a track’s identity, defaults are not', () => {
  const dots: Dot[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }];
  const id = contentId(dots);
  assert.equal(contentId(dots, { banking: 1, walls: true, theme: 'meadow' }), id);
  assert.notEqual(contentId(dots, { theme: 'desert' }), id);
  assert.notEqual(contentId([{ ...dots[0], h: 3 }, dots[1], dots[2]]), id);
});

test('roads crossing level, as a bridge, or neither', () => {
  const flat = hillyEight(() => 0);
  assert.ok(flat.ok);
  const bridge = hillyEight(rise(9));
  assert.ok(bridge.ok, !bridge.ok ? bridge.issue : '');
  if (bridge.ok) {
    const x = findCrossings(bridge.track.center);
    assert.equal(x.length, 1);
    assert.equal(crossingKind(x[0].dh), 'bridge');
  }
  const bad = hillyEight(rise(3));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.issue, 'crossing-height');
});

test('a climb steeper than the limit is eased out instead of rejected', () => {
  const base = getSampleTrack(0);
  const control = base.def.control.map((d, i) => (i === 5 ? { ...d, h: 30 } : { ...d }));
  const res = trackFromControl({ id: 'steep', name: 'steep', control });
  assert.ok(res.ok, !res.ok ? res.issue : '');
  const c = res.track!.center;
  const steepest = Math.max(...Array.from(c.grade, Math.abs));
  assert.ok(steepest <= TRACK.maxGrade + 1e-6, `grade ${steepest}`);
  assert.ok(c.eased > 1, 'the spike was eased');
  // Still a real hill where the dot is, just not a wall.
  const top = c.height[nearestIndex(c.points, control[5])];
  assert.ok(top > 12 && top < 30, `top ${top.toFixed(1)} m`);
  // A gentle profile is left exactly as drawn.
  const gentle = trackFromControl({ id: 'gentle', name: 'g', control: base.def.control.map((d, i) => ({ ...d, h: i % 10 === 0 ? 2 : 0 })) });
  assert.ok(gentle.ok);
  assert.equal(gentle.track!.center.eased, 0);
});

const nearestIndex = (pts: readonly Vec2[], p: Vec2): number => {
  let best = 0;
  let bestD = Infinity;
  pts.forEach((q, i) => {
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
};

test('the ground never pokes through the road, on any sample with random hills', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    for (const seed of [1, 2, 3]) {
      const base = getSampleTrack(si);
      const L = base.center.length;
      const hs = rollingHeights(
        dotFractions(base).map((u) => u * L),
        L,
        rng(seed * 100 + si),
      );
      const t = buildTrack({ id: `hills-${si}-${seed}`, name: 'h', control: withHeights(base.def.control, hs) });
      const surf = surfaceFor(t);
      const c = t.center;
      // The grid's border is flat, so it meets the flat ground around it without a seam.
      const tr = surf.terrain;
      for (let i = 0; i < tr.nx; i++) assert.ok(tr.h[i] === 0 && tr.h[(tr.nz - 1) * tr.nx + i] === 0, 'terrain border not flat');
      for (let j = 0; j < tr.nz; j++) assert.ok(tr.h[j * tr.nx] === 0 && tr.h[j * tr.nx + tr.nx - 1] === 0, 'terrain border not flat');
      for (let i = 0; i < c.points.length; i++) {
        const l = leftOf(c.tangents[i]);
        for (const lat of [-6, -3, 0, 3, 6]) {
          const x = c.points[i].x + l.x * lat;
          const z = c.points[i].y + l.y * lat;
          const above = terrainHeight(surf.terrain, x, z) - surfaceY(c, i, lat);
          assert.ok(above <= 0.01, `${base.def.name} seed ${seed}: ground ${above.toFixed(2)} m above the road at ${i}`);
        }
      }
    }
  }
});

test('big hills with steep banking and barriers leave no holes beside the road', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    for (const seed of [1, 2, 3]) {
      const base = getSampleTrack(si);
      const L = base.center.length;
      const hs = rollingHeights(
        dotFractions(base).map((u) => u * L),
        L,
        rng(seed * 31 + si),
        [14, 28],
      );
      const t = buildTrack({ id: `holes-${si}-${seed}`, name: 'h', control: withHeights(base.def.control, hs), options: { banking: 2, walls: true } });
      const surf = surfaceFor(t);
      const c = t.center;
      const n = c.points.length;
      const { left, right } = edgeOffsets(c);
      for (let i = 0; i < n; i++) {
        // Ground right beside the road edge stays close under it (well within the earth skirt).
        if (!surf.deck[i]) {
          const l = leftOf(c.tangents[i]);
          for (const side of [1, -1]) {
            const e = side > 0 ? left[i] : right[i];
            const lat = (e + 0.3) * side;
            const drop = surfaceY(c, i, e * side) - terrainHeight(surf.terrain, c.points[i].x + l.x * lat, c.points[i].y + l.y * lat);
            assert.ok(drop < SKIRT_DEPTH - 0.4, `${base.def.name} seed ${seed}: ground ${drop.toFixed(2)} m below the road edge at ${i}`);
          }
        }
        // No barrier on the inside of a corner tighter than the barrier line (it would fold over).
        const r = 1 / Math.max(1e-6, Math.abs(c.curvature[i]));
        const inner = c.curvature[i] > 0 ? surf.wallR[i] : surf.wallL[i];
        if (r < c.wallOffset + 1.5) assert.equal(inner, 0, `${base.def.name}: inner barrier on a ${r.toFixed(1)} m corner`);
      }
      // With no other road near it, a raised road never turns into a bridge by accident.
      const decks = Array.from(surf.deck).reduce((a, b) => a + b, 0);
      assert.equal(decks, 0, `${base.def.name} seed ${seed}: ${decks} deck samples without any crossing`);
    }
  }
});

test('grass never shows through the road: every drawn road and kerb triangle checked exactly, with steep banks and hills', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const base = getSampleTrack(si);
    const L = base.center.length;
    const hs = rollingHeights(
      dotFractions(base).map((u) => u * L),
      L,
      rng(7 + si),
      [14, 28],
    );
    const hilly = withHeights(base.def.control, hs);
    const variants = [
      { control: base.def.control.map((d) => ({ ...d, b: 30 })), options: { banking: 1 as const } },
      { control: hilly.map((d) => ({ ...d, b: 25 })), options: { banking: 2 as const, width: 15 } },
      // The case from the screenshots: big hills, 30 degree banks and barriers, through the editor's pipeline.
      { control: hilly.map((d) => ({ ...d, b: 30 })), options: { banking: 2 as const, walls: true } },
    ];
    variants.forEach((v, vi) => {
      const res = trackFromControl({ id: `dense-${si}-${vi}`, name: 'd', ...v });
      const t = res.track ?? buildTrack({ id: `dense-${si}-${vi}`, name: 'd', ...v });
      const surf = surfaceFor(t);
      const road = buildRoadGeometry(t.center, surf);
      let worst = -Infinity;
      let where = '';
      for (const g of [road.ground, road.deck, buildKerbGeometry(t)]) {
        if (!g) continue;
        const pos = g.getAttribute('position');
        const idx = g.index;
        const count = idx ? idx.count : pos.count;
        const vert = (k: number): P3 => {
          const m = idx ? idx.getX(k) : k;
          return [pos.getX(m), pos.getY(m), pos.getZ(m)];
        };
        for (let k = 0; k < count; k += 3) {
          forEachGroundProbe(surf.terrain, vert(k), vert(k + 1), vert(k + 2), (x, z, y) => {
            const above = terrainHeight(surf.terrain, x, z) - y;
            if (above > worst) {
              worst = above;
              where = `${x.toFixed(1)}, ${z.toFixed(1)}`;
            }
          });
        }
      }
      // The meshes sit 2 cm or more above the road surface, and the ground at least 3 cm under it.
      assert.ok(worst < -0.04, `${base.def.name} variant ${vi}: ground ${worst.toFixed(3)} m from the drawn road at ${where}`);
    });
  }
});

test('a bridge gets a deck with rails, and no pillar stands on the road below', () => {
  const res = hillyEight(rise(9));
  assert.ok(res.ok);
  if (!res.ok) return;
  const t = res.track;
  const c = t.center;
  const surf = surfaceFor(t);
  const x = findCrossings(c)[0];
  const upper = x.dh > 0 ? x.j : x.i;
  const lower = x.dh > 0 ? x.i : x.j;
  assert.equal(surf.deck[upper], 1, 'upper road is a deck at the crossing');
  assert.equal(surf.deck[lower], 0, 'lower road is on the ground');
  assert.ok(surf.wallL[upper] && surf.wallR[upper], 'deck has rails on both sides');
  // (Pillars only stand clear of the road below; a short span over it needs none.)
  // No pillar within the lower road's width.
  const low = c.points[lower];
  for (const p of surf.pillars) assert.ok(Math.hypot(p.x - low.x, p.z - low.y) > TRACK.roadWidth / 2 + 1, 'pillar on the lower road');
});

test('barriers leave a gap where the track crosses itself on the level', () => {
  const res = hillyEight(() => 0);
  assert.ok(res.ok);
  if (!res.ok) return;
  const t = res.track;
  const surf = surfaceFor(t);
  const x = findCrossings(t.center)[0];
  for (const i of [x.i, x.j]) assert.ok(!surf.wallL[i] && !surf.wallR[i], `barrier across the crossing at ${i}`);
  const n = t.center.points.length;
  const walled = surf.wallL.reduce((a, b) => a + b, 0) / n;
  assert.ok(walled > 0.8, `only ${(walled * 100).toFixed(0)}% walled`);
  // Switched off: no barriers at all on the ground.
  const open = buildTrack({ ...t.def, id: 'open', options: { walls: false } });
  assert.equal(surfaceFor(open).wallL.reduce((a, b) => a + b, 0), 0);
});

test('the car follows the road over hills and a bridge, and laps it', () => {
  const res = hillyEight(rise(9));
  assert.ok(res.ok);
  if (!res.ok) return;
  const t = res.track;
  const car = new CarPhysics(t);
  let worst = 0;
  let sawHigh = false;
  for (let k = 0; k < HANDLING.tickRate * 60; k++) {
    car.step(botInput(car.state, t));
    const st = car.state;
    const i = st.trackIndex;
    worst = Math.max(worst, Math.abs(st.y - surfaceY(t.center, i, st.lateral)));
    if (st.y > 8) sawHigh = true;
  }
  assert.ok(sawHigh, 'drove over the top');
  assert.ok(worst < 0.8, `car ${worst.toFixed(2)} m off the road surface`);
});

/** A long straight with a constant slope (+ uphill, - downhill) from x = -700. */
function slopeTrack(grade: number): Track {
  const control: Dot[] = [];
  const h = (x: number) => Math.max(0, Math.min(40, 20 + (x + 500) * grade));
  for (let x = -800; x <= 800; x += 50) control.push({ x, y: -300, h: h(x) });
  for (let a = 1; a < 12; a++) control.push({ x: 800 + 300 * Math.sin((a / 12) * Math.PI), y: -300 * Math.cos((a / 12) * Math.PI), h: h(800) });
  for (let x = 800; x >= -800; x -= 50) control.push({ x, y: 300, h: h(800) + ((h(-800) - h(800)) * (800 - x)) / 1600 });
  for (let a = 1; a < 12; a++) control.push({ x: -800 - 300 * Math.sin((a / 12) * Math.PI), y: 300 * Math.cos((a / 12) * Math.PI), h: h(-800) });
  return buildTrack({ id: `slope-${grade}`, name: 'slope', control: withHeights(control, control.map((p) => p.h ?? 0)), options: { walls: false } });
}

test('climbing is slower than driving on the flat, descending is faster', () => {
  // Distance covered in 4 s from a standstill (the speed at one instant could catch a gear change).
  const distanceIn4s = (grade: number) => {
    const car = new CarPhysics(slopeTrack(grade));
    Object.assign(car.state, { x: -480, z: -300, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
    let d = 0;
    for (let k = 0; k < HANDLING.tickRate * 4; k++) {
      car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
      d += car.state.speed / HANDLING.tickRate;
    }
    return d;
  };
  const up = distanceIn4s(0.04);
  const flat = distanceIn4s(0);
  const down = distanceIn4s(-0.04);
  assert.ok(up < flat - 1 && flat < down - 1, `up ${up.toFixed(1)} m, flat ${flat.toFixed(1)} m, down ${down.toFixed(1)} m`);
});

test('a barrier stops the car leaving the road; a glancing hit keeps most of the speed', () => {
  const t = slopeTrack(0);
  const walled = buildTrack({ ...t.def, id: 'walled', options: { walls: true } });
  const hit = (angleDeg: number) => {
    const car = new CarPhysics(walled);
    const a = (-angleDeg * Math.PI) / 180; // towards the left (north) barrier
    Object.assign(car.state, { x: -300, z: -300, heading: a, vx: 30 * Math.cos(a), vz: 30 * Math.sin(a), trackIndex: -1 });
    let maxLat = 0;
    let knocked = 0;
    for (let k = 0; k < HANDLING.tickRate * 1.5; k++) {
      car.step({ throttle: 0, brake: 0, steer: 0, handbrake: false });
      maxLat = Math.max(maxLat, Math.abs(car.state.lateral));
      knocked = Math.max(knocked, car.state.wallHit);
    }
    return { maxLat, knocked, speed: Math.hypot(car.state.vx, car.state.vz) };
  };
  const glance = hit(12);
  assert.ok(glance.knocked > 0, 'hit the barrier');
  assert.ok(glance.maxLat <= walled.center.wallOffset, `went through: lateral ${glance.maxLat.toFixed(2)}`);
  assert.ok(glance.speed > 30 * 0.6, `glancing hit kept ${glance.speed.toFixed(1)} m/s`);
  const square = hit(60);
  assert.ok(square.maxLat <= walled.center.wallOffset);
  assert.ok(square.speed < glance.speed, 'a square hit costs more speed');
});

test('Lift level crossings makes a road over a road; as a tunnel it has walls, a roof and no pillars', async () => {
  const { liftCrossings } = await import('../src/editor/repair.ts');
  const { tunnelsOf } = await import('../src/track/tunnels.ts');
  const { buildTunnelGeometry } = await import('../src/track/mesh.ts');
  const flat = trackFromStroke(figureEight(), 'eight');
  assert.ok(flat.ok);
  const t0 = flat.track;
  assert.equal(findCrossings(t0.center).filter((x) => crossingKind(x.dh) === 'flat').length, 1, 'a level crossroads');
  const lifted = liftCrossings(t0.def.control, t0.options);
  assert.ok(lifted, 'something to lift');
  const bridge = trackFromControl({ id: 'eight-lift', name: 'eight', control: lifted, options: { ...t0.options, crossing: 'bridge' } });
  assert.ok(bridge.ok, 'still a valid track');
  const xs = findCrossings(bridge.track.center);
  assert.ok(xs.length === 1 && crossingKind(xs[0].dh) === 'bridge', `now a road over a road (${xs[0]?.dh.toFixed(1)} m)`);
  assert.equal(liftCrossings(lifted, t0.options), null, 'nothing left to lift');
  assert.equal(tunnelsOf(bridge.track).length, 0);
  assert.equal(buildTunnelGeometry(bridge.track), null);

  const tunnel = trackFromControl({ id: 'eight-tunnel', name: 'eight', control: lifted, options: { ...t0.options, crossing: 'tunnel' } });
  assert.ok(tunnel.ok);
  const tn = tunnelsOf(tunnel.track);
  assert.equal(tn.length, 1);
  assert.ok(tn[0].count * tunnel.track.center.spacing > tunnel.track.center.wallOffset * 2, `as long as the road above is wide: ${(tn[0].count * 2.5).toFixed(0)} m`);
  assert.ok(buildTunnelGeometry(tunnel.track), 'walls, roof and portals');
  // No pillars standing by the crossing (the road above is on an embankment, the road below in the tunnel).
  const c = tunnel.track.center;
  const at = c.points[tn[0].upper];
  const near = (ps: { x: number; z: number }[]) => ps.filter((p) => Math.hypot(p.x - at.x, p.z - at.y) < 25).length;
  assert.equal(near(surfaceFor(tunnel.track).pillars), 0);
  // A car still drives through the tunnel, under the road above.
  const car = new CarPhysics(tunnel.track);
  const lower = tn[0].from;
  car.placeAt(lower * c.spacing - 20);
  let minY = Infinity;
  for (let k = 0; k < HANDLING.tickRate * 3; k++) {
    car.step({ throttle: 0.6, brake: 0, steer: botInput(car.state, tunnel.track).steer, handbrake: false });
    if (Math.hypot(car.state.x - at.x, car.state.z - at.y) < 4) minY = Math.min(minY, car.state.y);
  }
  assert.ok(minY < tn[0].roof - 3, `under the roof: car at ${minY.toFixed(1)} m, roof ${tn[0].roof.toFixed(1)} m`);
});
