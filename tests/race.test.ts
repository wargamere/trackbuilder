import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { RACE } from '../src/config/race.ts';
import { getSampleTrack, trackFromStroke } from '../src/editor/pipeline.ts';
import type { Track } from '../src/track/track.ts';
import { GhostRecorder, ghostPose } from '../src/race/ghost.ts';
import { formatTime, RaceSession, type Progress, type RaceEvent } from '../src/race/session.ts';
import { botInput } from '../src/race/bot.ts';

const DT = 1 / HANDLING.tickRate;
const COUNTDOWN_TICKS = RACE.countdown * HANDLING.tickRate;

/** Feeds the session a car moving `speed` m/s along the centre line from `s0`. */
function constantSpeed(length: number, speed: number, ticks: number, s0 = length - 8, jumpAt?: { tick: number; by: number }) {
  const session = new RaceSession(length);
  const events: RaceEvent[] = [];
  let s = s0;
  for (let k = 0; k < ticks; k++) {
    const prev: Progress = { s, lateral: 0, along: speed };
    if (session.canDrive) s = (s + speed * DT) % length;
    if (jumpAt && session.tick === jumpAt.tick) s = (s + jumpAt.by) % length;
    session.step(prev, { s, lateral: 0, along: speed }, events);
  }
  return { session, events };
}

test('countdown runs 3-2-1-GO before the car may move', () => {
  const { events, session } = constantSpeed(1000, 30, COUNTDOWN_TICKS + 5);
  const counts = events.filter((e) => e.type === 'count').map((e) => (e.type === 'count' ? e.n : 0));
  assert.deepEqual(counts, [3, 2, 1]);
  assert.ok(events.some((e) => e.type === 'go'));
  assert.ok(session.canDrive);
});

test('lap times are exact, to well under a tick', () => {
  const L = 1000;
  const speed = 37; // m/s: crossings fall part-way through ticks
  const { session } = constantSpeed(L, speed, COUNTDOWN_TICKS + Math.ceil(((L * 3 + 50) / speed) * HANDLING.tickRate));
  assert.equal(session.laps.length, 3);
  for (const t of session.laps) assert.ok(Math.abs(t - L / speed) < 1e-6, `lap ${t} vs ${L / speed}`);
  assert.equal(session.phase, 'finished');
  assert.ok(Math.abs((session.totalTime() ?? 0) - (3 * L) / speed) < 1e-6);
});

test('a lap that cuts across to a later stretch (skipping a checkpoint) counts towards the race, but its time never does', () => {
  const L = 1000;
  // Mid-way through lap 1, jump 150 m ahead in one tick (a shortcut across the grass).
  const lapStartTick = COUNTDOWN_TICKS + Math.ceil((8 / 30) * HANDLING.tickRate);
  const { session, events } = constantSpeed(L, 30, COUNTDOWN_TICKS + 9000, L - 8, { tick: lapStartTick + 400, by: 150 });
  const laps = events.filter((e): e is Extract<RaceEvent, { type: 'lap' }> => e.type === 'lap');
  assert.equal(laps.length, 2, 'the shortcut lap counts as a lap');
  assert.ok(laps[0].missed && !laps[0].valid && !laps[0].best, 'the shortcut lap is marked invalid');
  assert.ok(Math.abs(laps[0].time - (L - 150) / 30) < 0.05);
  assert.ok(laps[1].valid && !laps[1].missed && Math.abs(laps[1].time - L / 30) < 1e-6, 'a full lap counts normally');
  assert.ok(Math.abs(session.bestOfRun()! - L / 30) < 1e-6, 'the best lap is a full one');
  assert.equal(events.filter((e) => e.type === 'missedCheckpoint').length, 1, 'the skip is flagged once, as it happens');
});

test('after skipping a checkpoint, race distance (and so the race position) keeps growing', () => {
  const L = 1000;
  const session = new RaceSession(L, null, 3, 12, 0);
  const events: RaceEvent[] = [];
  let s = L - 8;
  let last = -Infinity;
  let jumped = false;
  for (let k = 0; k < HANDLING.tickRate * 40; k++) {
    const prev: Progress = { s, lateral: 0, along: 30 };
    s = (s + 30 * DT) % L;
    if (!jumped && session.lapStart !== null && s > 250) {
      s += 150;
      jumped = true;
    }
    session.step(prev, { s, lateral: 0, along: 30 }, events);
    const d = session.raceDistance(s);
    if (s > 450 && s < 950) assert.ok(d > last, `race distance grows at s = ${s.toFixed(0)}`);
    last = d;
  }
});

test('running far wide past a checkpoint (beyond the run-off) still completes the lap, marked invalid', () => {
  const L = 1000;
  const session = new RaceSession(L, null, 2, 12, 0);
  const events: RaceEvent[] = [];
  let s = L - 8;
  for (let k = 0; k < HANDLING.tickRate * 80 && session.phase !== 'finished'; k++) {
    const prev: Progress = { s, lateral: 0, along: 30 };
    s = (s + 30 * DT) % L;
    // Out in a field (40 m off the road) around the first checkpoint of lap 1.
    const wide = session.laps.length === 0 && session.lapStart !== null && s > 80 && s < 120;
    session.step(prev, { s, lateral: wide ? 46 : 0, along: 30 }, events);
  }
  const laps = events.filter((e): e is Extract<RaceEvent, { type: 'lap' }> => e.type === 'lap');
  assert.equal(laps.length, 2);
  assert.ok(laps[0].missed && !laps[0].valid);
  assert.ok(laps[1].valid);
});

test('split deltas compare against the best lap', () => {
  const L = 1000;
  const { session } = constantSpeed(L, 30, COUNTDOWN_TICKS + 4600);
  assert.ok(session.best);
  const events: RaceEvent[] = [];
  const next = new RaceSession(L, session.best);
  let s = L - 8;
  for (let k = 0; k < COUNTDOWN_TICKS + 4200; k++) {
    const prev = { s, lateral: 0, along: 32 };
    if (next.canDrive) s = (s + 32 * DT) % L;
    next.step(prev, { s, lateral: 0, along: 32 }, events);
  }
  // The first lap's splits (later laps compare against the new best set by lap 1).
  const splits = events.filter((e) => e.type === 'split').slice(0, RACE.checkpoints - 1);
  assert.equal(splits.length, RACE.checkpoints - 1);
  for (const e of splits) if (e.type === 'split') assert.ok(e.delta !== null && e.delta < 0, 'faster car is ahead at every split');
});

test('a checkpoint exactly on a projected vertex counts despite sub-nanometre rounding', () => {
  const L = 1931.040790003997;
  const session = new RaceSession(L, null, 1, 12, 0), events: RaceEvent[] = [];
  const p = (s: number): Progress => ({ s, lateral: 0, along: 27 });
  session.step(p(L - .1), p(.1), events);
  for (let k = 1; k < RACE.checkpoints; k++) {
    const mark = L * k / RACE.checkpoints;
    // The locator can land on the same vertex rounded a little below the gate.
    session.step(p(mark - .1405254158664), p(mark - 1e-13), events);
    session.step(p(mark - 1e-13), p(mark + .15), events);
  }
  session.step(p(L - .1), p(.1), events);
  assert.deepEqual(session.lapValid, [true]);
  assert.equal(events.filter(e => e.type === 'split').length, RACE.checkpoints - 1, 'each gate counts once');
  assert.ok(!events.some(e => e.type === 'missedCheckpoint'));
});

test('the bot completes three valid laps, and the ghost replays the best one', () => {
  const t = getSampleTrack(0);
  const car = new CarPhysics(t);
  const session = new RaceSession(t.center.length);
  const rec = new GhostRecorder();
  const events: RaceEvent[] = [];
  const positions: { time: number; x: number; z: number }[] = [];
  let ghost = null as ReturnType<GhostRecorder['take']> | null;
  let bestPositions: typeof positions = [];
  let lapStart = 0;
  const progress = (): Progress => {
    const st = car.state;
    const tan = t.center.tangents[st.trackIndex];
    return { s: st.s, lateral: st.lateral, along: st.vx * tan.x + st.vz * tan.y };
  };
  for (let k = 0; k < HANDLING.tickRate * 200 && session.phase !== 'finished'; k++) {
    const prev = progress();
    car.step(session.canDrive ? botInput(car.state, t) : { throttle: 0, brake: 0, steer: 0, handbrake: false });
    events.length = 0;
    session.step(prev, progress(), events);
    for (const e of events) {
      if (e.type === 'lap' && e.best) {
        ghost = rec.take();
        bestPositions = positions.slice();
      }
      if (e.type === 'lapStart' || e.type === 'lap') {
        lapStart = session.lapStart ?? 0;
        rec.start(session.tick * DT - lapStart);
        positions.length = 0;
      }
    }
    if (session.lapStart !== null) {
      rec.push(car.state.x, car.state.z, car.state.heading);
      positions.push({ time: session.tick * DT - lapStart, x: car.state.x, z: car.state.z });
    }
  }
  assert.equal(session.phase, 'finished');
  assert.equal(session.laps.length, 3);
  for (const lap of session.laps) assert.ok(lap > 20 && lap < 70, `lap ${lap}`);
  // Laps 2 and 3 start rolling, so they are faster than lap 1 and nearly identical.
  assert.ok(Math.abs(session.laps[1] - session.laps[2]) < 0.5);
  assert.ok(ghost);
  if (!ghost) return;
  assert.ok(ghost.t0 > 0 && ghost.t0 <= DT + 1e-9, 'first sample lands within the crossing tick');
  // At any recorded moment, the ghost is exactly where the car was at that point of its best lap.
  for (const k of [0, 600, 1200, bestPositions.length - 1]) {
    const p = bestPositions[k];
    const g = ghostPose(ghost, p.time);
    assert.ok(g);
    if (g) assert.ok(Math.hypot(g.x - p.x, g.z - p.z) < 0.01, `sample ${k}`);
  }
  // Between samples it interpolates smoothly.
  const mid = ghostPose(ghost, (bestPositions[600].time + bestPositions[601].time) / 2);
  assert.ok(mid && Math.hypot(mid.x - (bestPositions[600].x + bestPositions[601].x) / 2, mid.z - (bestPositions[600].z + bestPositions[601].z) / 2) < 0.01);
});

test('time formatting', () => {
  assert.equal(formatTime(83.456), '1:23.45');
  assert.equal(formatTime(5.009), '0:05.00');
  assert.equal(formatTime(null), '–:––.––');
});

/** Runs the bot through a full session and returns it. */
function botRun(t: Track) {
  const car = new CarPhysics(t);
  const session = new RaceSession(t.center.length);
  const events: RaceEvent[] = [];
  let grassTicks = 0;
  for (let k = 0; k < HANDLING.tickRate * 300 && session.phase !== 'finished'; k++) {
    const st = car.state;
    const tan = t.center.tangents[st.trackIndex];
    const prev = { s: st.s, lateral: st.lateral, along: st.vx * tan.x + st.vz * tan.y };
    car.step(session.canDrive ? botInput(car.state, t) : { throttle: 0, brake: 0, steer: 0, handbrake: false });
    const tan2 = t.center.tangents[car.state.trackIndex];
    session.step(prev, { s: car.state.s, lateral: car.state.lateral, along: car.state.vx * tan2.x + car.state.vz * tan2.y }, events);
    if (car.state.grass > 0) grassTicks++;
  }
  return { session, events, grassTicks };
}

test('a figure-eight: driving straight over the crossroads keeps the car on its own stretch', () => {
  const pts = Array.from({ length: 401 }, (_, i) => {
    const t = i / 400 + 0.25;
    return { x: Math.sin(t * Math.PI * 2) * 220, y: Math.sin(t * Math.PI * 4) * 120 };
  });
  const res = trackFromStroke(pts, 'eight');
  assert.ok(res.ok);
  if (!res.ok) return;
  const { session, events, grassTicks } = botRun(res.track);
  assert.equal(session.phase, 'finished');
  assert.equal(session.laps.length, 3);
  assert.ok(!events.some((e) => e.type === 'lap' && e.missed), 'no checkpoint was missed at the crossing');
  assert.equal(grassTicks, 0);
});

test('practice: no countdown, lap after lap, never finished, bests still kept', () => {
  const L = 1000;
  const session = new RaceSession(L, null, Infinity, 12, 0);
  assert.equal(session.phase, 'racing');
  assert.ok(session.canDrive, 'drive straight away');
  const events: RaceEvent[] = [];
  let s = L - 8;
  const speed = 40;
  // About eight laps.
  for (let k = 0; k < Math.round(((8 * L) / speed) * HANDLING.tickRate); k++) {
    const prev: Progress = { s, lateral: 0, along: speed };
    s = (s + speed * DT) % L;
    session.step(prev, { s, lateral: 0, along: speed }, events);
  }
  assert.ok(!events.some((e) => e.type === 'count' || e.type === 'go'), 'no countdown');
  assert.ok(session.laps.length >= 7, `${session.laps.length} laps`);
  assert.notEqual(session.phase, 'finished');
  assert.ok(!events.some((e) => e.type === 'finished'));
  assert.ok(session.best && Math.abs(session.best.time - L / speed) < 0.01);
});

test('track limits: going fully off the track voids that lap, not the others', () => {
  const L = 1000;
  const session = new RaceSession(L, null, 3, 12, 0);
  const events: RaceEvent[] = [];
  let s = L - 8;
  const speed = 40;
  const lapTicks = (L / speed) * HANDLING.tickRate;
  for (let k = 0; k < Math.round(3.3 * lapTicks); k++) {
    const prev: Progress = { s, lateral: 0, along: speed };
    s = (s + speed * DT) % L;
    // During the second lap, cut across for half a second.
    const lap = (k * speed * DT - 8) / L;
    const offTrack = lap > 1.4 && lap < 1.4 + (0.5 * speed) / L;
    session.step(prev, { s, lateral: offTrack ? 14 : 0, along: speed, offTrack }, events);
  }
  assert.equal(events.filter((e) => e.type === 'trackLimits').length, 1);
  assert.deepEqual(session.lapValid, [true, false, true]);
  const laps = events.filter((e): e is Extract<RaceEvent, { type: 'lap' }> => e.type === 'lap');
  assert.equal(laps[1].valid, false);
  assert.equal(laps[1].best, false);
  assert.equal(session.phase, 'finished', 'an invalid lap still counts towards the race distance');
  assert.ok(session.bestOfRun() !== null);
  // A blip shorter than the grace time doesn't count.
  const blip = new RaceSession(L, null, 3, 12, 0);
  const ev2: RaceEvent[] = [];
  let s2 = L - 8;
  for (let k = 0; k < Math.round(1.5 * lapTicks); k++) {
    const prev: Progress = { s: s2, lateral: 0, along: speed };
    s2 = (s2 + speed * DT) % L;
    blip.step(prev, { s: s2, lateral: 0, along: speed, offTrack: k === Math.round(lapTicks) }, ev2);
  }
  assert.ok(!ev2.some((e) => e.type === 'trackLimits'));
});

test('the bot drives clean laps (no track-limit breaches) on every sample', () => {
  for (let i = 0; i < 3; i++) {
    const t = getSampleTrack(i);
    const car = new CarPhysics(t);
    let off = 0;
    for (let k = 0; k < HANDLING.tickRate * 60; k++) {
      car.step(botInput(car.state, t));
      if (car.state.offTrack) off++;
    }
    assert.equal(off, 0, `${t.def.name}: off track for ${off} ticks`);
  }
});
