import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics, CarState } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { CONDITIONS, DAMAGE, FLAGS } from '../src/config/race.ts';
import type { Dot } from '../src/core/math.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import { PitCrew, pitBox } from '../src/race/pitStop.ts';
import { RaceControl, type ControlCar, type ControlEvent } from '../src/race/raceControl.ts';
import type { Progress } from '../src/race/session.ts';
import { buildTrack, type Track } from '../src/track/track.ts';

const DT = 1 / HANDLING.tickRate;

/** A long oval: straights of ±half m joined by half circles of radius r. */
function oval(r = 60, half = 250): Track {
  const control: Dot[] = [];
  for (let x = -half; x <= half; x += 50) control.push({ x, y: -r });
  for (let a = 1; a < 12; a++) control.push({ x: half + r * Math.sin((a / 12) * Math.PI), y: -r * Math.cos((a / 12) * Math.PI) });
  for (let x = half; x >= -half; x -= 50) control.push({ x, y: r });
  for (let a = 1; a < 12; a++) control.push({ x: -half - r * Math.sin((a / 12) * Math.PI), y: r * Math.cos((a / 12) * Math.PI) });
  return buildTrack({ id: `rc-oval-${r}-${half}`, name: 'oval', control, options: { walls: true, banking: 0 } });
}

const go = { throttle: 1, brake: 0, steer: 0, handbrake: false };

test('damage: hard hits break the wing and bodywork (less grip, lower top speed), soft ones don\'t; repairs mend it', () => {
  const t = oval();
  const car = new CarPhysics(t);
  assert.equal(car.addDamage(30), 0, 'damage off: nothing');
  car.damageOn = true;
  assert.equal(car.addDamage(DAMAGE.from - 0.5), 0, 'a nudge does nothing');
  const d = car.addDamage(20);
  assert.ok(Math.abs(d - (20 - DAMAGE.from) * DAMAGE.perSpeed) < 1e-9);
  assert.ok(car.wingDamage > car.bodyDamage && car.damage === car.wingDamage);
  assert.ok(car.damageGrip < 1);
  // Driving into the barrier at speed damages it.
  const crash = new CarPhysics(t);
  crash.damageOn = true;
  Object.assign(crash.state, { x: 0, z: -60, heading: -Math.PI / 2, vx: 0, vz: -30, trackIndex: -1 });
  for (let k = 0; k < HANDLING.tickRate; k++) crash.step(go);
  assert.ok(crash.damage > 0.2, `damaged: ${crash.damage.toFixed(2)}`);
  // A damaged car is slower: lower top speed down the straight and less grip.
  const top = (dmg: number) => {
    const c = new CarPhysics(oval(60, 900));
    c.damageOn = true;
    c.wingDamage = dmg;
    c.bodyDamage = dmg;
    Object.assign(c.state, { x: -850, z: -60, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
    for (let k = 0; k < HANDLING.tickRate * 25; k++) c.step(go);
    return c.state.speed;
  };
  const clean = top(0);
  const broken = top(1);
  assert.ok(broken < clean * 0.97, `top speed ${broken.toFixed(1)} vs ${clean.toFixed(1)} m/s`);
  car.repair();
  assert.equal(car.damage, 0);
});

test('a pit stop mends damage, taking longer the worse it is', () => {
  const t = getSampleTrack(0);
  const service = (damage: number) => {
    const car = new CarPhysics(t);
    car.damageOn = true;
    car.wingDamage = damage;
    const crew = new PitCrew(t);
    const box = pitBox(t);
    car.placeAt(box.s - 60, box.lateral);
    crew.reset(car.state);
    car.placeAt(box.s, box.lateral);
    let started = -1;
    let ticks = 0;
    for (; ticks < HANDLING.tickRate * 30; ticks++) {
      car.step({ throttle: 0, brake: 0, steer: 0, handbrake: true });
      const ev = crew.step(car, DT);
      if (ev === 'start') started = ticks;
      if (ev === 'done') break;
    }
    assert.ok(started >= 0, 'the stop started');
    return { seconds: (ticks - started) * DT, left: car.damage };
  };
  const none = service(0);
  const heavy = service(0.8);
  assert.ok(Math.abs(none.seconds - CONDITIONS.service) < 0.05);
  assert.ok(Math.abs(heavy.seconds - (CONDITIONS.service + DAMAGE.repairTime * 0.8)) < 0.05, `${heavy.seconds.toFixed(2)} s`);
  assert.equal(heavy.left, 0, 'mended');
});

/** Race control's view of cars at race distances `dist`, at `speed`, all racing. */
function cars(dist: number[], speed = 30, L = 1000): ControlCar[] {
  return dist.map((d) => {
    const st = new CarState();
    st.s = ((d % L) + L) % L;
    st.speed = speed;
    return { st, dist: d, racing: true, hit: 0 };
  });
}

test('yellow flags: a stopped or crashed car brings them out around it, and they clear after it\'s gone', () => {
  const rc = new RaceControl(1000, 10, false);
  const ev: ControlEvent[] = [];
  const field = cars([500, 300, 100]);
  field[1].st.speed = 0;
  for (let k = 0; k < HANDLING.tickRate * (FLAGS.stoppedTime + 0.2); k++) rc.step(DT, field, ev);
  assert.deepEqual(ev.map((e) => e.type), ['yellow'], 'one incident, flagged once');
  assert.ok(rc.yellowAt(300) && rc.yellowAt(300 - FLAGS.yellowBefore + 1) && rc.yellowAt(300 + FLAGS.yellowAfter - 1));
  assert.ok(!rc.yellowAt(600) && !rc.yellowAt(100));
  assert.equal(rc.yellowAhead(100, 250), 300 - FLAGS.yellowBefore - 100);
  assert.equal(rc.yellowAhead(700, 250), null);
  assert.equal(rc.sc, 'none', 'the safety car is off');
  // It gets going again: the flags clear a few seconds later.
  field[1].st.speed = 30;
  for (let k = 0; k < HANDLING.tickRate * (FLAGS.yellowHold + 0.5); k++) rc.step(DT, field, ev);
  assert.ok(!rc.yellowAt(300));
  // A big crash flags it at once.
  const crash = cars([500]);
  crash[0].hit = FLAGS.crashSpeed + 1;
  const ev2: ControlEvent[] = [];
  new RaceControl(1000, 10, false).step(DT, crash, ev2);
  assert.equal(ev2[0]?.type, 'yellow');
});

test('the safety car: out for a stuck car, holds the leader to its pace, closes the field up, in after a while, then green', () => {
  const L = 1000;
  const rc = new RaceControl(L, 10, true);
  const ev: ControlEvent[] = [];
  const field = cars([2500, 2380, 2100, 1300], 30, L);
  field[3].st.speed = 0;
  for (let k = 0; k < HANDLING.tickRate * (FLAGS.safetyCarAfter + 0.1); k++) rc.step(DT, field, ev);
  assert.equal(rc.sc, 'out');
  assert.ok(ev.some((e) => e.type === 'sc-out'));
  // The leader at its pace; a car far back catches up, one close behind holds back.
  assert.equal(rc.cap(0, field), FLAGS.scSpeed);
  const far = rc.cap(2, field);
  assert.ok(far > FLAGS.scSpeed && far <= FLAGS.scSpeed + FLAGS.scMaxCatch);
  const near = cars([1000, 1005], 30, L);
  assert.ok(rc.cap(0, near) < FLAGS.scSpeed, 'too close: slower than the safety car');
  // After scMin it's coming in, and it's green when the leader starts the next lap.
  field[3].st.speed = 30;
  for (let k = 0; k < HANDLING.tickRate * FLAGS.scMin; k++) rc.step(DT, field, ev);
  assert.equal(rc.sc, 'in');
  for (const c of field) c.dist += 600;
  rc.step(DT, field, ev);
  assert.equal(rc.sc, 'none');
  assert.deepEqual(ev.filter((e) => e.type !== 'yellow').map((e) => e.type), ['sc-out', 'sc-in', 'green']);
  assert.equal(rc.cap(0, field), Infinity, 'racing again');
  // Never in the last lap.
  const late = new RaceControl(L, 3, true);
  const lastLap = cars([2500, 2400], 30, L);
  lastLap[1].st.speed = 0;
  for (let k = 0; k < HANDLING.tickRate * 3; k++) late.step(DT, lastLap, []);
  assert.equal(late.sc, 'none');
});

const progressOf = (car: CarPhysics, track: Track): Progress => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

test('in a race: a stuck car brings out the safety car, the AI field closes up behind it and races on after', () => {
  const t = getSampleTrack(0);
  const laps = 6;
  const ais = [0.8, 0.7, 0.6, 0.5].map((d, k) => new AiDriver(t, { name: `a${k}`, paint: 0, difficulty: d, laps, slot: k }));
  const states = ais.map((a) => a.car.state);
  const rc = new RaceControl(t.center.length, laps, true);
  const ev: ControlEvent[] = [];
  const control: ControlCar[] = [];
  const spread = () => {
    const d = ais.slice(0, 3).map((a) => a.session.raceDistance(a.car.state.s));
    return Math.max(...d) - Math.min(...d);
  };
  let before = 0;
  let closest = Infinity;
  let off = 0;
  let stuckTicks = 0;
  for (let tick = 0; tick < 420 * HANDLING.tickRate && ais.some((a) => a.session.phase !== 'finished'); tick++) {
    const time = tick * DT;
    // From 50 s the slowest car stops dead for 4 s (stuck after a spin).
    const stuck = time > 50 && stuckTicks < 4 * HANDLING.tickRate;
    const prev = ais.map((a) => progressOf(a.car, t));
    ais.forEach((a, k) => {
      if (k === 3 && stuck) {
        stuckTicks++;
        a.car.state.vx = a.car.state.vz = a.car.state.speed = 0;
        return;
      }
      a.car.step(a.drive(states, DT));
      if (a.car.state.offTrack) off++;
    });
    control.length = 0;
    ais.forEach((a) => control.push({ st: a.car.state, dist: a.session.raceDistance(a.car.state.s), racing: a.session.phase === 'racing' && a.session.lapStart !== null && !a.pitting, hit: 0 }));
    rc.step(DT, control, ev);
    ais.forEach((a, k) => {
      a.raceCap = rc.cap(k, control);
      a.yellow = rc.yellowAt(a.car.state.s);
      a.session.step(prev[k], progressOf(a.car, t), []);
    });
    if (rc.sc === 'out' && !before) before = spread();
    if (rc.sc !== 'none') closest = Math.min(closest, spread());
  }
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('yellow') && types.includes('sc-out') && types.includes('green'), types.join(','));
  assert.ok(closest < before * 0.6, `the field closed up: ${before.toFixed(0)} m → ${closest.toFixed(0)} m`);
  assert.ok(ais.every((a) => a.session.phase === 'finished'), 'everyone finished');
  assert.ok(off * DT < 1.5, `${(off * DT).toFixed(1)} car-seconds past the track limits`);
});

test('a badly damaged AI car pits for repairs and comes out mended', () => {
  const t = getSampleTrack(0);
  const ai = new AiDriver(t, { name: 'a', paint: 0, difficulty: 0.7, laps: 4, slot: 0, damage: true });
  let damaged = false;
  for (let tick = 0; tick < 300 * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    // A knock in the first lap.
    if (!damaged && ai.session.lapStart !== null && ai.session.raceDistance(ai.car.state.s) > 200) {
      ai.car.wingDamage = 0.7;
      ai.car.bodyDamage = 0.5;
      damaged = true;
    }
    const prev = progressOf(ai.car, t);
    ai.car.step(ai.drive([ai.car.state], DT));
    ai.session.step(prev, progressOf(ai.car, t), []);
  }
  assert.equal(ai.session.phase, 'finished');
  assert.ok((ai.crew?.stops ?? 0) >= 1, 'it stopped');
  assert.equal(ai.car.damage, 0, 'mended');
});
