import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carOverlap, collideCars } from '../src/car/contact.ts';
import { CarPhysics, CarState } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { AI, CONTACT } from '../src/config/race.ts';
import { getSampleTrack, SAMPLE_COUNT, trackFromControl, trackFromStroke } from '../src/editor/pipeline.ts';
import { planLapTime, racingLine, speedProfile } from '../src/race/racingLine.ts';
import { AiDriver, aiField, aiPace, gridOrder, gridPlace, qualifyingOrder, YOU } from '../src/race/ai.ts';
import { rng } from '../src/core/random.ts';
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
  let maxOverlap = 0;
  for (let tick = 0; tick < seconds * HANDLING.tickRate; tick++) {
    const prev = ais.map((a) => progressOf(a.car, track));
    for (const a of ais) a.car.step(a.drive(states, DT));
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) collideCars(states[i], states[j]);
    ais.forEach((a, k) => a.session.step(prev[k], progressOf(a.car, track), events));
    // How deep any two cars end up inside each other (after contact has pushed them apart).
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) maxOverlap = Math.max(maxOverlap, carOverlap(states[i], states[j]));
    }
    if (ais.every((a) => a.session.phase === 'finished')) break;
  }
  return { ais, maxOverlap };
}

test('AI pace rises with difficulty, up to the limit of the tyres at 100 %', () => {
  let last = { grip: 0, maxSpeed: 0, brake: 0 };
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const p = aiPace(d);
    assert.ok(p.grip >= last.grip && p.maxSpeed >= last.maxSpeed && p.brake >= last.brake, `pace drops at ${d.toFixed(2)}`);
    last = p;
  }
  assert.ok(aiPace(0).grip < 0.4 && aiPace(0).maxSpeed < HANDLING.maxSpeed * 0.45);
  assert.equal(aiPace(1).grip, 1, 'all the grip there is at 100 %');
  assert.equal(aiPace(1).maxSpeed, HANDLING.maxSpeed);
  assert.deepEqual(aiPace(-1), aiPace(0));
  assert.deepEqual(aiPace(2), aiPace(1.1));
});

test('a difficulty means the same on every track: 75 % laps 6 % off the limit on a twisty track and on a flat-out banked oval alike', () => {
  const oval = trackFromStroke(
    Array.from({ length: 601 }, (_, i) => {
      const a = (i / 600) * Math.PI * 2;
      return { x: Math.cos(a) * 400, y: Math.sin(a) * 300 };
    }),
    'oval',
  );
  assert.ok(oval.ok);
  const banked = trackFromControl({ id: 'oval', name: 'oval', control: oval.track.def.control, options: { banking: 2 } });
  assert.ok(banked.ok);
  for (const t of [...Array.from({ length: SAMPLE_COUNT }, (_, i) => getSampleTrack(i)), banked.track]) {
    const line = racingLine(t);
    const lap = (d: number) => planLapTime(line, speedProfile(t, line, aiPace(d, t)));
    const limit = lap(1);
    for (const [d, ratio] of [[0.25, 1.27], [0.5, 1.14], [0.75, 1.06]]) {
      const r = lap(d) / limit;
      assert.ok(Math.abs(r - ratio) < 0.005, `${t.def.name}: ${d * 100} % plans ${r.toFixed(3)}× the 100 % lap (want ${ratio})`);
    }
  }
  // And driven: the medal (75 %) lap on the oval is really slower than a 100 % one.
  const gold = new AuthorLap(banked.track).finish()!;
  const best = new AuthorLap(banked.track, 1).finish()!;
  assert.ok(gold / best > 1.04 && gold / best < 1.08, `oval gold ${gold.toFixed(2)} vs 100 % ${best.toFixed(2)}`);
});

test('grid slots are staggered two by two behind the line, on the road, and never on top of each other', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const { left, right } = edgeOffsets(t.center);
    const cars: CarState[] = [];
    for (let k = 0; k <= AI.maxOpponents; k++) {
      const g = gridPlace(t, k);
      assert.ok(g.s < 0, 'behind the line');
      const car = new CarPhysics(t);
      car.placeAt(g.s, g.lateral);
      const i = car.state.trackIndex;
      assert.ok(car.state.lateral + HANDLING.halfWidth < left[i] && -car.state.lateral + HANDLING.halfWidth < right[i], `slot ${k} on the road on ${t.def.name}`);
      for (const o of cars) {
        assert.equal(carOverlap(o, car.state), 0, `slot ${k} doesn't touch the others`);
        assert.ok(Math.hypot(o.x - car.state.x, o.z - car.state.z) > 2 * CONTACT.halfWidth + 1, `slot ${k} has room around it`);
      }
      cars.push(car.state);
    }
  }
});

/** A car at (x, z) facing `heading`, moving at (vx, vz). */
const carAt = (x: number, z: number, heading = 0, vx = 0, vz = 0): CarState => Object.assign(new CarState(), { x, z, heading, vx, vz });
/** Do the two car boxes overlap (by more than a hair)? */
const overlapping = (a: CarState, b: CarState): boolean => carOverlap(a, b) > 1e-6;

test('car bodies are boxes: rear-end, side-by-side and corner hits are all caught and pushed apart', () => {
  const { halfLength: HL, halfWidth: HW } = CONTACT;
  // Rear-end: a's nose 1 m into b's tail.
  let a = carAt(0, 0, 0, 20);
  let b = carAt(2 * HL - 1, 0, 0, 10);
  assert.ok(collideCars(a, b) > 0, 'reports the impact');
  assert.ok(b.x - a.x >= 2 * HL - 1e-6, 'no longer overlapping');
  assert.ok(a.vx < 20 && b.vx > 10, 'the one behind slows, the one ahead is pushed');
  assert.ok(Math.abs(a.vx + b.vx - 30) < 1e-9, 'momentum is kept');
  // Side by side, overlapping by 0.3 m in the middle (two circles per car used to miss this).
  a = carAt(0, 0, 0, 30, 1);
  b = carAt(0.5, 2 * HW - 0.3, 0, 30, -1);
  assert.ok(collideCars(a, b) > 0);
  assert.ok(b.z - a.z >= 2 * HW - 1e-6, 'pushed apart sideways');
  assert.ok(Math.abs(a.yawRate) < 0.25 && Math.abs(b.yawRate) < 0.25, `a side-by-side touch barely turns them (${a.yawRate.toFixed(2)}, ${b.yawRate.toFixed(2)})`);
  // Corner into corner, one turned 45°.
  a = carAt(0, 0, 0);
  b = carAt(2 * HL + 0.4, 1.2, Math.PI / 4, -5, 0);
  collideCars(a, b);
  assert.ok(!overlapping(a, b), 'apart after the hit');
  // Just clear: nothing happens, nothing moves.
  a = carAt(0, 0, 0, 10);
  b = carAt(2 * HL + 0.05, 0, 0, 0);
  assert.equal(collideCars(a, b), 0);
  assert.equal(b.x, 2 * HL + 0.05);
});

test('a nose into a car\'s rear corner spins it; a car on a bridge never touches one below', () => {
  const { halfLength: HL, halfWidth: HW } = CONTACT;
  // T-bone the back corner of b (pointing +x) with a moving +z.
  const b = carAt(0, 0, 0);
  const a = carAt(-HL + 0.4, -HW - HL + 0.3, Math.PI / 2, 0, 15);
  const hit = collideCars(a, b);
  assert.ok(hit > 10, `hard hit (${hit.toFixed(1)})`);
  assert.ok(b.vz > 0, 'pushed the way it was hit');
  assert.ok(Math.abs(b.yawRate) > 0.5, `hit behind its middle, it turns (${b.yawRate.toFixed(2)} rad/s)`);
  // Same overlap, but b 6 m up on a bridge.
  const up = carAt(0, 0, 0);
  up.y = 6;
  const below = carAt(1, 0.5, 0, 10);
  assert.equal(collideCars(below, up), 0);
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
    const { ais, maxOverlap } = race(t, [1, 0.75, 0.5, 0.25, 0.01], 2, 400);
    for (const a of ais) assert.equal(a.session.phase, 'finished', `${a.name} (${a.difficulty}) finished on ${t.def.name}`);
    const end = (a: AiDriver) => a.session.runEnd ?? Infinity;
    // Stronger drivers finish ahead (the field starts in difficulty order, fastest at the front).
    for (let k = 1; k < ais.length; k++) assert.ok(end(ais[k - 1]) < end(ais[k]), `${ais[k - 1].difficulty} ahead of ${ais[k].difficulty} on ${t.def.name}`);
    // Best laps against the medal (bot) lap: 100 % beats it, 1 % is far slower.
    const best = (a: AiDriver) => Math.min(...a.session.laps);
    assert.ok(best(ais[0]) < author! * 1.01, `100 %: ${best(ais[0]).toFixed(2)} vs ${author!.toFixed(2)} on ${t.def.name}`);
    assert.ok(best(ais[4]) > author! * 1.4, `1 %: ${best(ais[4]).toFixed(2)} vs ${author!.toFixed(2)} on ${t.def.name}`);
    assert.ok(maxOverlap < 0.15, `cars never end a tick inside each other (deepest ${maxOverlap.toFixed(3)} m)`);
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

test('grid orders: pick puts you in your slot, random shuffles everyone, AI cars otherwise fastest first', () => {
  assert.deepEqual(gridOrder('pick', 3, 1), [YOU, 0, 1, 2]);
  assert.deepEqual(gridOrder('pick', 3, 3), [0, 1, YOU, 2]);
  assert.deepEqual(gridOrder('pick', 3, 99), [0, 1, 2, YOU], 'past the back: the back');
  assert.deepEqual(gridOrder('pick', 3, 0), [YOU, 0, 1, 2], 'before pole: pole');
  assert.deepEqual(gridOrder('pick', 0, 5), [YOU]);
  const r = rng(3);
  const seen = new Set<number>();
  for (let k = 0; k < 40; k++) {
    const o = gridOrder('random', 5, 1, r);
    assert.deepEqual([...o].sort((a, b) => a - b), [YOU, 0, 1, 2, 3, 4], 'everyone exactly once');
    seen.add(o.indexOf(YOU));
  }
  assert.ok(seen.size >= 5, `you start in different slots (${[...seen]})`);
});

test('qualifying order: fastest first, no time at the back (you last among those)', () => {
  const times = new Map<number, number | null>([
    [YOU, 41.2],
    [0, 40.1],
    [1, null],
    [2, 43.0],
    [3, 41.0],
  ]);
  assert.deepEqual(qualifyingOrder(times), [0, 3, YOU, 2, 1]);
  times.set(YOU, null);
  assert.deepEqual(qualifyingOrder(times), [0, 3, 2, 1, YOU]);
});

test('the AI field: fastest first, spread just below the chosen difficulty, names and colours all different', () => {
  const paints = Array.from({ length: 12 }, (_, i) => i);
  const names = 'abcdefghijk'.split('');
  const f = aiField(11, 60, paints, names);
  assert.equal(f.length, 11);
  assert.equal(f[0].difficulty, 0.6);
  assert.ok(Math.abs(f[10].difficulty - (0.6 - AI.spread)) < 1e-9);
  for (let k = 1; k < f.length; k++) assert.ok(f[k].difficulty < f[k - 1].difficulty);
  assert.equal(new Set(f.map((x) => x.name)).size, 11);
  assert.equal(new Set(f.map((x) => x.paint)).size, 11);
  assert.ok(aiField(3, 1, paints, names).every((x) => x.difficulty >= 0), 'never below 0');
});

test('AI qualifying laps: a harder AI sets a faster flying lap', () => {
  const t = getSampleTrack(0);
  const lap = (d: number) => {
    return new AuthorLap(t, d).finish();
  };
  const fast = lap(0.9);
  const slow = lap(0.3);
  assert.ok(fast && slow && fast < slow, `${fast} < ${slow}`);
  // The default is the medal pace.
  assert.equal(new AuthorLap(t).finish(), new AuthorLap(t, AI.medalDifficulty).finish());
});

test('a full grid of twelve cars races two laps on every sample: everyone finishes, nobody drives through anybody', () => {
  for (let si = 0; si < SAMPLE_COUNT; si++) {
    const t = getSampleTrack(si);
    const field = aiField(AI.maxOpponents + 1, 60, [0], ['x']);
    const { ais, maxOverlap } = race(t, field.map((f) => f.difficulty), 2, 500);
    for (const a of ais) assert.equal(a.session.phase, 'finished', `${a.name} ${a.difficulty.toFixed(2)} finished on ${t.def.name}`);
    assert.ok(maxOverlap < 0.15, `deepest overlap ${maxOverlap.toFixed(3)} m on ${t.def.name} (a car driving through another would be a metre or more)`);
  }
});

