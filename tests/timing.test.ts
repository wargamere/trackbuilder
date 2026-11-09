import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatGap, GapTracker } from '../src/race/timing.ts';

test('timing gaps: how long ago the car ahead passed where the car behind is now', () => {
  const g = new GapTracker(2, 10);
  // Car 0 at 20 m/s, car 1 at 18 m/s, both from the line at t = 0.
  for (let t = 0; t <= 20.0001; t += 0.05) {
    g.update(0, 20 * t, t);
    g.update(1, 18 * t, t);
  }
  const now = 20;
  const d0 = 400;
  const d1 = 360;
  // Car 1 is at 360 m: car 0 was there at 18 s, so 2 s behind.
  assert.ok(Math.abs((g.gap(1, d1, 0, d0, now) ?? NaN) - 2) < 0.01);
  assert.ok(Math.abs((g.gap(0, d0, 1, d1, now) ?? NaN) + 2) < 0.01, 'and the one ahead is 2 s ahead');
  // Between marks, and past the last one.
  assert.ok(Math.abs((g.timeAt(0, 395) ?? NaN) - 19.75) < 0.01);
  assert.equal(g.timeAt(1, 361), null, 'not there yet');
  assert.equal(g.gap(1, -5, 0, 400, now), null, 'before the line: no gap');
});

test('gaps on screen: tenths, with a sign, or laps when a lap or more apart', () => {
  assert.equal(formatGap(1.84, 30, 1000, 'LAP', 'LAPS'), '+1.8');
  assert.equal(formatGap(-0.42, -10, 1000, 'LAP', 'LAPS'), '−0.4');
  assert.equal(formatGap(80, 1200, 1000, 'LAP', 'LAPS'), '+1 LAP');
  assert.equal(formatGap(null, -2500, 1000, 'LAP', 'LAPS'), '−2 LAPS');
  assert.equal(formatGap(null, 5, 1000, 'LAP', 'LAPS'), '');
});
