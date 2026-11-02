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

test('cutting across to a later stretch of track (skipping a checkpoint) does not count', () => {
  const L = 1000;
  // Mid-way through lap 1, jump 150 m ahead in one tick (a shortcut across the grass).
  const lapStartTick = COUNTDOWN_TICKS + Math.ceil((8 / 30) * HANDLING.tickRate);
  const { session, events } = constantSpeed(L, 30, COUNTDOWN_TICKS + 9000, L - 8, { tick: lapStartTick + 400, by: 150 });
  assert.ok(events.some((e) => e.type === 'lapInvalid'), 'shortcut lap is rejected');
  const firstLap = events.find((e) => e.type === 'lap');
  assert.ok(firstLap && firstLap.type === 'lap');
  if (firstLap?.type === 'lap') assert.ok(Math.abs(firstLap.time - L / 30) < 1e-6, 'the next full lap counts normally');
  assert.ok(session.laps.every((t) => t > 30));
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
      if (e.type === 'lapStart' || e.type === 'lap' || e.type === 'lapInvalid') {
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
  assert.ok(!events.some((e) => e.type === 'lapInvalid'), 'no lap was thrown away at the crossing');
  assert.equal(grassTicks, 0);
});
