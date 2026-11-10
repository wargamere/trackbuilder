import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { DEFAULT_SETUP, SETUP, type CarSetup } from '../src/config/race.ts';
import { builtInTracks, getSampleTrack } from '../src/editor/pipeline.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { cornerSpeed, topSpeed } from '../src/race/racingLine.ts';
import { bestWing, suggestedSetup, wingLapTimes } from '../src/race/strategy.ts';

const DT = 1 / HANDLING.tickRate;

/**
 * Flat out on an endless straight: the car is held on one spot of the start
 * straight, keeping its speed, so only the engine, drag and gears matter.
 * Top speed reached (m/s), and 0–30 m/s time (s).
 */
function straightLine(setup: CarSetup): { top: number; to30: number } {
  const car = new CarPhysics(getSampleTrack(0));
  car.setup = setup;
  car.placeAt(10);
  const st = car.state;
  const { x, z, heading } = st;
  let to30 = 0;
  for (let i = 0; i < 60 * HANDLING.tickRate; i++) {
    car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    const v = st.speed;
    Object.assign(st, { x, z, heading, yawRate: 0, vx: Math.cos(heading) * v, vz: Math.sin(heading) * v });
    if (!to30 && v >= 30) to30 = i * DT;
  }
  return { top: st.speed, to30 };
}

test('the wing: low drag is quicker on the straights, downforce holds more speed through fast bends', () => {
  assert.ok(topSpeed(0.82) > topSpeed() && topSpeed() > topSpeed(1.18));
  // The physics agrees with topSpeed().
  for (const w of ['low', 'medium', 'high'] as const) {
    const top = straightLine({ ...DEFAULT_SETUP, wing: w }).top;
    const want = topSpeed(SETUP.wing[w].drag);
    assert.ok(Math.abs(top - want) < 0.3, `${w} wing: ${top.toFixed(2)} m/s, topSpeed() ${want.toFixed(2)}`);
  }
  // A fast bend (radius 150 m): high wing faster, low slower; a slow one (30 m) hardly differs.
  const fast = (df: number) => cornerSpeed(1 / 150, 0, 1, df);
  assert.ok(fast(0.05) > fast(0) * 1.02 && fast(-0.05) < fast(0) * 0.98, `${fast(-0.05).toFixed(1)} / ${fast(0).toFixed(1)} / ${fast(0.05).toFixed(1)}`);
  const slow = (df: number) => cornerSpeed(1 / 30, 0, 1, df);
  assert.ok(slow(0.05) / slow(0) < 1.01);
  assert.equal(cornerSpeed(1 / 150, 0, 1, 0), cornerSpeed(1 / 150, 0, 1), 'no wing: as before');
});

test('gears: short gears get going quicker but top out sooner', () => {
  const short = straightLine({ ...DEFAULT_SETUP, gears: 'short' });
  const long = straightLine({ ...DEFAULT_SETUP, gears: 'long' });
  assert.ok(short.to30 < long.to30, `0–30 m/s: short ${short.to30.toFixed(2)} s, long ${long.to30.toFixed(2)} s`);
  assert.ok(short.top < long.top, `top: short ${short.top.toFixed(1)}, long ${long.top.toFixed(1)} m/s`);
});

test('each wing is the quickest somewhere: Monza low, Budapest high; the AI drives the one it picks cleanly', () => {
  const tracks = new Map(builtInTracks().map((b) => [b.def.name, b.track()] as const));
  const wing = (n: string) => bestWing(tracks.get(n)!);
  assert.equal(wing('Monza'), 'low');
  assert.equal(wing('Las Vegas'), 'low');
  assert.equal(wing('Budapest'), 'high');
  const count = { low: 0, medium: 0, high: 0 };
  for (const t of tracks.values()) count[bestWing(t)]++;
  for (const w of ['low', 'medium', 'high'] as const) assert.ok(count[w] >= 8, `${w} wing best on ${count[w]} tracks`);
  assert.deepEqual(suggestedSetup(tracks.get('Monza')!), { wing: 'low', gears: 'medium', brakes: 'balanced' });
  // The difference is worth having but not huge: tenths a lap.
  const m = wingLapTimes(tracks.get('Monza')!);
  assert.ok(m.medium - m.low > 0.03 && m.medium - m.low < 1, `Monza low wing ${(m.medium - m.low).toFixed(2)} s quicker`);
  // An AI on each wing laps a sample track cleanly, and on its picked wing it's no slower than on medium.
  const t = getSampleTrack(1);
  const lap = (w: CarSetup['wing']) => new AuthorLap(t, 1, false, false, { ...DEFAULT_SETUP, wing: w }).finish();
  const laps = { low: lap('low'), medium: lap('medium'), high: lap('high') };
  for (const [w, x] of Object.entries(laps)) assert.ok(x !== null, `${w} wing: a clean lap`);
  assert.ok((laps[bestWing(t)] ?? Infinity) <= (laps.medium ?? 0) + 0.02, `${t.def.name}: ${JSON.stringify(laps)}`);
});
