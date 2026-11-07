import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACK } from '../src/config/track.ts';
import type { Dot } from '../src/core/math.ts';
import { rng } from '../src/core/random.ts';
import { getSampleTrack, trackFromControl } from '../src/editor/pipeline.ts';
import { PreviewCar } from '../src/editor/previewCar.ts';
import { confettiBurst, stepConfetti } from '../src/editor/render2d.ts';
import { repairTrack, type Fix } from '../src/editor/repair.ts';
import { evenControl } from '../src/editor/smoothing.ts';
import { nearestSample } from '../src/editor/splice.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { trackOptions } from '../src/track/track.ts';

const opts = trackOptions({});
const build = (control: readonly Dot[], options = opts) => trackFromControl({ id: 't', name: '', control: [...control], options });

test('"Fix it" mends each kind of problem and leaves a valid track', () => {
  const base = getSampleTrack(0).def.control;
  // A long, flat figure of eight: its strands cross at about 25°, too shallow to be level.
  const eight: Dot[] = evenControl(Array.from({ length: 64 }, (_, i) => ({ x: Math.sin((i / 64) * Math.PI * 2) * 260, y: Math.sin((i / 32) * Math.PI * 2) * 30 })));
  const cases: [string, Dot[], string, Fix | ''][] = [
    ['too small', base.map((p) => ({ ...p, x: p.x * 0.18, y: p.y * 0.18 })), 'too-short', 'grown'],
    ['a spike', base.map((p, i) => (i === 10 ? { ...p, x: p.x + 40, y: p.y + 40 } : p)), 'too-tight', 'corners'],
    ['two roads too close', [{ x: -200, y: 0 }, { x: 0, y: -6 }, { x: 200, y: 0 }, { x: 205, y: 12 }, { x: 0, y: 6 }, { x: -205, y: 12 }], 'too-close', ''],
    ['a shallow level crossing', eight, 'shallow-crossing', 'bridged'],
  ];
  for (const [name, dots, issue, fix] of cases) {
    const before = build(dots);
    assert.ok(!before.ok && before.issue === issue, `${name}: starts as ${issue} (was ${before.ok ? 'ok' : before.issue})`);
    const r = repairTrack(dots, opts);
    assert.ok(r, `${name}: fixed`);
    const after = build(r.dots, r.options);
    assert.ok(after.ok, `${name}: valid after (${after.ok ? '' : after.issue})`);
    if (fix) assert.ok(r.fixes.includes(fix), `${name}: ${r.fixes.join(', ')}`);
    assert.ok(r.options.width >= TRACK.minWidth);
  }
  // A track that's fine needs no fixing.
  assert.equal(repairTrack(base, opts), null);
});

test('"Fix it" changes as little as it can: an opened-up corner leaves the rest of the track where it was', () => {
  const base = getSampleTrack(0).def.control;
  const r = repairTrack(
    base.map((p, i) => (i === 10 ? { ...p, x: p.x + 40, y: p.y + 40 } : p)),
    opts,
  );
  assert.ok(r);
  const fixed = build(r.dots, r.options);
  const orig = build(base);
  assert.ok(fixed.ok && orig.ok);
  const pts = orig.track.center.points;
  const near = pts.filter((p) => nearestSample(fixed.track.center, p).d < 3).length;
  assert.ok(near / pts.length > 0.8, `${Math.round((near / pts.length) * 100)}% of the road unmoved`);
});

test('the preview car drives the gold lap: worked out a slice at a time once editing stops, then lapping on the road', () => {
  const track = getSampleTrack(1);
  const car = new PreviewCar();
  car.set(track);
  // Editing holds it off.
  for (let i = 0; i < 60; i++) car.update(1 / 60, true);
  assert.ok(car.working);
  assert.equal(car.pose(), null);
  let frames = 0;
  while (car.working && frames < 400) {
    car.update(1 / 60, false);
    frames++;
  }
  assert.ok(!car.working && frames < 400, `done in ${frames} frames`);
  const gold = new AuthorLap(track).finish();
  assert.ok(gold !== null && car.lap !== null);
  assert.ok(Math.abs(car.lap - gold) < 1e-9, 'its lap is the gold medal time');
  const c = track.center;
  for (let i = 0; i < 200; i++) {
    car.update(0.05, false);
    const p = car.pose();
    assert.ok(p);
    assert.ok(nearestSample(c, p).d < c.width / 2 + 1.5, 'on the road');
  }
  car.set(null);
  assert.equal(car.pose(), null);
  assert.equal(car.lap, null);
});

test('confetti falls and is gone within a few seconds', () => {
  let ps = confettiBurst(100, 100, 50, rng(1));
  assert.equal(ps.length, 50);
  for (let i = 0; i < 60 * 3 && ps.length; i++) ps = stepConfetti(ps, 1 / 60);
  assert.equal(ps.length, 0);
});
