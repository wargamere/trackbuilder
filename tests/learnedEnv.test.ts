import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrivingEnv } from '../training/env.ts';
import { procedural, corpus, requireTrainingTrack, corpusSignature } from '../training/trackCorpus.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { collect } from '../training/teacher.ts';
import { newDrivingPolicy } from '../src/ai/nn.ts';

test('learned migration: held-out tracks cannot enter teacher collection', () => {
  assert.throws(() => requireTrainingTrack(procedural('validation', 1)), /held-out/);
  assert.throws(() => requireTrainingTrack(procedural('acceptance', 1)), /held-out/);
  requireTrainingTrack(procedural('train', 1));
  const splits = ['train', 'validation', 'acceptance'] as const;
  const seeds = splits.flatMap((s) => Array.from({ length: 60 }, (_, i) => procedural(s, i).seed));
  assert.equal(new Set(seeds).size, seeds.length);
  assert.equal(new Set(corpus('train').map((c) => c.style).filter(Boolean)).size, 6);
  assert.ok(corpus('train').length >= 3000);
  assert.ok(corpus('train').every((c) => c.source !== 'world'));
  assert.equal(corpusSignature(corpus('acceptance')), corpusSignature(corpus('acceptance')));
});

test('learned migration: real physics environment replays seeded 24-car starts exactly', () => {
  const track = getSampleTrack(0);
  const specs = Array.from({ length: 24 }, (_, i) => ({ brain: 'classic' as const, difficulty: 0.8, player: i === 23 }));
  const first = new DrivingEnv(track, specs, { seed: 42, weather: 'changing', seconds: 30, damage: true });
  const second = new DrivingEnv(track, specs, { seed: 42, weather: 'changing', seconds: 30, damage: true });
  for (let i = 0; i < 600; i++) { first.step(); second.step(); }
  assert.deepEqual(first.states, second.states);
  assert.deepEqual(first.order(), second.order());
  assert.deepEqual([first.weather.rain, first.weather.lineWet, first.weather.offWet], [second.weather.rain, second.weather.lineWet, second.weather.offWet]);
  assert.equal(first.agents.length, 24);
  assert.ok(first.agents[0].distance > 0, 'cars drove through the start under real physics');
});

test('learned migration: a separate DAgger teacher exactly reproduces solo teacher rollouts at beta one', () => {
  const cases = [{ key: 'unit-test-training', split: 'train' as const, source: 'game' as const, build: () => getSampleTrack(0) }];
  const classic = collect(cases, 82, 8);
  const shadow = collect(cases, 82, 8, newDrivingPolicy(82), 1);
  assert.equal(classic.data.inputs.length, 150);
  assert.deepEqual(shadow.data, classic.data, 'teacher labels and observations must match without moving the learner from the shadow');
  assert.equal(shadow.episodes[0].teacherResetLabelsRejected, 0);
});
