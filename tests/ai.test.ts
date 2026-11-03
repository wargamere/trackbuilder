import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collideCars } from '../src/car/contact.ts';
import { CarPhysics, CarState } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { AI, CONTACT } from '../src/config/race.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../src/editor/pipeline.ts';
import { AiDriver, aiPace, gridSlot } from '../src/race/ai.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { RaceSession, type Progress, type RaceEvent } from '../src/race/session.ts';
import { edgeOffsets } from '../src/track/spline.ts';
import type { Track } from '../src/track/track.ts';

const DT = 1 / HANDLING.tickRate;

const progressOf = (car: CarPhysics, track: Track): Progress => {
  const st = car.state;
  const t = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * t.x + st.vz * t.y, offTrack: st.offTrack };
};

/** A race of AI cars only, run the way the race screen runs one: drive, step, bump, count laps. */
function race(track: Track, difficulties: number[], laps: number, seconds: number) {
  const ais = difficulties.map((d, k) => new AiDriver(track, { name: `ai${k}`, paint: 0, difficulty: d, laps, slot: k }));
  const states = ais.map((a) => a.car.state);
  const events: RaceEvent[] = [];
  let minGap = Infinity;
  for (let tick = 0; tick < seconds * HANDLING.tickRate; tick++) {
    const prev = ais.map((a) => progressOf(a.car, track));
    for (const a of ais) a.car.step(a.drive(states, DT));
    for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) collideCars(states[i], states[j]);
    ais.forEach((a, k) => a.session.step(prev[k], progressOf(a.car, track), events));
    // How close the cars' centres get (after contact has pushed them apart).
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) minGap = Math.min(minGap, Math.hypot(states[i].x - states[j].x, states[i].z - states[j].z));
    }
    if (ais.every((a) => a.session.phase === 'finished')) break;
  }
  return { ais, minGap };
}

test('AI pace rises with difficulty, from well off bronze to faster than the medal bot', () => {
  let last = { aggression: 0, maxSpeed: 0 };
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const p = aiPace(d);
    assert.ok(p.aggression >= last.aggression && p.maxSpeed >= last.maxSpeed, `pace drops at ${d}`);
    last = p;
  }
  assert.ok(aiPace(0).aggression < 0.3 && aiPace(0).maxSpeed < HANDLING.maxSpeed * 0.4);
  assert.ok(aiPace(1).aggression > 0.8, 'top difficulty grips harder than the medal bot (0.8)');
  assert.deepEqual(aiPace(-1), aiPace(0));
  assert.deepEqual(aiPace(2), aiPace(1));
});

test('grid slots are staggered two by two behind the line, on the road, and never on top of each other', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const { left, right } = edgeOffsets(t.center);
    const cars: CarState[] = [];
    for (let k = 0; k <= AI.maxOpponents; k++) {
      const g = gridSlot(k);
      assert.ok(g.s < 0, 'behind the line');
      const car = new CarPhysics(t);
      car.placeAt(g.s, g.lateral);
      const i = car.state.trackIndex;
      assert.ok(car.state.lateral + HANDLING.halfWidth < left[i] && -car.state.lateral + HANDLING.halfWidth < right[i], `slot ${k} on the road on ${t.def.name}`);
      for (const o of cars) assert.ok(Math.hypot(o.x - car.state.x, o.z - car.state.z) > CONTACT.radius * 2 + 0.5, `slot ${k} clear of the others`);
      cars.push(car.state);
    }
  }
});

test('two overlapping cars are pushed apart, and a rear-end hit shares the speed', () => {
  const a = new CarState();
  const b = new CarState();
  a.x = 0;
  b.x = 3; // a's nose circle overlaps b's tail circle
  a.vx = 20;
  b.vx = 10;
  const hit = collideCars(a, b);
  assert.ok(hit > 0, 'reports the impact');
  assert.ok(b.x - a.x >= 2 * CONTACT.offset + 2 * CONTACT.radius - 1e-6, 'no longer overlapping');
  assert.ok(a.vx < 20 && b.vx > 10, 'the hit slows the one behind and pushes the one ahead');
  assert.ok(Math.abs(a.vx + b.vx - 30) < 1e-9, 'momentum is kept');
  // Far apart: nothing happens.
  const c = new CarState();
  c.x = 50;
  assert.equal(collideCars(a, c), 0);
});

test('race distance: negative on the grid, grows as the car drives, never jumps when it reverses over the line', () => {
  const L = 1000;
  const s = new RaceSession(L, null, 3, 12, 0);
  const events: RaceEvent[] = [];
  let pos = L - 20;
  assert.ok(s.raceDistance(pos) < 0);
  let last = s.raceDistance(pos);
  for (let k = 0; k < 120 * 120; k++) {
    const prev = { s: pos, lateral: 0, along: 30 };
    pos = (pos + 30 * DT) % L;
    s.step(prev, { s: pos, lateral: 0, along: 30 }, events);
    const d = s.raceDistance(pos);
    assert.ok(d >= last - 1e-6, `distance went down at tick ${k}`);
    last = d;
    if (s.phase === 'finished') break;
  }
  assert.equal(s.phase, 'finished');
  assert.ok(Math.abs(last - 3 * L) < 40, `about three laps (${last.toFixed(0)})`);
  // Backing over the line from just after it doesn't count a lap.
  const r = new RaceSession(L, null, 3, 12, 0);
  r.step({ s: L - 1, lateral: 0, along: 20 }, { s: 1, lateral: 0, along: 20 }, events);
  const after = r.raceDistance(1);
  assert.ok(r.raceDistance(L - 2) <= after, 'reversing back over the line gives no distance');
});

test('AI cars race the sample tracks: all finish, harder ones are faster, none drives through another', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const author = new AuthorLap(t).finish();
    assert.ok(author);
    const { ais, minGap } = race(t, [1, 0.75, 0.5, 0.25, 0.01], 2, 400);
    for (const a of ais) assert.equal(a.session.phase, 'finished', `${a.name} (${a.difficulty}) finished on ${t.def.name}`);
    const end = (a: AiDriver) => a.session.runEnd ?? Infinity;
    // Stronger drivers finish ahead (the field starts in difficulty order, fastest at the front).
    for (let k = 1; k < ais.length; k++) assert.ok(end(ais[k - 1]) < end(ais[k]), `${ais[k - 1].difficulty} ahead of ${ais[k].difficulty} on ${t.def.name}`);
    // Best laps against the medal (bot) lap: 100 % beats it, 1 % is far slower.
    const best = (a: AiDriver) => Math.min(...a.session.laps);
    assert.ok(best(ais[0]) < author! * 1.01, `100 %: ${best(ais[0]).toFixed(2)} vs ${author!.toFixed(2)} on ${t.def.name}`);
    assert.ok(best(ais[4]) > author! * 1.4, `1 %: ${best(ais[4]).toFixed(2)} vs ${author!.toFixed(2)} on ${t.def.name}`);
    assert.ok(minGap > CONTACT.radius, `cars never pass through each other (closest ${minGap.toFixed(2)} m)`);
  }
});

test('equal AI cars starting nose to tail get past each other or follow, without wrecking: all finish', () => {
  const t = getSampleTrack(1);
  // The slow car is at the front: the faster ones behind must find a way by.
  const { ais } = race(t, [0.3, 0.9, 0.9, 0.9], 2, 400);
  for (const a of ais) assert.equal(a.session.phase, 'finished', `${a.name} finished`);
  const end = (a: AiDriver) => a.session.runEnd ?? Infinity;
  assert.ok(ais.slice(1).some((a) => end(a) < end(ais[0])), 'at least one fast car passed the slow one');
});
