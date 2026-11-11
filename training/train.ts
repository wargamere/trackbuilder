import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { newDrivingPolicy, type PolicyArtifact } from '../src/ai/nn.ts';
import { argumentsOf, integer, jsonFile, revision } from './cli.ts';
import { corpus, corpusSignature, procedural } from './trackCorpus.ts';
import { Adam, cloningLoss, fitNormalization, trainBatch } from './bc.ts';
import { collect } from './teacher.ts';
import { readCheckpoint, saveCheckpoint, type TrainingSettings } from './checkpoint.ts';
import { pendingGates } from './metrics.ts';

const args = argumentsOf(), phase = args.get('phase') ?? 'bc';
if (phase !== 'bc') throw new Error(`Phase '${phase}' is not implemented yet. This increment provides BC + DAgger; PPO and league training remain gated future work.`);
const started = performance.now(), out = resolve(args.get('out') ?? 'training/runs/bc');
const resume = args.get('resume') ? await readCheckpoint(resolve(args.get('resume')!)) : null;
const settings: TrainingSettings = resume?.checkpoint.settings ?? {
  seed: integer(args, 'seed', 20261111, 0, 0xffffffff), tracks: integer(args, 'tracks', 12, 6, 1000),
  seconds: integer(args, 'seconds', 100, 5, 600), updates: integer(args, 'updates', 300, 1, 100000),
  daggerUpdates: integer(args, 'dagger-updates', 150, 1, 100000), iterations: integer(args, 'iterations', 3, 3, 10), batch: integer(args, 'batch', 64, 1, 512),
};
const cases = [...corpus('train', 0).slice(0, 2), ...Array.from({ length: settings.tracks }, (_, i) => procedural('train', i))];
const signature = corpusSignature(cases);
if (resume && resume.checkpoint.policy.metadata.corpus !== signature) throw new Error('Checkpoint training corpus changed');
const network = resume?.network ?? newDrivingPolicy(settings.seed), optimizer = resume?.optimizer ?? new Adam(network.parameters.length);
const first = resume ? null : collect(cases, settings.seed, settings.seconds);
const data = resume?.data ?? first!.data, history = resume?.checkpoint.history ?? [];
const initialLoss = cloningLoss(network, data);
if (!resume) {
  fitNormalization(network, data);
  history.push({ phase: 'teacher collection', episodes: first!.episodes, samples: data.inputs.length });
}
const metadata = (): PolicyArtifact['metadata'] => ({ algorithm: 'behaviour cloning + DAgger', seed: settings.seed, samples: data.inputs.length, updates: optimizer.step, promotion: 'experimental', corpus: signature });
function optimize(updates: number, label: string): void {
  for (let i = 0; i < updates; i++) {
    const loss = trainBatch(network, optimizer, data, settings.seed, settings.batch);
    if ((i + 1) % 50 === 0 || i === updates - 1) console.log(`${label} ${i + 1}/${updates}, minibatch loss ${loss.toFixed(5)}`);
  }
  history.push({ phase: label, updates: optimizer.step, samples: data.inputs.length, cloningLoss: cloningLoss(network, data) });
}
if (!resume) {
  optimize(settings.updates, 'bc');
  await saveCheckpoint(resolve(out, 'checkpoint.json'), network, optimizer, data, settings, 0, metadata(), history);
}
for (let iteration = resume?.checkpoint.completedIterations ?? 0; iteration < settings.iterations; iteration++) {
  const beta = iteration === 0 ? 0.5 : iteration === 1 ? 0.25 : 0;
  const added = collect(cases, settings.seed + 1000 * (iteration + 1), settings.seconds, network, beta);
  data.inputs.push(...added.data.inputs); data.targets.push(...added.data.targets);
  history.push({ phase: `dagger ${iteration + 1} collection`, beta, episodes: added.episodes, samplesAdded: added.data.inputs.length });
  optimize(settings.daggerUpdates, `dagger ${iteration + 1}`);
  await saveCheckpoint(resolve(out, 'checkpoint.json'), network, optimizer, data, settings, iteration + 1, metadata(), history);
}
const report = { kind: 'phase 1 warm-start candidate, not a release', revision: revision(), settings, initialLoss, finalLoss: cloningLoss(network, data), history, metadata: metadata(), parameterCount: network.parameters.length, float32ParameterBytes: network.parameters.byteLength, wallSeconds: (performance.now() - started) / 1000, gates: pendingGates() };
await jsonFile(resolve(out, 'training-report.json'), report);
console.log(`Experimental policy and resumable checkpoint saved to ${out}. Production remains classic.`);
