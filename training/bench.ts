import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { defaultIntent } from '../src/ai/intents.ts';
import { newDrivingPolicy, loadPolicy } from '../src/ai/nn.ts';
import { Observer } from '../src/ai/observe.ts';
import { NO_INPUT } from '../src/car/physics.ts';
import { argumentsOf, integer, jsonFile, revision } from './cli.ts';
import { DrivingEnv } from './env.ts';
import { procedural } from './trackCorpus.ts';

const args = argumentsOf(), iterations = integer(args, 'iterations', 1000, 100, 100000);
const network = args.has('weights') ? loadPolicy(JSON.parse(await readFile(args.get('weights')!, 'utf8'))).network : newDrivingPolicy(42);
const track = procedural('validation', 0).build(), field = 24;
const env = new DrivingEnv(track, Array.from({ length: field }, () => ({ brain: 'external', difficulty: 1 })), { seed: 42 });
const observers = env.agents.map(() => new Observer(track)), inputs = observers.map((o) => o.values);
const workspaces = env.agents.map(() => network.workspace()), outputs = env.agents.map(() => new Float32Array(2));
const context = defaultIntent(), timings = [];
for (let tick = -100; tick < iterations; tick++) {
  const start = performance.now();
  for (let i = 0; i < field; i++) observers[i].fill(env.agents[i].car, env.states, NO_INPUT, context);
  network.forwardBatch(inputs, workspaces, outputs);
  if (tick >= 0) timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const average = timings.reduce((a, b) => a + b, 0) / timings.length;
const report = { kind: 'Node observation + inference microbenchmark, not browser race-frame timing', revision: revision(), engine: process.version, parameters: network.parameters.length, float32Bytes: network.parameters.byteLength, iterations, field, averagePolicyBatchMs: average, p95PolicyBatchMs: timings[Math.floor(timings.length * 0.95)], estimated19CarAmortized120HzMs: average * 19 / 24 / 4, estimated23CarAmortized120HzMs: average * 23 / 24 / 4, usesDecisionStaggering: false, runtimeGatePassed: false, note: 'All decisions currently align: peak cost, allocation profiling and an actual browser race must pass before promotion.' };
await jsonFile(args.get('out') ?? 'training/runs/bench.json', report);
console.log(JSON.stringify(report, null, 2));
