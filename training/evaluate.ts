import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { LearnedDriver } from '../src/ai/learnedDriver.ts';
import { defaultIntent } from '../src/ai/intents.ts';
import { loadPolicy } from '../src/ai/nn.ts';
import { aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { DrivingEnv, DT, type AgentSpec } from './env.ts';
import { argumentsOf, integer, jsonFile, revision } from './cli.ts';
import { corpus, procedural } from './trackCorpus.ts';
import { pendingGates, raceMetrics } from './metrics.ts';
import { updateIntent } from './teacher.ts';

const args = argumentsOf(), brain = args.get('brain') ?? 'classic', suite = args.get('suite') ?? 'quick';
if (brain !== 'classic' && brain !== 'learned') throw new Error('--brain must be classic or learned');
if (suite !== 'quick' && suite !== 'full') throw new Error('--suite must be quick or full');
const raw = brain === 'learned' ? await readFile(args.get('weights') ?? 'training/runs/bc/policy.json', 'utf8') : null;
const loaded = raw ? loadPolicy(JSON.parse(raw)) : null;
const seed = integer(args, 'seed', 20261111, 0, 0xffffffff), seconds = integer(args, 'seconds', 180, 20, 1800);
const started = performance.now(), laps = [];
const cases = suite === 'quick' ? Array.from({ length: 6 }, (_, i) => procedural('validation', i)) : corpus('acceptance');
for (const entry of cases) {
  const track = entry.build();
  const env = new DrivingEnv(track, [{ brain: brain === 'classic' ? 'classic' : 'external', difficulty: 1 }], { seed, laps: 2, seconds });
  const policy = loaded ? new LearnedDriver(track, loaded.network) : null, intent = defaultIntent();
  while (!env.done) env.step((a, i) => policy!.drive(a.car, env.states, DT, updateIntent(env, i, intent)));
  laps.push({ key: entry.key, split: entry.split, ...raceMetrics(env) });
  console.log(`${brain} ${entry.key}: ${env.agents[0].session.best?.time?.toFixed(2) ?? 'no valid lap'}s`);
}
const starts = [];
for (const entry of corpus('diagnostic')) for (const field of [20, 24]) for (const difficulty of [0.75, 1]) {
  const track = entry.build(), player = field - 1;
  const specs: AgentSpec[] = Array.from({ length: field }, (_, i) => ({ brain: brain === 'classic' && i !== player ? 'classic' : 'external', difficulty, player: i === player }));
  const env = new DrivingEnv(track, specs, { seed, laps: 10, seconds: 33 });
  const policies = env.agents.map(() => loaded ? new LearnedDriver(track, loaded.network) : null);
  const intents = env.agents.map(() => defaultIntent(difficulty));
  const players = new Set([env.states[player]]), standIn = new RacingDriver(track, aiPace(difficulty, track));
  const snapshots = [];
  while (!env.done) {
    env.step((a, i) => i === player ? standIn.drive(a.car.state) : policies[i]!.drive(a.car, env.states, DT, updateIntent(env, i, intents[i]), players));
    if ([3, 8, 13, 18, 33].some((s) => env.tick === s * 120)) snapshots.push({ secondsSinceGo: env.tick / 120 - 3, playerPosition: env.order().indexOf(player) + 1, playerSpeedKmh: env.states[player].speed * 3.6 });
  }
  starts.push({ key: entry.key, difficulty, standIn: 'RacingDriver player, no traffic avoidance or grid-slot handicap; diagnostic, not a replay of recorded inputs', snapshots, ...raceMetrics(env) });
  console.log(`${brain} start ${field} cars, difficulty ${difficulty}: P${env.order().indexOf(player) + 1}, ${env.playerContacts} firm player contacts`);
}
const report = { kind: `${suite} phase 0/1 diagnostic; not the full promotion matrix`, revision: revision(), brain, suite, seed, weightsSha256: raw ? createHash('sha256').update(raw).digest('hex') : null, metadata: loaded?.artifact.metadata ?? null, laps, starts, wallSeconds: (performance.now() - started) / 1000, gates: pendingGates() };
await jsonFile(args.get('out') ?? `training/runs/${brain}-${suite}.json`, report);
