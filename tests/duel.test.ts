import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collideCars } from '../src/car/contact.ts';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../src/editor/pipeline.ts';
import { AiDriver, aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import type { Track } from '../src/track/track.ts';
import { brakingBends, rolling } from './helpers/traffic.ts';

const DT = 1 / HANDLING.tickRate;

/** A lap on `driver`'s line shifted `lane` m sideways: its time, and ticks off the track. */
function laneLap(t: Track, driver: RacingDriver, lane: number): { time: number; off: number } {
  const car = new CarPhysics(t);
  rolling(car, driver, 10, lane);
  const L = t.center.length;
  let time = 0;
  let off = 0;
  let prev = car.state.s;
  let laps = 0;
  for (let k = 0; k < HANDLING.tickRate * 200 && laps < 2; k++) {
    car.step(driver.drive(car.state, lane));
    if (laps === 1) {
      time += DT;
      if (car.state.offTrack) off++;
    }
    if (prev > L * 0.75 && car.state.s < L * 0.25) laps++;
    prev = car.state.s;
  }
  return { time, off };
}

test('a lane a little off the line costs only a little: no phantom corners where it meets the edge of the road', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const d = new RacingDriver(t, aiPace(0.9, t));
    const line = laneLap(t, d, 0).time;
    const near = laneLap(t, d, 0.3);
    const off = laneLap(t, d, 0.8);
    assert.ok(near.time < line * 1.01, `${t.def.name}: 0.3 m off the line ${near.time.toFixed(2)} s vs ${line.toFixed(2)} s`);
    assert.ok(off.time < line * 1.06, `${t.def.name}: 0.8 m off the line ${off.time.toFixed(2)} s vs ${line.toFixed(2)} s`);
    assert.equal(near.off + off.off, 0, `${t.def.name}: on the road`);
  }
});

test('fighting for a place, it goes later on the brakes and still makes the corner', () => {
  const t = getSampleTrack(1);
  const d = new RacingDriver(t, aiPace(0.6, t));
  const bend = brakingBends(t, d)[0];
  const L = t.center.length;
  const run = (late: boolean) => {
    const car = new CarPhysics(t);
    rolling(car, d, bend.brake - 120);
    let brakeAt = NaN;
    let time = 0;
    let off = 0;
    for (let k = 0; k < HANDLING.tickRate * 15; k++) {
      const inp = d.drive(car.state, 0, undefined, { late });
      car.step(inp);
      time += DT;
      const ds = (((car.state.s - bend.brake) % L) + L * 1.5) % L - L / 2;
      if (isNaN(brakeAt) && inp.brake > 0.3) brakeAt = ds;
      if (car.state.offTrack) off++;
      if (ds > bend.apex - bend.brake + 50) break;
    }
    return { brakeAt, time, off };
  };
  const normal = run(false);
  const late = run(true);
  assert.ok(late.brakeAt > normal.brakeAt + 2, `brakes at ${late.brakeAt.toFixed(1)} m vs ${normal.brakeAt.toFixed(1)} m`);
  assert.equal(late.off, 0, 'and makes the corner');
  assert.ok(late.time <= normal.time + 0.02, `no slower: ${late.time.toFixed(2)} s vs ${normal.time.toFixed(2)} s`);
});

/**
 * The AI into the first hairpin on Paperclip with you `follow` m behind
 * (bumper to bumper; Infinity: nobody) on the racing line, a touch quicker:
 * where it is across the road at the braking point, how long it took to the
 * exit, and any contact.
 */
function intoHairpin(follow: number) {
  const t = getSampleTrack(1);
  const c = t.center;
  const L = c.length;
  const bot = new AiDriver(t, { name: 'ai', paint: 0, difficulty: 0.9, laps: 9, slot: 0 });
  (bot.session as unknown as { phase: string }).phase = 'racing';
  const driver = (bot as unknown as { driver: RacingDriver }).driver;
  const bend = brakingBends(t, driver)[0];
  const s0 = bend.brake - 200;
  rolling(bot.car, driver, s0);
  (bot as unknown as { lane: number }).lane = 0;
  const line = new RacingDriver(t, aiPace(1));
  const you = new CarPhysics(t);
  const cars = isFinite(follow) ? [bot.car.state, you.state] : [bot.car.state];
  let ys = s0 - 4.2 - (isFinite(follow) ? follow : 500);
  let contacts = 0;
  let time = 0;
  let latAtBrake = NaN;
  for (let k = 0; k < HANDLING.tickRate * 15; k++) {
    const st = bot.car.state;
    const ds = (((st.s - bend.brake) % L) + L * 1.5) % L - L / 2;
    if (ds > bend.apex - bend.brake + 60) break;
    bot.car.step(bot.drive(cars, DT));
    time += DT;
    if (isFinite(follow)) {
      const v = Math.min(st.speed + 1.5, line.speedAt(ys) * 1.05);
      ys = Math.min(ys + v * DT, st.s - 4.2 - follow);
      you.placeAt(ys, line.lateralAt(ys));
      const tg = c.tangents[Math.max(0, you.state.trackIndex)];
      Object.assign(you.state, { vx: tg.x * v, vz: tg.y * v, speed: v });
      if (collideCars(st, you.state) > 0) contacts++;
    }
    if (isNaN(latAtBrake) && ds > -1) latAtBrake = st.lateral;
  }
  const side = driver.curvatureAt(bend.apex) > 0 ? -1 : 1;
  return { time, contacts, latAtBrake, line: driver.lateralAt(bend.brake), inside: driver.lateralAt(bend.brake, side * 99) };
}

test('with you right on its tail into a hairpin, the AI covers the inside before the braking point (and it costs it little)', () => {
  const alone = intoHairpin(Infinity);
  const tailed = intoHairpin(1.5);
  const far = intoHairpin(30);
  assert.ok(Math.abs(tailed.inside - tailed.line) > 5, 'the line is well away from the inside there');
  assert.ok(Math.abs(tailed.latAtBrake - tailed.inside) < 1.5, `covered: at ${tailed.latAtBrake.toFixed(1)} m (inside ${tailed.inside.toFixed(1)}, line ${tailed.line.toFixed(1)})`);
  assert.equal(tailed.contacts, 0, 'without touching you');
  assert.ok(tailed.time < alone.time + 0.5, `losing little: ${tailed.time.toFixed(2)} s vs ${alone.time.toFixed(2)} s alone`);
  assert.ok(Math.abs(far.latAtBrake - far.line) < 1, `with you 30 m back it keeps its line: ${far.latAtBrake.toFixed(1)} m (line ${far.line.toFixed(1)})`);
});
