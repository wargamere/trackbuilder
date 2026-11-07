import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { getSampleTrack, SAMPLE_COUNT, trackFromControl, trackFromStroke } from '../src/editor/pipeline.ts';
import { botInput } from '../src/race/bot.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { racingLine } from '../src/race/racingLine.ts';
import { aiPace } from '../src/race/ai.ts';
import { wrap } from '../src/core/math.ts';
import type { Track } from '../src/track/track.ts';

const curve = (n: number, f: (t: number) => { x: number; y: number }) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** The samples, plus a twisty "flower" with tight hairpins, and the same on an 18 m road. */
function tracks(): Track[] {
  const out = Array.from({ length: SAMPLE_COUNT }, (_, i) => getSampleTrack(i));
  const flower = trackFromStroke(
    curve(600, (t) => {
      const a = t * Math.PI * 2;
      const r = 150 + 70 * Math.sin(a * 5);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    }),
    'flower',
  );
  assert.ok(flower.ok);
  out.push(flower.track);
  const wide = trackFromControl({ id: 'flower-wide', name: 'flower 18 m', control: flower.track.def.control, options: { width: 18 } });
  assert.ok(wide.track);
  out.push(wide.track);
  return out;
}

/** A flying lap (second to third crossing) by `drive`, with track-limit and barrier counts. */
function flyingLap(t: Track, drive: (car: CarPhysics) => void) {
  const car = new CarPhysics(t);
  const L = t.center.length;
  let prev = car.state.s;
  const cross: number[] = [];
  let off = 0;
  let walls = 0;
  for (let k = 0; k < HANDLING.tickRate * 400 && cross.length < 3; k++) {
    drive(car);
    const st = car.state;
    if (cross.length === 2) {
      if (st.offTrack) off++;
      if (st.wallHit > 0) walls++;
    }
    if (prev > L * 0.75 && st.s < L * 0.25) cross.push(k / HANDLING.tickRate);
    prev = st.s;
  }
  assert.equal(cross.length, 3, `${t.def.name}: lapped`);
  return { time: cross[2] - cross[1], off, walls };
}

test('the racing line goes outside, inside at the apex, and outside again, and stays on the road', () => {
  for (const t of tracks()) {
    const line = racingLine(t);
    const c = t.center;
    const n = c.points.length;
    for (let i = 0; i < n; i++) {
      assert.ok(line.offset[i] >= line.lo[i] - 1e-4 && line.offset[i] <= line.hi[i] + 1e-4, `${t.def.name}: on the road at ${i}`);
    }
    let apexInside = 0;
    let entryOutside = 0;
    for (const k of t.kerbs) {
      // A right-hander (+1) has its inside on the right (negative offset).
      const inside = (i: number) => -k.sign * line.offset[wrap(i, n)];
      if (inside(k.apex) > 0.5) apexInside++;
      let outside = false;
      for (let d = 4; d <= 36; d++) if (inside(k.apex - d) < -0.5) outside = true;
      if (outside) entryOutside++;
    }
    const m = t.kerbs.length;
    assert.ok(m > 0);
    assert.ok(apexInside >= Math.ceil(m * 0.8), `${t.def.name}: inside at ${apexInside} of ${m} apexes`);
    assert.ok(entryOutside >= Math.ceil(m * 0.6), `${t.def.name}: in from the outside at ${entryOutside} of ${m} corners`);
    // It bends less than the road does.
    const peak = (a: Float32Array) => a.reduce((x, v) => Math.max(x, Math.abs(v)), 0);
    assert.ok(peak(line.curvature) < peak(c.curvature), `${t.def.name}: tightest bend ${peak(line.curvature).toFixed(3)} vs road ${peak(c.curvature).toFixed(3)}`);
  }
});

test('a 100 % AI on the racing line laps much faster than the old centre-line driver, without breaking track limits', () => {
  for (const t of tracks()) {
    const old = flyingLap(t, (car) => car.step(botInput(car.state, t)));
    const driver = new RacingDriver(t, aiPace(1));
    const ai = flyingLap(t, (car) => car.step(driver.drive(car.state)));
    assert.ok(ai.time < old.time * 0.9, `${t.def.name}: ${ai.time.toFixed(2)} vs old ${old.time.toFixed(2)}`);
    assert.equal(ai.off, 0, `${t.def.name}: no track-limit breaches`);
    assert.equal(ai.walls, 0, `${t.def.name}: no barrier hits`);
    // The AI's flying lap (as qualifying and medals time it) agrees.
    const lap = new AuthorLap(t, 1).finish();
    assert.ok(lap !== null && Math.abs(lap - ai.time) < 0.05, `${t.def.name}: ${lap} vs ${ai.time}`);
  }
});

test('the wider the road, the faster the racing line', () => {
  const all = tracks();
  const narrow = new AuthorLap(all[all.length - 2], 1).finish()!;
  const wide = new AuthorLap(all[all.length - 1], 1).finish()!;
  assert.ok(wide < narrow * 0.98, `18 m road ${wide.toFixed(2)} vs 12 m ${narrow.toFixed(2)}`);
});
