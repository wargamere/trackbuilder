import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, unlink, rmdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mlp, newDrivingPolicy, loadPolicy } from '../src/ai/nn.ts';
import { actionToInput } from '../src/ai/actions.ts';
import { defaultIntent } from '../src/ai/intents.ts';
import { LearnedDriver } from '../src/ai/learnedDriver.ts';
import { OBSERVATION_NAMES, OBSERVATION_SIZE, Observer } from '../src/ai/observe.ts';
import { CarPhysics, NO_INPUT } from '../src/car/physics.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { Adam, accumulateGradient, dataset, trainBatch, cloningLoss } from '../training/bc.ts';
import { readCheckpoint, saveCheckpoint } from '../training/checkpoint.ts';

test('learned policy: analytic gradients agree with finite differences through all layers', () => {
  const network = new Mlp([3, 4, 3, 2], 52), scratch = network.workspace();
  const input = Float32Array.of(0.2, -0.7, 0.5), target = Float32Array.of(-0.2, 0.8);
  const gradient = new Float64Array(network.parameters.length);
  network.forward(input, scratch); accumulateGradient(network, scratch, target, gradient);
  const loss = () => { const p = network.forward(input, scratch); return 2 * (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2; };
  for (let i = 0; i < network.parameters.length; i++) {
    const original = network.parameters[i];
    network.parameters[i] = original + 0.001; const plus = network.parameters[i], a = loss();
    network.parameters[i] = original - 0.001; const minus = network.parameters[i], b = loss();
    network.parameters[i] = original;
    const numeric = (a - b) / (plus - minus);
    assert.ok(Math.abs(numeric - gradient[i]) < 0.0002 + Math.abs(numeric) * 0.01, `gradient ${i}: ${gradient[i]} vs ${numeric}`);
  }
});

test('learned policy: cloning optimizes a meaningful nonlinear target and Adam resumes exactly', () => {
  const data = dataset(), network = new Mlp([3, 8, 2], 42), optimizer = new Adam(network.parameters.length);
  for (let i = 0; i < 32; i++) {
    const x = (i - 16) / 16;
    data.inputs.push(Float32Array.of(x, x * x, 1)); data.targets.push(Float32Array.of(Math.tanh(2 * x), Math.tanh(x * x - 0.5)));
  }
  const before = cloningLoss(network, data)!;
  for (let i = 0; i < 100; i++) trainBatch(network, optimizer, data, 42, 16, 0.01);
  assert.ok(cloningLoss(network, data)! < before * 0.05);
  const restored = new Mlp(network.sizes); restored.parameters.set(network.parameters);
  const restoredAdam = new Adam(restored.parameters.length, optimizer.state());
  trainBatch(network, optimizer, data, 42); trainBatch(restored, restoredAdam, data, 42);
  assert.deepEqual(network.parameters, restored.parameters);
});

test('learned policy: observation sees raw geometry and same-level neighbours with reusable storage', async () => {
  const track = getSampleTrack(0), car = new CarPhysics(track), other = new CarPhysics(track), observer = new Observer(track);
  car.placeAt(50); other.placeAt(55);
  const intent = defaultIntent(), values = observer.fill(car, [car.state, other.state], NO_INPUT, intent);
  assert.equal(values.length, OBSERVATION_SIZE); assert.ok(values.every(Number.isFinite));
  const mask = OBSERVATION_NAMES.indexOf('car.0.mask'); assert.equal(values[mask], 1);
  other.state.y = car.state.y + 10;
  assert.equal(observer.fill(car, [car.state, other.state], NO_INPUT, intent), values);
  assert.equal(values[mask], 0);
  const source = await readFile(new URL('../src/ai/observe.ts', import.meta.url), 'utf8');
  assert.ok(!/from ['"].*(?:driver|traffic|racingLine)/.test(source), 'observer must not import a classic driving plan');
  assert.ok(!OBSERVATION_NAMES.some((s) => /racingLine|speedProfile|gridSlot|startSpread/.test(s)));
});

test('learned policy: held actions run at 30 Hz and invalid weights cannot silently become classic', () => {
  const track = getSampleTrack(0), car = new CarPhysics(track), network = newDrivingPolicy(3), driver = new LearnedDriver(track, network);
  for (let i = 0; i < 120; i++) driver.drive(car, [car.state], 1 / 120, defaultIntent());
  assert.equal(driver.decisions, 30);
  const metadata = { algorithm: 'test', seed: 3, samples: 1, updates: 1, promotion: 'experimental' as const, corpus: 'test' };
  const artifact = network.artifact(metadata), loaded = loadPolicy(artifact);
  assert.deepEqual(loaded.network.parameters, network.parameters);
  assert.throws(() => loadPolicy({ ...artifact, observationHash: 'old' }), /Incompatible/);
  assert.throws(() => loadPolicy({ ...artifact, parameters: [NaN] }), /Invalid/);
  const input = actionToInput(Float32Array.of(4, -5), { ...NO_INPUT });
  assert.deepEqual([input.steer, input.throttle, input.brake], [1, 0, 1]);
});

test('learned policy: binary dataset and optimizer checkpoint round-trip with checksums', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trackbuilder-ai-')), path = join(directory, 'checkpoint.json');
  try {
    const network = newDrivingPolicy(1), optimizer = new Adam(network.parameters.length), data = dataset();
    data.inputs.push(new Float32Array(OBSERVATION_SIZE).fill(0.25)); data.targets.push(Float32Array.of(-0.1, 0.7));
    await saveCheckpoint(path, network, optimizer, data, { seed: 1, tracks: 6, seconds: 5, updates: 1, daggerUpdates: 1, iterations: 3, batch: 1 }, 0, { algorithm: 'test', seed: 1, samples: 1, updates: 0, promotion: 'experimental', corpus: 'test' }, []);
    const restored = await readCheckpoint(path);
    assert.deepEqual(restored.data, data); assert.deepEqual(restored.network.parameters, network.parameters);
    assert.deepEqual(restored.optimizer.state(), optimizer.state());
  } finally {
    for (const name of ['checkpoint.json', 'policy.json', 'dataset-0.bin']) await unlink(join(directory, name)).catch(() => {});
    await rmdir(directory);
  }
});
