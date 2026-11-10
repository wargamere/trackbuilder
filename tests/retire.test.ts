import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics, CarState } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { CAREER } from '../src/config/career.ts';
import { DAMAGE, FLAGS } from '../src/config/race.ts';
import type { Dot } from '../src/core/math.ts';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import { raceOrder } from '../src/race/classify.ts';
import { RaceControl, type ControlCar, type ControlEvent } from '../src/race/raceControl.ts';
import { RaceSession, type Progress, type RaceEvent } from '../src/race/session.ts';
import { buildTrack, type Track } from '../src/track/track.ts';
import { race, type CarSpec } from './helpers/traffic.ts';

const DT = 1 / HANDLING.tickRate;

/** A long oval: straights of ±half m joined by half circles of radius r. */
function oval(r = 60, half = 250): Track {
  const control: Dot[] = [];
  for (let x = -half; x <= half; x += 50) control.push({ x, y: -r });
  for (let a = 1; a < 12; a++) control.push({ x: half + r * Math.sin((a / 12) * Math.PI), y: -r * Math.cos((a / 12) * Math.PI) });
  for (let x = half; x >= -half; x -= 50) control.push({ x, y: r });
  for (let a = 1; a < 12; a++) control.push({ x: -half - r * Math.sin((a / 12) * Math.PI), y: r * Math.cos((a / 12) * Math.PI) });
  return buildTrack({ id: `retire-oval-${r}-${half}`, name: 'oval', control, options: { walls: true, banking: 0 } });
}

const go = { throttle: 1, brake: 0, steer: 0, handbrake: false };

test('100 % damage: the car breaks down on the spot (no drive, it stops and stays stopped); less than that and it still drives', () => {
  const t = oval();
  const car = new CarPhysics(t);
  car.damageOn = true;
  car.placeAt(40);
  for (let k = 0; k < 4 * HANDLING.tickRate; k++) car.step(go);
  const cruising = car.state.speed;
  assert.ok(cruising > 20, `up to speed: ${cruising.toFixed(1)} m/s`);
  // Badly damaged but not all the way: slower, still going.
  car.wingDamage = 0.9;
  car.bodyDamage = 0.9;
  assert.equal(car.broken, false);
  for (let k = 0; k < HANDLING.tickRate; k++) car.step(go);
  assert.ok(car.state.speed > 20);
  // All the way: it stops within a few seconds, flat on the throttle or not, and never moves again.
  car.addDamage(DAMAGE.from + 1 / DAMAGE.perSpeed);
  assert.equal(car.damage, 1);
  assert.equal(car.broken, true);
  const at = car.state.s;
  for (let k = 0; k < 5 * HANDLING.tickRate; k++) car.step(go);
  assert.ok(Math.abs(car.state.speed) < 0.2, `stopped: ${car.state.speed.toFixed(2)} m/s`);
  const stopped = { x: car.state.x, z: car.state.z };
  assert.ok(car.state.s - at < 120, `within ${(car.state.s - at).toFixed(0)} m`);
  for (let k = 0; k < 3 * HANDLING.tickRate; k++) car.step(k % 2 ? go : { throttle: 0, brake: 1, steer: 1, handbrake: false });
  assert.ok(Math.hypot(car.state.x - stopped.x, car.state.z - stopped.z) < 0.3, 'throttle, brake (reverse) and steering do nothing');
  // With damage off nothing breaks; a mended car drives again.
  const off = new CarPhysics(t);
  off.wingDamage = 1;
  assert.equal(off.broken, false);
  car.repair();
  assert.equal(car.broken, false);
  for (let k = 0; k < 2 * HANDLING.tickRate; k++) car.step(go);
  assert.ok(car.state.speed > 10);
  // A mechanical failure breaks it down whatever the damage (or with damage off).
  off.failed = true;
  assert.equal(off.broken, true);
});

/** Drives a session along a track of length L at `v` m/s for `seconds`, from s = `from`; returns where it got to. */
function run(s: RaceSession, L: number, from: number, v: number, seconds: number, events: RaceEvent[] = []): number {
  let at = from;
  for (let k = 0; k < seconds * HANDLING.tickRate; k++) {
    const prev: Progress = { s: ((at % L) + L) % L, lateral: 0, along: v };
    at += v * DT;
    s.step(prev, { s: ((at % L) + L) % L, lateral: 0, along: v }, events);
  }
  return at;
}

test('retiring: the race is over where the car is, unfinished: it keeps the distance it had done, has no total time, and counts no more laps', () => {
  const L = 1000;
  const s = new RaceSession(L, null, 5, 12, 0);
  // Not before the start.
  const early = new RaceSession(L, null, 5);
  early.retire(990);
  assert.equal(early.retired, false);
  // A lap and a half in.
  const at = run(s, L, -10, 50, 31);
  assert.equal(s.laps.length, 1);
  const dist = s.raceDistance(at % L);
  assert.ok(Math.abs(dist - (at - 0)) < 110, `race distance ${dist.toFixed(0)} m`);
  s.retire(at % L);
  assert.equal(s.retired, true);
  assert.equal(s.phase, 'finished');
  assert.equal(s.runEnd, null);
  assert.equal(s.totalTime(), null);
  assert.equal(s.raceDistance(at % L), dist);
  assert.equal(s.raceDistance(123), dist, 'frozen, wherever the car is pushed to');
  // Rolling over the line afterwards isn't a lap.
  run(s, L, at, 50, 30);
  assert.equal(s.laps.length, 1);
  assert.equal(s.retired, true);
  // Not after the finish.
  const done = new RaceSession(L, null, 1, 12, 0);
  run(done, L, -10, 50, 25);
  assert.equal(done.phase, 'finished');
  done.retire(100);
  assert.equal(done.retired, false);
  assert.ok(done.runEnd !== null);
});

test('the chequered flag: once it’s out, a car finishes the next time it crosses the line, a lap or more down', () => {
  const L = 1000;
  const s = new RaceSession(L, null, 5, 12, 0);
  const events: RaceEvent[] = [];
  let at = run(s, L, -10, 50, 45, events); // two laps done, into the third
  assert.equal(s.laps.length, 2);
  s.flagged = true;
  assert.equal(s.phase, 'racing', 'it races on to the line');
  at = run(s, L, at, 50, 20, events);
  assert.equal(s.phase, 'finished');
  assert.equal(s.laps.length, 3, 'three laps of five');
  assert.ok(s.runEnd !== null && !s.retired);
  assert.ok(events.some((e) => e.type === 'finished'));
  assert.equal(s.raceDistance(at % L), 3 * L);
  // Without the flag it drives every lap.
  const full = new RaceSession(L, null, 5, 12, 0);
  run(full, L, -10, 50, 65);
  assert.equal(full.phase, 'racing');
  assert.equal(full.laps.length, 3);
});

test('race order: by distance; a car flagged a lap down is behind every car on the lead lap; retirements last, the one that got furthest first', () => {
  const L = 1000;
  const cars = [
    { name: 'winner', dist: 5 * L, end: 400, out: false },
    { name: 'second', dist: 5 * L, end: 402.5, out: false },
    { name: 'lapped, flagged', dist: 4 * L, end: 401, out: false },
    { name: 'on the lead lap, not yet home', dist: 4.9 * L, end: null, out: false },
    { name: 'a lap down, still running', dist: 3.95 * L, end: null, out: false },
    { name: 'retired late', dist: 4.5 * L, end: null, out: true },
    { name: 'retired early', dist: 0.4 * L, end: null, out: true },
  ];
  const shuffled = [cars[5], cars[2], cars[6], cars[0], cars[4], cars[3], cars[1]];
  assert.deepEqual(raceOrder(shuffled).map((c) => c.name), ['winner', 'second', 'on the lead lap, not yet home', 'lapped, flagged', 'a lap down, still running', 'retired late', 'retired early']);
  assert.equal(shuffled[0].name, 'retired late', 'the list given isn’t reordered');
});

test('a retired AI car stays where it stopped: it doesn’t drive, pit or put itself back on the road', () => {
  const t = oval(60, 400);
  const ai = new AiDriver(t, { name: 'x', paint: 0, difficulty: 0.7, laps: 5, slot: 0, damage: true });
  const states = [ai.car.state];
  const step = () => {
    const prev: Progress = { s: ai.car.state.s, lateral: ai.car.state.lateral, along: ai.car.state.speed };
    ai.car.step(ai.drive(states, DT));
    ai.session.step(prev, { s: ai.car.state.s, lateral: ai.car.state.lateral, along: ai.car.state.speed }, []);
  };
  for (let k = 0; k < 12 * HANDLING.tickRate; k++) step();
  assert.ok(ai.car.state.speed > 20 && ai.session.phase === 'racing');
  ai.car.wingDamage = 1;
  assert.ok(ai.car.broken);
  ai.session.retire(ai.car.state.s);
  for (let k = 0; k < 6 * HANDLING.tickRate; k++) step();
  assert.ok(Math.abs(ai.car.state.speed) < 0.2, 'stopped');
  const at = { x: ai.car.state.x, z: ai.car.state.z };
  // (Well past the 2.5 s after which a stuck AI would put itself back on the road.)
  for (let k = 0; k < 8 * HANDLING.tickRate; k++) step();
  assert.ok(Math.hypot(ai.car.state.x - at.x, ai.car.state.z - at.z) < 0.3, 'it hasn’t moved or been reset');
  assert.equal(ai.car.damage, 1, 'and nobody has mended it');
});

test('race control: a retired car standing on the track brings out yellow flags and the safety car, and isn’t the leader or a car to close up on', () => {
  const L = 2000;
  const mk = (s: number, speed: number): CarState => Object.assign(new CarState(), { s, speed });
  const rc = new RaceControl(L, 10, true);
  // The leader has retired at s = 900 on lap 3 and stands there; two cars race on behind it.
  const cars: ControlCar[] = [
    { st: mk(900, 0), dist: 2 * L + 900, racing: true, hit: 0, out: true },
    { st: mk(500, 60), dist: 2 * L + 500, racing: true, hit: 0 },
    { st: mk(300, 60), dist: 2 * L + 300, racing: true, hit: 0 },
  ];
  const ev: ControlEvent[] = [];
  for (let k = 0; k < (FLAGS.safetyCarAfter + 0.5) * HANDLING.tickRate; k++) rc.step(DT, cars, ev);
  assert.ok(ev.some((e) => e.type === 'yellow'), 'yellow flags');
  assert.ok(rc.yellowAt(880));
  assert.equal(rc.sc, 'out', 'the safety car comes out for it');
  assert.ok(FLAGS.safetyCarAfter < DAMAGE.recoverAfter, 'it stands there long enough for that');
  // The car that's now leading is held to the safety car's pace (the dead car ahead isn't someone to catch).
  assert.equal(rc.cap(1, cars), FLAGS.scSpeed);
  // The one behind closes up on the car ahead of it, not on the retired one.
  const far = rc.cap(2, cars);
  assert.ok(far > FLAGS.scSpeed, `closing up at ${far.toFixed(1)} m/s`);
  // Once the marshals have it (not racing any more), the flags clear and the safety car comes in when it's due.
  cars[0].racing = false;
  for (let k = 0; k < (FLAGS.yellowHold + 1) * HANDLING.tickRate; k++) rc.step(DT, cars, ev);
  assert.equal(rc.yellowAt(880), false);
  for (let k = 0; k < FLAGS.scMin * HANDLING.tickRate; k++) rc.step(DT, cars, ev);
  assert.equal(rc.sc, 'in');
  // The lap the leader is on is the running leader's, not the retired car's (frozen further round).
  cars[1].dist = 3 * L + 10;
  rc.step(DT, cars, ev);
  assert.equal(rc.sc, 'none');
  assert.ok(ev.some((e) => e.type === 'green'));
});

test('a championship’s grid of twenty at Spielberg: one car breaks down mid-race and is taken away, the other nineteen race on and finish, flagged in order', () => {
  const t = builtInTracks().find((b) => b.def.id === 'world-at-1969')?.track();
  assert.ok(t);
  const n = CAREER.cars;
  const specs: CarSpec[] = Array.from({ length: n }, (_, k) => ({ kind: 'ai', difficulty: 0.8 - (CAREER.spread * k) / (n - 1) }));
  let broke = -1;
  let after = 0;
  let resets = 0;
  const seen: boolean[] = [];
  const r = race(
    t,
    specs,
    3,
    420,
    true,
    null,
    null,
    (tick, cars) => {
      // The car running fifth 25 s in breaks down where it is.
      if (tick === 25 * HANDLING.tickRate) {
        const order = cars.map((c, k) => ({ k, d: c.session.raceDistance(c.car.state.s) })).sort((a, b) => b.d - a.d);
        broke = order[4].k;
        cars[broke].car.failed = true;
      }
      if (broke >= 0) {
        after++;
        cars.forEach((c, k) => (seen[k] = c.session.retired));
      }
    },
    true,
  );
  resets = r.resets;
  assert.ok(broke >= 0);
  assert.deepEqual(seen.map((x, k) => (x ? k : -1)).filter((k) => k >= 0), [broke], 'only that car retired');
  const finished = r.ends.filter((e) => !isNaN(e)).length;
  assert.equal(finished, n - 1, `${finished} of ${n - 1} finished`);
  assert.ok(isNaN(r.ends[broke]));
  assert.equal(r.order[n - 1], broke, 'the retired car is classified last');
  assert.ok(after > DAMAGE.recoverAfter * HANDLING.tickRate);
  assert.ok(resets <= 6, `${resets} resets: a car held up right behind it may put itself back on the road, but nobody is stuck for good`);
  assert.ok(r.kinds.hard <= 6, `${r.kinds.hard} hard hits`);
  // The flag: everyone finished within a lap of the winner (nobody drove on for laps after).
  const ends = r.ends.filter((e) => !isNaN(e));
  const best = Math.min(...r.best.filter((b) => !isNaN(b)));
  assert.ok(Math.max(...ends) - Math.min(...ends) < best * 1.6, `the field came home within ${(Math.max(...ends) - Math.min(...ends)).toFixed(0)} s`);
  for (let k = 0; k < n; k++) if (k !== broke) assert.ok(r.laps[k].length >= 2 && r.laps[k].length <= 3);
});
