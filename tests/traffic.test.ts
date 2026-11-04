import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { slipstream } from '../src/car/slipstream.ts';
import { HANDLING } from '../src/config/handling.ts';
import { SLIPSTREAM } from '../src/config/race.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../src/editor/pipeline.ts';
import { orderAgreement, race, type CarSpec } from './helpers/traffic.ts';

const ai = (difficulty: number): CarSpec => ({ kind: 'ai', difficulty });

test('slipstream: strongest right behind a car, fading with the gap and to the side; nothing beside, ahead or far behind', () => {
  const t = getSampleTrack(0);
  const L = t.center.length;
  const car = (s: number, lateral: number) => {
    const c = new CarPhysics(t);
    c.placeAt(s, lateral);
    c.state.speed = 30;
    return c.state;
  };
  const draft = (s: number, lateral: number) => {
    const out = [0, 0];
    slipstream([car(100, 0), car(s, lateral)], L, out);
    return out;
  };
  const [lead, close] = draft(95, 0);
  assert.equal(lead, 0, 'the car in front gets none');
  assert.ok(close > 0.75, `right behind: ${close.toFixed(2)}`);
  assert.ok(draft(85, 0)[1] < close && draft(85, 0)[1] > 0, 'less further back');
  assert.ok(draft(95, 1.2)[1] < close, 'less off to the side');
  assert.equal(draft(95, 2.5)[1], 0, 'none beside it');
  assert.equal(draft(100 - SLIPSTREAM.range - 1, 0)[1], 0, 'none out of reach');
});

test('a car in a slipstream pulls harder and goes faster along a straight', () => {
  const t = getSampleTrack(0);
  const run = (draft: number) => {
    const c = new CarPhysics(t);
    c.placeAt(0, 0);
    for (let k = 0; k < HANDLING.tickRate * 3; k++) {
      c.draft = draft;
      c.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    }
    return c.state.speed;
  };
  const clear = run(0);
  const towed = run(1);
  assert.ok(towed > clear + 0.5, `towed ${towed.toFixed(1)} vs clear ${clear.toFixed(1)} m/s`);
});

test('a slower AI lets a clearly quicker one by within a lap or so', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    let passed = NaN;
    const r = race(t, [ai(0.4), ai(0.9)], 2, 400, true, null, null, (tick, cars) => {
      const d = (k: number) => cars[k].ai!.session.raceDistance(cars[k].car.state.s);
      if (isNaN(passed) && d(1) > d(0) + 5) passed = tick / HANDLING.tickRate;
    });
    assert.deepEqual(r.order, [1, 0], `${t.def.name}: the quicker car wins`);
    assert.ok(passed < 60, `${t.def.name}: by after ${passed.toFixed(1)} s`);
    assert.ok(r.kinds.hard <= 1, `${t.def.name}: ${r.kinds.hard} hard knocks`);
  }
});

test('quicker AI cars starting behind slower ones work their way to the front', () => {
  const diffs = [0.35, 0.55, 0.75, 0.95];
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const r = race(t, diffs.map(ai), 4, 600);
    const pos = (k: number) => r.order.indexOf(k);
    assert.ok(pos(3) < pos(0), `${t.def.name}: the quickest finishes ahead of the slowest (${r.order})`);
    const tau = orderAgreement(r.order, [3, 2, 1, 0]);
    assert.ok(tau >= 0.3, `${t.def.name}: finishing order ${r.order} (agreement with pace ${tau.toFixed(2)})`);
    assert.ok(r.kinds.hard <= 1, `${t.def.name}: ${r.kinds.hard} hard knocks`);
  }
});

test('a matched field races cleanly: hardly a knock, nobody off the road, everyone finishes', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const r = race(t, Array.from({ length: 8 }, (_, k) => ai(0.9 - (0.08 * k) / 7)), 3, 600);
    assert.ok(r.ends.every((e) => !isNaN(e)), `${t.def.name}: everyone finishes`);
    assert.ok(r.kinds.hard <= 1 && r.firm <= 6, `${t.def.name}: ${r.firm} firm knocks, ${r.kinds.hard} hard`);
    assert.ok(r.offTrack < 2, `${t.def.name}: ${r.offTrack.toFixed(1)} car-seconds off the road`);
    assert.equal(r.resets, 0, `${t.def.name}: nobody had to be put back on the road`);
  }
});
