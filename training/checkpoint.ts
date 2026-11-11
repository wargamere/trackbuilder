import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { OBSERVATION_SIZE } from '../src/ai/observe.ts';
import { loadPolicy, type Mlp, type PolicyArtifact } from '../src/ai/nn.ts';
import { Adam, type Dataset, type AdamState, dataset } from './bc.ts';
import { jsonFile } from './cli.ts';

export interface TrainingSettings { seed: number; tracks: number; seconds: number; updates: number; daggerUpdates: number; iterations: number; batch: number }
export interface Checkpoint {
  version: 1;
  settings: TrainingSettings;
  completedIterations: number;
  policy: PolicyArtifact;
  optimizer: AdamState;
  data: { file: string; sha256: string; samples: number };
  history: unknown[];
}

export async function saveCheckpoint(path: string, network: Mlp, optimizer: Adam, data: Dataset, settings: TrainingSettings, completedIterations: number, metadata: PolicyArtifact['metadata'], history: unknown[]): Promise<void> {
  const width = OBSERVATION_SIZE + 2, buffer = Buffer.alloc(12 + data.inputs.length * width * 4);
  buffer.writeUInt32LE(0x41494243, 0); buffer.writeUInt32LE(data.inputs.length, 4); buffer.writeUInt32LE(OBSERVATION_SIZE, 8);
  let offset = 12;
  for (let i = 0; i < data.inputs.length; i++) {
    for (const value of data.inputs[i]) { buffer.writeFloatLE(value, offset); offset += 4; }
    for (const value of data.targets[i]) { buffer.writeFloatLE(value, offset); offset += 4; }
  }
  const filename = `dataset-${completedIterations}.bin`;
  // jsonFile creates the directory first. The checkpoint is published only after the dataset is complete.
  await jsonFile(resolve(dirname(path), 'policy.json'), network.artifact(metadata));
  await writeFile(resolve(dirname(path), filename), buffer);
  const checkpoint: Checkpoint = { version: 1, settings, completedIterations, policy: network.artifact(metadata), optimizer: optimizer.state(), data: { file: filename, sha256: createHash('sha256').update(buffer).digest('hex'), samples: data.inputs.length }, history };
  await jsonFile(path, checkpoint);
}

export async function readCheckpoint(path: string): Promise<{ checkpoint: Checkpoint; network: Mlp; optimizer: Adam; data: Dataset }> {
  const checkpoint = JSON.parse(await readFile(path, 'utf8')) as Checkpoint;
  if (checkpoint.version !== 1 || !Number.isSafeInteger(checkpoint.completedIterations) || checkpoint.completedIterations < 0 || checkpoint.completedIterations > 10) throw new Error('Invalid training checkpoint');
  if (!/^dataset-\d+\.bin$/.test(checkpoint.data?.file ?? '')) throw new Error('Invalid checkpoint dataset path');
  const buffer = await readFile(resolve(dirname(path), checkpoint.data.file));
  if (createHash('sha256').update(buffer).digest('hex') !== checkpoint.data.sha256 || buffer.length < 12 || buffer.readUInt32LE(0) !== 0x41494243 || buffer.readUInt32LE(8) !== OBSERVATION_SIZE) throw new Error('Checkpoint dataset checksum or specification mismatch');
  const count = buffer.readUInt32LE(4), width = OBSERVATION_SIZE + 2;
  if (count !== checkpoint.data.samples || buffer.length !== 12 + count * width * 4) throw new Error('Truncated checkpoint dataset');
  const data = dataset(); let offset = 12;
  for (let row = 0; row < count; row++) {
    const input = new Float32Array(OBSERVATION_SIZE), target = new Float32Array(2);
    for (let k = 0; k < input.length; k++) { input[k] = buffer.readFloatLE(offset); offset += 4; }
    for (let k = 0; k < target.length; k++) { target[k] = buffer.readFloatLE(offset); offset += 4; }
    if (!input.every(Number.isFinite) || !target.every(Number.isFinite)) throw new Error('Non-finite checkpoint dataset');
    data.inputs.push(input); data.targets.push(target);
  }
  const { network } = loadPolicy(checkpoint.policy);
  return { checkpoint, network, optimizer: new Adam(network.parameters.length, checkpoint.optimizer), data };
}
