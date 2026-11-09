import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics, NO_INPUT, type CarState } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { PIT_LANE } from '../src/config/race.ts';
import { builtInTracks, getSampleTrack } from '../src/editor/pipeline.ts';
import type { Assists } from '../src/core/settings.ts';
import { AiDriver } from '../src/race/ai.ts';
import { applyAssists } from '../src/race/assists.ts';
import { inBox, pitBox } from '../src/race/pitStop.ts';
import type { Progress } from '../src/race/session.ts';
import { pitLoss } from '../src/race/strategy.ts';
import { laneU, onLane, outerAt, pitLane, pitWallAt, type PitLane } from '../src/track/pitLane.ts';
import { pitLayout } from '../src/track/pits.ts';
import { leftOf, sampleAt } from '../src/track/spline.ts';
import { buildTrack, type Track } from '../src/track/track.ts';

const DT = 1 / HANDLING.tickRate;
const half = HANDLING.halfWidth;

test('every built-in track with pits has a pit lane: boxes in front of the garages, in the full width of the lane', () => {
  let lanes = 0;
  for (const b of builtInTracks()) {
    const t = b.track();
    const pits = pitLayout(t);
    const lane = pitLane(t);
    if (!pits) {
      assert.equal(lane, null, `${b.def.name}: no pits, no lane`);
      continue;
    }
    assert.ok(lane, `${b.def.name}: a pit lane`);
    lanes++;
    assert.equal(lane.side, pits.side);
    assert.ok(lane.entry < lane.wallFrom && lane.wallFrom < lane.wallTo && lane.wallTo < lane.exit);
    assert.ok(lane.wall < lane.inner && lane.inner < lane.fast && lane.fast < lane.box && lane.box < lane.outer);
    assert.ok(lane.boxes.length >= 2, `${b.def.name}: ${lane.boxes.length} boxes`);
    for (const s of lane.boxes) {
      assert.ok(pits.doors.includes(s), 'in front of a garage');
      for (const e of [s - PIT_LANE.boxLength / 2, s + PIT_LANE.boxLength / 2]) {
        assert.ok(pitWallAt(lane, e), `${b.def.name}: box beside the pit wall`);
        assert.ok((outerAt(lane, e) ?? 0) >= lane.box + PIT_LANE.boxWidth / 2, `${b.def.name}: box in the lane's full width`);
      }
    }
    // Each car its own box while there are enough; yours the one nearest the middle.
    const n = lane.boxes.length;
    const mine = new Set(Array.from({ length: n }, (_, k) => pitBox(t, k).s));
    assert.equal(mine.size, n);
    assert.equal(pitBox(t, n).s, pitBox(t, 0).s, 'shared round after that');
  }
  assert.ok(lanes >= 45, `${lanes} lanes`);
});

/** A car `m` m out on the pit side at track position `s`, going `speed` m/s at `angle` rad outwards from the track's direction. */
function launch(t: Track, lane: PitLane, s: number, m: number, speed: number, angle: number): CarPhysics {
  const car = new CarPhysics(t);
  car.placeAt(s, m * lane.side);
  const { t: tan } = sampleAt(t.center, s);
  const l = leftOf(tan);
  const dx = tan.x * Math.cos(angle) + l.x * lane.side * Math.sin(angle);
  const dz = tan.y * Math.cos(angle) + l.y * lane.side * Math.sin(angle);
  const st = car.state;
  st.heading = Math.atan2(dz, dx);
  st.vx = dx * speed;
  st.vz = dz * speed;
  return car;
}

const outOf = (lane: PitLane, st: CarState) => st.lateral * lane.side;

test('the pit wall keeps cars on their own side of it, and the lane’s outer edge keeps them in', () => {
  const t = getSampleTrack(0);
  const lane = pitLane(t)!;
  const mid = (lane.wallFrom + lane.wallTo) / 2;
  const coast = { ...NO_INPUT, throttle: 0.4 };
  // From the track, steering into the pit wall: it bounces off, it doesn't get through.
  let car = launch(t, lane, mid - 30, lane.wall - 2, 30, 0.35);
  let hit = 0;
  for (let k = 0; k < HANDLING.tickRate; k++) {
    car.step(coast);
    hit = Math.max(hit, car.state.wallHit);
    if (pitWallAt(lane, car.state.s)) assert.ok(outOf(lane, car.state) <= lane.wall - half + 0.05, `through the wall from the track: ${outOf(lane, car.state).toFixed(2)}`);
  }
  assert.ok(hit > 0, 'it hit the wall');
  // From the lane, steering into it: the same the other way.
  car = launch(t, lane, mid - 20, lane.fast, 16, -0.35);
  hit = 0;
  for (let k = 0; k < HANDLING.tickRate; k++) {
    car.step(coast);
    hit = Math.max(hit, car.state.wallHit);
    if (pitWallAt(lane, car.state.s)) assert.ok(outOf(lane, car.state) >= lane.inner + half - 0.05, `through the wall from the lane: ${outOf(lane, car.state).toFixed(2)}`);
    assert.equal(car.state.inPits, pitWallAt(lane, car.state.s));
  }
  assert.ok(hit > 0);
  // Into the garages: held in the lane.
  car = launch(t, lane, mid - 20, lane.fast, 16, 0.35);
  for (let k = 0; k < HANDLING.tickRate; k++) {
    car.step(coast);
    assert.ok(outOf(lane, car.state) <= lane.outer - half + 0.05, `out of the lane: ${outOf(lane, car.state).toFixed(2)}`);
  }
});

test('the pit lane is tarmac and inside the track limits, on whatever road', () => {
  const base = getSampleTrack(0);
  const lane = pitLane(base)!;
  const dirt = buildTrack({ ...base.def, id: `${base.def.id}+dirt`, options: { ...base.def.options, road: 'dirt' } });
  for (const t of [base, dirt]) {
    const car = new CarPhysics(t);
    for (let s = lane.entry + 5; s < lane.exit - 5; s += 3) {
      // In the lane (in the boxes' line where it's wide enough), or on the ramp.
      const room = (outerAt(lane, s) ?? lane.wall) - half - 0.6;
      const m = pitWallAt(lane, s) ? Math.max(lane.inner + half + 0.2, Math.min(lane.box, room)) : Math.min(lane.fast, room);
      car.placeAt(s, m * lane.side);
      const st = car.state;
      st.vx = Math.cos(st.heading) * 15;
      st.vz = Math.sin(st.heading) * 15;
      car.step({ ...NO_INPUT, throttle: 1 });
      assert.ok(onLane(lane, st.s, st.lateral), `on the lane at ${s.toFixed(0)}`);
      assert.equal(st.offTrack, false, `inside the track limits at ${s.toFixed(0)} m`);
      assert.equal(st.grass, 0, `${t.options.road}: on tarmac at ${s.toFixed(0)} m`);
    }
  }
});

const progressOf = (car: CarPhysics, track: Track): Progress => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

/** An AI alone in a 3-lap race with tyre wear, called in to stop on the first lap if `stop`; what it did in the pit lane. */
function race(t: Track, stop: boolean) {
  const lane = pitLane(t)!;
  const ai = new AiDriver(t, { name: 'a', paint: 0, difficulty: 0.75, laps: 3, slot: 0, tyreWear: true });
  let called = false;
  let maxInPits = 0;
  let straddled = 0;
  let off = 0;
  let stoppedAt: number | null = null;
  for (let tick = 0; tick < 400 * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, t);
    if (stop && !called && ai.session.lapStart !== null && laneU(lane, ai.car.state.s) < 0 && ai.session.raceDistance(ai.car.state.s) > t.center.length * 0.3) {
      ai.boxCall = ai.car.compound;
      called = true;
    }
    const before = ai.crew?.busy;
    ai.car.step(ai.drive([ai.car.state], DT));
    const st = ai.car.state;
    if (st.inPits) maxInPits = Math.max(maxInPits, st.speed);
    // Never across the pit wall's line while beside it.
    const m = outOf(lane, st);
    if (pitWallAt(lane, st.s) && m > lane.wall - half + 0.1 && m < lane.inner + half - 0.1) straddled++;
    if (st.offTrack && ai.session.phase === 'racing') off++;
    if (!before && ai.crew?.busy) stoppedAt = st.s;
    ai.session.step(prev, progressOf(ai.car, t), []);
  }
  return { ai, time: (ai.session.runEnd ?? NaN) - ai.session.goTime, maxInPits, straddled, off, stoppedAt };
}

test('an AI stop through the pit lane: in over the ramp, down to the limit by the line, stopped in its own box, out over the other ramp', () => {
  const t = getSampleTrack(0);
  const clean = race(t, false);
  const stop = race(t, true);
  for (const r of [clean, stop]) assert.equal(r.ai.session.phase, 'finished');
  assert.equal(clean.ai.crew?.stops, 0);
  assert.equal(stop.ai.crew?.stops, 1, 'one stop');
  const box = pitBox(t, 1);
  assert.ok(stop.stoppedAt !== null && Math.abs(stop.stoppedAt - box.s) < box.length / 2, `stopped at ${stop.stoppedAt?.toFixed(1)} m, its box at ${box.s.toFixed(1)} m`);
  assert.ok(inBox(box, t.center.length, stop.ai.car.state) === false, 'and drove on');
  assert.ok(stop.maxInPits <= PIT_LANE.limit + PIT_LANE.tolerance, `${(stop.maxInPits * 3.6).toFixed(1)} km/h in the pit lane`);
  assert.equal(stop.straddled, 0, 'never across the pit wall');
  assert.equal(stop.off, 0, 'never off the track (the lane counts as track)');
  assert.equal(stop.ai.boxCall, null, 'the call is done with');
  // What it cost: about what the timing tower reckons.
  const lost = stop.time - clean.time;
  const est = pitLoss(t);
  assert.ok(lost > 5 && Math.abs(lost - est) < 2, `lost ${lost.toFixed(2)} s, reckoned ${est.toFixed(2)} s`);
});

test('a full field all in on the same lap, on a track with 4 boxes: everyone stops once, queueing for a shared box, and finishes', () => {
  const t = builtInTracks().find((b) => b.def.name === 'Las Vegas')!.track();
  const lane = pitLane(t)!;
  assert.equal(lane.boxes.length, 4);
  const laps = 4;
  const ais = Array.from({ length: 11 }, (_, k) => new AiDriver(t, { name: `a${k}`, paint: 0, difficulty: 0.9 - k * 0.04, laps, slot: k, box: k + 1, tyreWear: true }));
  const states = ais.map((a) => a.car.state);
  const called = new Set<AiDriver>();
  let fastest = 0;
  let straddled = 0;
  for (let tick = 0; tick < 600 * HANDLING.tickRate && ais.some((a) => a.session.phase !== 'finished'); tick++) {
    const prev = ais.map((a) => progressOf(a.car, t));
    for (const a of ais) {
      if (a.session.laps.length === 1 && !called.has(a)) {
        a.boxCall = a.car.compound;
        called.add(a);
      }
      a.car.step(a.drive(states, DT));
      const st = a.car.state;
      if (st.inPits) fastest = Math.max(fastest, st.speed);
      const m = outOf(lane, st);
      if (pitWallAt(lane, st.s) && m > lane.wall - half + 0.1 && m < lane.inner + half - 0.1) straddled++;
    }
    ais.forEach((a, k) => a.session.step(prev[k], progressOf(a.car, t), []));
  }
  assert.ok(ais.every((a) => a.session.phase === 'finished'), 'everyone finished');
  assert.deepEqual(ais.map((a) => a.crew?.stops), ais.map(() => 1), 'one stop each');
  assert.ok(fastest <= PIT_LANE.limit + PIT_LANE.tolerance, `${(fastest * 3.6).toFixed(1)} km/h in the pit lane`);
  assert.equal(straddled, 0, 'nobody across the pit wall');
});

test('the driving assists leave you alone in the pit lane', () => {
  const t = getSampleTrack(0);
  const lane = pitLane(t)!;
  const on: Assists = { brake: true, steer: true, gears: 'auto', line: 'off' };
  const car = new CarPhysics(t);
  const st = car.state;
  // Beside the garages, rolling along not steering: no tug back towards the line (or the wall).
  car.placeAt(lane.boxes[0], lane.fast * lane.side);
  st.speed = 15;
  const inp = applyAssists(t, st, { ...NO_INPUT, throttle: 0.5 }, on);
  assert.equal(inp.steer, 0);
  assert.equal(inp.brake, 0);
  // On the track beside it, the same: they help.
  car.placeAt(lane.boxes[0], -lane.side * 4);
  st.speed = 15;
  assert.notEqual(applyAssists(t, st, { ...NO_INPUT, throttle: 0.5 }, on).steer, 0);
});
