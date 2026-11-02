import assert from 'node:assert/strict';
import { test } from 'node:test';
import { angleDelta, CarPhysics, type DriveInput } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { FixedStep } from '../src/core/fixedStep.ts';
import type { Vec2 } from '../src/core/math.ts';
import { rng } from '../src/core/random.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../src/editor/pipeline.ts';
import { placeTrees } from '../src/track/placement.ts';
import { buildTrack } from '../src/track/track.ts';
import { botInput } from './bot.ts';

const input = (throttle: number, brake: number, steer: number, handbrake = false): DriveInput => ({ throttle, brake, steer, handbrake });

/** A stadium-shaped track with two 1.6 km straights (no trees near the straights, no barriers). */
function longStraightTrack() {
  const control: Vec2[] = [];
  for (let x = -800; x <= 800; x += 50) control.push({ x, y: -300 });
  for (let a = 1; a < 12; a++) control.push({ x: 800 + 300 * Math.sin((a / 12) * Math.PI), y: -300 * Math.cos((a / 12) * Math.PI) });
  for (let x = 800; x >= -800; x -= 50) control.push({ x, y: 300 });
  for (let a = 1; a < 12; a++) control.push({ x: -800 - 300 * Math.sin((a / 12) * Math.PI), y: 300 * Math.cos((a / 12) * Math.PI) });
  return buildTrack({ id: 'test-straights', name: 'straights', control, options: { walls: false } });
}

/** Car at rest at (x, z) heading east. */
function carAt(track = longStraightTrack(), x = -700, z = -300): CarPhysics {
  const car = new CarPhysics(track);
  Object.assign(car.state, { x, z, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
  return car;
}

/** Scripted driving that depends only on the physics tick number. */
function scripted(tick: number): DriveInput {
  const t = tick / HANDLING.tickRate;
  return input(t < 6 || t > 7 ? 1 : 0, t > 6 && t < 7 ? 1 : 0, Math.sin(t * 1.3) * 0.8, t > 8 && t < 8.5);
}

/** Runs ~10 s of driving with the given frame times and records the state after every physics tick. */
function runAtFrameRate(frameTimes: () => number): string[] {
  const track = getSampleTrack(0);
  const car = new CarPhysics(track);
  const fixed = new FixedStep(HANDLING.tickRate);
  const states: string[] = [];
  while (fixed.tick < 1200) {
    fixed.advance(frameTimes(), () => {
      car.step(scripted(fixed.tick));
      const s = car.state;
      states.push([s.x, s.z, s.heading, s.vx, s.vz, s.yawRate, s.steer].join(','));
    });
  }
  return states.slice(0, 1200);
}

test('driving is identical at 60, 144 and 240 Hz, and with jittery frame times', () => {
  const at60 = runAtFrameRate(() => 1 / 60);
  const at144 = runAtFrameRate(() => 1 / 144);
  const at240 = runAtFrameRate(() => 1 / 240);
  const r = rng(42);
  const jitter = runAtFrameRate(() => 0.004 + r() * 0.03);
  assert.equal(at60.length, 1200);
  assert.deepEqual(at144, at60);
  assert.deepEqual(at240, at60);
  assert.deepEqual(jitter, at60);
});

test('a 1/60 s frame is exactly two physics steps', () => {
  const f = new FixedStep(120);
  let steps = 0;
  for (let i = 0; i < 600; i++) f.advance(1 / 60, () => steps++);
  assert.equal(steps, 1200);
});

test('the test driver laps every sample track without touching the grass', () => {
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = getSampleTrack(i);
    const car = new CarPhysics(t);
    const L = t.center.length;
    let half = false;
    let prevS = car.state.s;
    let lapTicks = 0;
    let grassTicks = 0;
    for (let k = 1; k < HANDLING.tickRate * 120; k++) {
      car.step(botInput(car.state, t));
      const s = car.state.s;
      if (car.state.grass > 0) grassTicks++;
      if (s > L * 0.4 && s < L * 0.6) half = true;
      if (half && prevS > L * 0.8 && s < L * 0.2) {
        lapTicks = k;
        break;
      }
      prevS = s;
    }
    const lapTime = lapTicks / HANDLING.tickRate;
    assert.ok(lapTicks > 0, `${t.def.name}: no lap`);
    assert.ok(lapTime > 15 && lapTime < 75, `${t.def.name}: lap ${lapTime}s`);
    assert.equal(grassTicks, 0, `${t.def.name}: ${grassTicks} ticks on grass`);
  }
});

test('the car is much slower on grass', () => {
  const road = carAt();
  const grass = carAt(undefined, -700, -520); // 220 m off the straight, beyond the trees
  for (let k = 0; k < HANDLING.tickRate * 20; k++) {
    road.step(input(1, 0, 0));
    grass.step(input(1, 0, 0));
  }
  assert.equal(road.state.grass, 0);
  assert.equal(grass.state.grass, 1);
  assert.ok(road.state.speed > 40, `road top speed ${road.state.speed}`);
  assert.ok(grass.state.speed < road.state.speed * 0.4, `grass ${grass.state.speed} vs road ${road.state.speed}`);
});

test('steering lock reduces with speed', () => {
  const lockAt = (speed: number) => {
    const car = carAt();
    car.state.vx = speed;
    for (let k = 0; k < HANDLING.tickRate; k++) {
      car.step(input(0, 0, 1));
      car.state.vx = speed * Math.cos(car.state.heading);
      car.state.vz = speed * Math.sin(car.state.heading);
    }
    return car.state.steer;
  };
  const slow = lockAt(5);
  const fast = lockAt(40);
  assert.ok(slow > 0 && fast > 0, 'positive steer turns right');
  assert.ok(fast < slow * 0.5, `lock ${fast} at 40 m/s vs ${slow} at 5 m/s`);
});

test('the car slides a little in fast corners but not on the straight', () => {
  const car = carAt();
  for (let k = 0; k < HANDLING.tickRate * 4; k++) car.step(input(1, 0, 0));
  assert.ok(car.state.slip < 0.05);
  let maxSlip = 0;
  for (let k = 0; k < HANDLING.tickRate * 1.5; k++) {
    car.step(input(1, 0, 1));
    maxSlip = Math.max(maxSlip, car.state.slip);
  }
  assert.ok(maxSlip > 0.5 && maxSlip < 8, `slip ${maxSlip}`);
});

test('holding brake at a standstill reverses, up to the reverse speed limit', () => {
  const car = carAt();
  for (let k = 0; k < HANDLING.tickRate * 6; k++) car.step(input(0, 1, 0));
  assert.ok(car.state.speed < -HANDLING.reverseMaxSpeed * 0.9 && car.state.speed >= -HANDLING.reverseMaxSpeed - 0.01);
});

test('reset puts the car back on the centre line facing along the track', () => {
  const t = getSampleTrack(1);
  const car = new CarPhysics(t);
  for (let k = 0; k < HANDLING.tickRate * 3; k++) car.step(input(1, 0, 1));
  car.resetToRoad();
  const s = car.state;
  assert.equal(s.speed, 0);
  assert.ok(Math.abs(s.lateral) < 0.5, `lateral ${s.lateral}`);
  const tan = t.center.tangents[s.trackIndex];
  assert.ok(Math.abs(angleDelta(s.heading, Math.atan2(tan.y, tan.x))) < 0.15);
});

test('trees stop the car instead of letting it drive through', () => {
  const t = getSampleTrack(0);
  const tree = placeTrees(t).find((p) => Math.abs(p.x) < 300 && Math.abs(p.z) < 150);
  assert.ok(tree, 'sample track has a tree in the middle');
  if (!tree) return;
  const car = new CarPhysics(t);
  Object.assign(car.state, { x: tree.x - 40, z: tree.z, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
  let minDist = Infinity;
  for (let k = 0; k < HANDLING.tickRate * 8; k++) {
    car.step(input(1, 0, 0));
    minDist = Math.min(minDist, Math.hypot(car.state.x - tree.x, car.state.z - tree.z));
  }
  assert.ok(minDist >= HANDLING.carRadius + 0.5 * tree.scale - 0.01, `got within ${minDist} m of the trunk`);
  assert.ok(car.state.x < tree.x + 5, 'did not pass through');
});
