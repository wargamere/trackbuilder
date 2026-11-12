import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STANDARD_CAR } from '../src/car/physics.ts';
import { newCareer, cleanCareer, aiDifficulty, carPerformance, lineup } from '../src/career/career.ts';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { aiPace, aiPerformance } from '../src/race/ai.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { suggestedSetup } from '../src/race/strategy.ts';
const start = (difficulty: number) => newCareer({ name: 'Expert', team: 'kestrel', difficulty, length: 'short', rounds: 'short' }, 445);

test('the original 1–100 pace curve and physical hardware remain unchanged', () => {
  const expected = [[0, .33, .4, .45], [.25, .53, .63, .55], [.5, .68, .79, .6], [.75, .84, .9, .75], [1, 1, 1, .9]];
  for (const [difficulty, grip, speed, brake] of expected) {
    assert.deepEqual(aiPace(difficulty), { grip, maxSpeed: 58 * speed, brake });
    assert.equal(aiPerformance(difficulty, STANDARD_CAR), STANDARD_CAR);
  }
  const s = start(100); for (let r = 0; r < 24; r++) for (const e of lineup(s)) assert.ok(aiDifficulty(s, r, e.id) <= 1);
});
test('101–110 adds increasing expert performance and survives save reload', () => {
  const hardware = { grip: .76, pull: .712, top: .88 };
  const middle = aiPerformance(1.05, hardware), top = aiPerformance(1.1, hardware);
  for (const key of ['grip','pull','top'] as const) { assert.ok(middle[key] > hardware[key]); assert.ok(top[key] > middle[key]); }
  assert.equal(aiPace(1.1).brake, 1); assert.deepEqual(aiPerformance(2), aiPerformance(1.1));
  const s = start(110); assert.equal(cleanCareer(JSON.parse(JSON.stringify(s)))!.difficulty, 110);
  assert.ok(aiDifficulty(s, 0, 'lin') > 1); assert.ok(aiDifficulty(s, 0, 'lin') <= 1.1);
});
test('expert qualifying is measurably quicker and a 52% car has a moderate lap-time deficit at 100%', () => {
  const save = start(100); save.cars.kestrel = .52; const weak = carPerformance(save, 'alm');
  for (const id of ['world-au-1953', 'world-it-1922', 'world-gb-1948']) {
    const t = builtInTracks().find(t => t.def.id === id)!.track(), setup = suggestedSetup(t);
    const normal = new AuthorLap(t, 1, false, false, setup).finish()!;
    const expert = new AuthorLap(t, 1.1, false, false, setup).finish()!;
    const underdog = new AuthorLap(t, 1, false, false, setup, weak).finish()!;
    assert.ok(expert < normal * .985, `${id}: 110% ${expert.toFixed(3)} vs 100% ${normal.toFixed(3)}`);
    const gap = underdog / normal - 1;
    assert.ok(gap > .025 && gap < .09, `${id}: 52% car ${underdog.toFixed(3)} vs 100% car ${normal.toFixed(3)} (${(gap * 100).toFixed(1)}% gap)`);
  }
});
