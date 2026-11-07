import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GEAR_COUNT, pullAt, revsAt, stepGearbox, type GearboxMode, type GearState } from '../src/car/gearbox.ts';
import { InputManager } from '../src/car/input.ts';
import { CarPhysics, CarState, type DriveInput } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { AI } from '../src/config/race.ts';
import { DEFAULT_ASSISTS } from '../src/core/settings.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { RacingLineOverlay } from '../src/render/racingLineOverlay.ts';
import { aiPace } from '../src/race/ai.ts';
import { applyAssists, assistDriver } from '../src/race/assists.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { AuthorLap } from '../src/race/medals.ts';
import type { Track } from '../src/track/track.ts';

const G = HANDLING.gearbox;

/** A flying lap (s) of `drive` on `track` with the car's gearbox in `mode`. */
function flyingLap(track: Track, mode: GearboxMode, drive: (st: CarState) => DriveInput): number {
  const car = new CarPhysics(track);
  car.gearbox = mode;
  const L = track.center.length;
  let prev = car.state.s;
  const cross: number[] = [];
  for (let tick = 0; tick < HANDLING.tickRate * 300; tick++) {
    car.step(drive(car.state));
    const s = car.state.s;
    if (prev > L * 0.75 && s < L * 0.25) {
      const f = (L - prev) / Math.max(1e-9, L - prev + s);
      cross.push((tick - 1 + f) / HANDLING.tickRate);
      if (cross.length === 3) return cross[2] - cross[1];
    }
    prev = s;
  }
  throw new Error('no lap');
}

test('the engine pulls fully through the middle of the revs, less low down (but not in 1st) and nothing at the limiter', () => {
  assert.equal(pullAt(0.7, 3), 1);
  assert.ok(pullAt(0.2, 3) < 0.8);
  assert.equal(pullAt(0.2, 1), 1, 'the clutch slips in 1st to get going');
  assert.ok(pullAt(0.97, 3) < 1 && pullAt(0.97, 3) > 0.7);
  assert.equal(pullAt(1, 3), 0);
  // Changing up at the change-up point lands in the full band of the next gear, and down too.
  for (let g = 1; g < GEAR_COUNT; g++) {
    assert.equal(pullAt(revsAt(G.top[g - 1] * G.idealUp, g + 1), g + 1), 1, `after ${g} → ${g + 1}`);
    assert.ok(revsAt(G.top[g] * G.idealDown, g) < G.idealUp, `${g + 1} → ${g} doesn't change straight back up`);
  }
});

test('manual gears: one change per request, no over-revving change down, and 1st when stopped', () => {
  const gs: GearState = { gear: 1, rpm: 0, shift: 0 };
  stepGearbox(gs, 'manual', 1, 10, 1 / 120);
  assert.equal(gs.gear, 2);
  stepGearbox(gs, 'manual', 1, 10, 1 / 120);
  assert.equal(gs.gear, 3);
  stepGearbox(gs, 'manual', 0, 10, 1 / 120);
  assert.equal(gs.gear, 3, 'stays without a request');
  // 25 m/s in 1st would be way past the limiter: refused.
  gs.gear = 2;
  stepGearbox(gs, 'manual', -1, 25, 1 / 120);
  assert.equal(gs.gear, 2);
  stepGearbox(gs, 'manual', 0, 0.2, 1 / 120);
  assert.equal(gs.gear, 1, 'nearly stopped: 1st');
});

test('stuck in 1st with manual gears, the limiter holds the car to 1st gear speed', () => {
  const car = new CarPhysics(getSampleTrack(0));
  car.gearbox = 'manual';
  for (let k = 0; k < HANDLING.tickRate * 8; k++) car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
  assert.equal(car.state.gear, 1);
  assert.ok(car.state.speed <= G.top[0] + 0.3, `${car.state.speed.toFixed(1)} m/s`);
});

test('the AI changes gear without losing anything: medal times are what they were before gears', () => {
  // Measured before the gearbox existed (seconds).
  const before = [35.95, 35.41, 34.08];
  for (let i = 0; i < 3; i++) {
    const t = getSampleTrack(i);
    const lap = new AuthorLap(t).finish();
    assert.ok(lap !== null && Math.abs(lap - before[i]) < 0.02, `${t.def.name}: ${lap?.toFixed(2)} s`);
  }
});

test('the automatic is a little slower than changing gear yourself at the right revs', () => {
  for (let i = 0; i < 3; i++) {
    const t = getSampleTrack(i);
    const d = new RacingDriver(t, aiPace(AI.medalDifficulty, t));
    // A manual driver changing up and down at the ideal points.
    const manual = (st: CarState): DriveInput => {
      const inp = d.drive(st);
      const r = revsAt(st.speed, st.gear);
      inp.shift = r >= G.idealUp ? 1 : r < G.idealDown && st.gear > 1 && revsAt(st.speed, st.gear - 1) < G.idealUp - 0.05 ? -1 : 0;
      return inp;
    };
    const m = flyingLap(t, 'manual', manual);
    const a = flyingLap(t, 'auto', (st) => d.drive(st));
    const slower = a / m - 1;
    assert.ok(slower > 0.0005 && slower < 0.015, `${t.def.name}: automatic ${(slower * 100).toFixed(2)}% slower`);
  }
});

test('gear changes from the keyboard, gamepad or touch are made one per tick', () => {
  const im = new InputManager();
  im.touch.shift = 2;
  const out: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  assert.equal(im.sample(out).shift, 1);
  assert.equal(im.sample(out).shift, 1);
  assert.equal(im.sample(out).shift, 0);
});

test('braking assist brakes when you are too fast for what is coming, and leaves you alone when you are not', () => {
  const t = getSampleTrack(1);
  const d = assistDriver(t);
  const a = { ...DEFAULT_ASSISTS, brake: true };
  // Find a spot where the line's limit is well below top speed (just before a bend).
  let i = 0;
  while (d.limit[i] > 25) i++;
  const car = new CarPhysics(t);
  const at = (speed: number) => {
    car.placeAt(i * t.center.spacing - 5, d.line.offset[i]);
    const tg = t.center.tangents[car.state.trackIndex];
    Object.assign(car.state, { vx: tg.x * speed, vz: tg.y * speed, speed });
    return applyAssists(t, car.state, { throttle: 1, brake: 0, steer: 0, handbrake: false }, a);
  };
  const fast = at(45);
  assert.ok(fast.brake > 0.5 && fast.throttle < 0.5, `brake ${fast.brake.toFixed(2)}, throttle ${fast.throttle.toFixed(2)}`);
  const slow = at(10);
  assert.equal(slow.brake, 0);
  assert.equal(slow.throttle, 1);
});

test('steering assist steers while you don’t, and your own full steering always wins', () => {
  const t = getSampleTrack(0);
  const car = new CarPhysics(t);
  car.placeAt(30, 3);
  Object.assign(car.state, { speed: 20 });
  const a = { ...DEFAULT_ASSISTS, steer: true };
  const hands = applyAssists(t, car.state, { throttle: 1, brake: 0, steer: 0, handbrake: false }, a);
  assert.ok(Math.abs(hands.steer) > 0.01, 'it steers back to the line');
  const yours = applyAssists(t, car.state, { throttle: 1, brake: 0, steer: -1, handbrake: false }, a);
  assert.equal(yours.steer, -1);
});

test('fully assisted laps are a little slower than gold', () => {
  for (let i = 0; i < 3; i++) {
    const t = getSampleTrack(i);
    const gold = new AuthorLap(t).finish()!;
    const lap = flyingLap(t, 'auto', (st) => assistDriver(t).drive(st));
    const ratio = lap / gold;
    assert.ok(ratio > 1.002 && ratio < 1.06, `${t.def.name}: ${(ratio * 100 - 100).toFixed(1)}% slower than gold`);
  }
});

test('the racing line goes red where you would have to brake at your speed, and stays green when slow', () => {
  const t = getSampleTrack(0);
  const line = new RacingLineOverlay(t, assistDriver(t));
  const colors = () => line.mesh.geometry.getAttribute('color').array as Float32Array;
  const count = (rgb: 'red' | 'green') => {
    const c = colors();
    let n = 0;
    for (let k = 0; k < c.length; k += 8) {
      if (c[k + 3] <= 0) continue;
      if (rgb === 'red' && c[k] > 0.5 && c[k + 1] < 0.1) n++;
      if (rgb === 'green' && c[k + 1] > 0.4 && c[k] < 0.1) n++;
    }
    return n;
  };
  // 100 m before a bend.
  const limit = assistDriver(t).limit;
  const n = limit.length;
  let bend = 0;
  while (limit[bend] > 25) bend++;
  const from = (bend - Math.round(100 / t.center.spacing) + n) % n;
  line.update(from, 45, 'full');
  assert.ok(count('red') > 0, 'flat out: braking zones ahead');
  line.update(from, 8, 'full');
  assert.equal(count('red'), 0, 'slow: nothing to brake for');
  assert.ok(count('green') > 0);
  line.update(from, 8, 'brake');
  assert.equal(count('green'), 0, 'braking mode shows only where to lift or brake');
  line.dispose();
});
