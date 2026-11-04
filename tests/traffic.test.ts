import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collideCars } from '../src/car/contact.ts';
import { CarPhysics } from '../src/car/physics.ts';
import { slipstream } from '../src/car/slipstream.ts';
import { HANDLING } from '../src/config/handling.ts';
import { CONTACT, SLIPSTREAM } from '../src/config/race.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../src/editor/pipeline.ts';
import { AiDriver, aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
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
  assert.equal(draft(100 - SLIPSTREAM.range - 2 * CONTACT.halfLength - 1, 0)[1], 0, 'none out of reach');
  // It grows the closer you get: faster than in proportion.
  const at = (gap: number) => draft(100 - 2 * CONTACT.halfLength - gap, 0)[1];
  assert.ok(at(5) - at(10) > at(25) - at(30), 'it grows faster the closer you get');
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
  let tauSum = 0;
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const r = race(t, diffs.map(ai), 4, 600);
    const pos = (k: number) => r.order.indexOf(k);
    assert.ok(pos(3) < pos(0), `${t.def.name}: the quickest finishes ahead of the slowest (${r.order})`);
    tauSum += orderAgreement(r.order, [3, 2, 1, 0]);
    assert.ok(r.kinds.hard <= 1, `${t.def.name}: ${r.kinds.hard} hard knocks`);
  }
  // In four laps the order mostly sorts itself out (on a short, twisty track not always all of it).
  assert.ok(tauSum / SAMPLE_COUNT >= 0.4, `finishing order agrees with pace on average by ${(tauSum / SAMPLE_COUNT).toFixed(2)}`);
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

test('down the inside of turn 1 alongside the fastest AI: it leaves you room and never turns in on you', () => {
  const t = getSampleTrack(0);
  const c = t.center;
  // Turn 1: the first corner with kerbs.
  const kerb = [...t.kerbs].sort((a, b) => a.apex - b.apex).find((k) => k.apex * c.spacing > 150)!;
  const inside = kerb.sign > 0 ? -1 : 1;
  const apex = kerb.apex * c.spacing;
  for (const lead of [-2, 0, 2]) {
    const bot = new AiDriver(t, { name: 'ai', paint: 0, difficulty: 1, laps: 3, slot: 0 });
    (bot.session as unknown as { phase: string }).phase = 'racing';
    const line = new RacingDriver(t, aiPace(1));
    const s0 = apex - 150;
    bot.car.placeAt(s0, line.lateralAt(s0));
    const tg = c.tangents[Math.max(0, bot.car.state.trackIndex)];
    Object.assign(bot.car.state, { vx: tg.x * 30, vz: tg.y * 30, speed: 30 });
    // You: overlapped with it on the inside edge, at your own pace through the corner.
    const you = new CarPhysics(t);
    const lat = inside * (c.width / 2 - 1.4);
    let s = s0 + lead;
    let v = 30;
    let contacts = 0;
    let closest = Infinity;
    for (let tick = 0; tick < HANDLING.tickRate * 6 && bot.car.state.s < apex + 40; tick++) {
      v = Math.min(v + 5 / HANDLING.tickRate, line.speedAt(s) * 0.97);
      s += v / HANDLING.tickRate;
      you.placeAt(s, lat);
      const ty = c.tangents[Math.max(0, you.state.trackIndex)];
      Object.assign(you.state, { vx: ty.x * v, vz: ty.y * v, speed: v });
      bot.car.step(bot.drive([bot.car.state, you.state], 1 / HANDLING.tickRate));
      if (collideCars(bot.car.state, you.state) > 0) contacts++;
      if (Math.abs(you.state.s - bot.car.state.s) < 4.2) closest = Math.min(closest, Math.abs(you.state.lateral - bot.car.state.lateral));
    }
    assert.equal(contacts, 0, `starting ${lead} m ${lead < 0 ? 'behind' : 'ahead'}: no contact`);
    assert.ok(closest > 2.3, `starting ${lead} m ${lead < 0 ? 'behind' : 'ahead'}: at least ${closest.toFixed(2)} m between centres alongside`);
  }
});

test('an AI gets past a much slower player on the racing line (who looks out for no one) within a lap', () => {
  for (const si of [0, 1]) {
    const t = getSampleTrack(si);
    let passed = NaN;
    const r = race(t, [{ kind: 'player', difficulty: 0.2 }, ai(0.8)], 2, 300, true, null, null, (tick, cars) => {
      const d = (k: number) => cars[k].session.raceDistance(cars[k].car.state.s);
      if (isNaN(passed) && d(1) > d(0) + 5) passed = tick / HANDLING.tickRate;
    });
    assert.ok(passed < 45, `${t.def.name}: by after ${passed.toFixed(1)} s`);
    assert.deepEqual(r.order, [1, 0], `${t.def.name}: and stays ahead`);
    assert.equal(r.kinds.hard, 0, `${t.def.name}: no hard knocks`);
  }
});
