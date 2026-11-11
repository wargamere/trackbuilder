import { performance } from 'node:perf_hooks';
import { argumentsOf, integer, jsonFile, revision } from './cli.ts';
import { DrivingEnv } from './env.ts';
import { corpus, corpusSignature, procedural } from './trackCorpus.ts';
import { pendingGates, raceMetrics } from './metrics.ts';

const args = argumentsOf();
const seed = integer(args, 'seed', 20261111, 0, 0xffffffff);
const seconds = integer(args, 'seconds', 180, 10, 1800);
const started = performance.now();
const solo = [];
// Validation, never acceptance: quick development diagnostics cannot burn the untouched test set.
for (let i = 0; i < 6; i++) {
  const entry = procedural('validation', i), track = entry.build();
  const env = new DrivingEnv(track, [{ brain: 'classic', difficulty: 1 }], { seed, laps: 2, seconds });
  while (!env.done) env.step();
  solo.push({ key: entry.key, name: track.def.name, ...raceMetrics(env) });
  console.log(`baseline solo ${i + 1}/6: ${env.agents[0].session.best?.time?.toFixed(2) ?? 'no valid lap'}s`);
}
const starts = [];
for (const entry of corpus('diagnostic')) for (const field of [20, 24]) for (const difficulty of [0.75, 1]) {
  const track = entry.build();
  const env = new DrivingEnv(track, Array.from({ length: field }, (_, i) => ({ brain: 'classic' as const, difficulty, player: i === field - 1 })), { seed, laps: 10, seconds: 33 });
  const snapshots = [];
  // Matched clean-driving stand-in: a separate RacingDriver start scenario is added in phase 1 evaluation.
  for (let tick = 0; tick < 33 * 120; tick++) {
    env.step();
    if ([3, 8, 13, 18, 33].some((s) => env.tick === s * 120)) snapshots.push({ secondsSinceGo: env.tick / 120 - 3, order: env.order(), speedsKmh: env.agents.map((a) => a.car.state.speed * 3.6), distances: env.agents.map((a) => a.distance) });
  }
  starts.push({ key: entry.key, name: track.def.name, difficulty, standIn: 'classic clean driver flagged as player, same grid-slot handicap', snapshots, ...raceMetrics(env) });
  console.log(`baseline start ${field} cars, difficulty ${difficulty}: P${env.order().indexOf(field - 1) + 1}`);
}
const report = {
  version: 1, kind: 'classic baseline, not learned acceptance', revision: revision(), seed,
  corpus: { trainCount: corpus('train').length, validation: corpusSignature(corpus('validation')), acceptance: corpusSignature(corpus('acceptance')), acceptanceInspected: false },
  secondsLimit: seconds, solo, starts, wallSeconds: (performance.now() - started) / 1000, gates: pendingGates(),
};
await jsonFile(args.get('out') ?? 'training/runs/baseline.json', report);
console.log(`Baseline saved (${report.wallSeconds.toFixed(1)}s wall time).`);
