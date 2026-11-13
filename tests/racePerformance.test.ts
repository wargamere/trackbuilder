import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { TrafficPlanner } from '../src/race/traffic.ts';
import { DrivingEnv } from '../training/env.ts';

test('fast track interpolation preserves lane bounds and speeds across the start line', () => {
  const track = getSampleTrack(1), d = new RacingDriver(track, aiPace(1, track)), c = track.center;
  const at = (arr: Float32Array, s: number) => {
    const n = arr.length, f = (((s / c.spacing) % n) + n) % n, i = Math.floor(f), u = f - i;
    return arr[i] * (1 - u) + arr[(i + 1) % n] * u;
  };
  for (const s of [-3 * c.length - .1, -c.length, -.1, 0, .1, c.length / 3, c.length - .1, c.length, 4 * c.length + .1]) {
    assert.equal(d.speedAt(s), at(d.speed, s));
    for (const lane of [-99, -3, 0, 3, 99]) {
      const expected = at(d.line.offset, s) + Math.max(-at(d.line.roomRight, s), Math.min(at(d.line.roomLeft, s), lane));
      assert.equal(d.lateralAt(s, lane), expected);
    }
  }
});

test('deadline-sliced medal/qualifying simulation yields promptly and keeps identical lap physics', t => {
  const track = getSampleTrack(0), full = new AuthorLap(track, 1, true), sliced = new AuthorLap(track, 1, true);
  full.finish();
  let clock = 0;
  t.mock.method(performance, 'now', () => clock++);
  assert.equal(sliced.run(10000, 0), false);
  assert.equal(Reflect.get(sliced, 'tick'), 0, 'expired shared budget does no work');
  clock = 0;
  assert.equal(sliced.run(10000, 4), false);
  assert.equal(Reflect.get(sliced, 'tick'), 64, 'yields at the next 16-tick clock check');
  while (sliced.result === undefined) sliced.run(10000, clock + 4);
  assert.equal(sliced.result, full.result);
  assert.deepEqual(sliced.trace, full.trace);
});

test('reusing rival forecasts reduces prediction work with identical racing decisions', () => {
  const track = getSampleTrack(1);
  const proto = TrafficPlanner.prototype;
  const originalNear = Reflect.get(proto, 'toNear'), originalLat = Reflect.get(proto, 'theirLat');
  const run = (reuse: boolean) => {
    let forecasts = 0;
    // Do not record every forecast call in the test runner's mock history:
    // retaining millions of trajectory arguments would benchmark the mock.
    Reflect.set(proto, 'toNear', function (this: TrafficPlanner, ...args: unknown[]) {
      const near = originalNear.apply(this, args);
      if (!reuse) Object.defineProperty(near, 'forecast', { get: () => undefined, set() {} });
      return near;
    });
    Reflect.set(proto, 'theirLat', function (this: TrafficPlanner, ...args: unknown[]) { forecasts++; return originalLat.apply(this, args); });
    const env = new DrivingEnv(track, Array.from({ length: 6 }, (_, i) => ({ brain: 'classic', difficulty: 1 - i * .02, player: i === 5 })), { seed: 88, laps: 2, seconds: 30, damage: true });
    const trace = [];
    for (let i = 0; i < 1800; i++) {
      env.step();
      if (i % 30 === 0) trace.push(env.agents.map(a => [a.car.state.x, a.car.state.z, a.car.state.speed, a.car.state.heading, a.classic?.racecraft]));
    }
    Reflect.set(proto, 'toNear', originalNear); Reflect.set(proto, 'theirLat', originalLat);
    return { forecasts, trace };
  };
  try {
    const cached = run(true), uncached = run(false);
    assert.deepEqual(cached.trace, uncached.trace, 'cache never changes the path, braking or decisions');
    assert.ok(cached.forecasts < uncached.forecasts * .8, `${cached.forecasts} vs ${uncached.forecasts} forecast evaluations`);
  } finally {
    Reflect.set(proto, 'toNear', originalNear); Reflect.set(proto, 'theirLat', originalLat);
  }
});
