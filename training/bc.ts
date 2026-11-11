import type { Mlp, Workspace } from '../src/ai/nn.ts';
import { rng } from '../src/core/random.ts';

export interface Dataset { inputs: Float32Array[]; targets: Float32Array[] }
export function dataset(): Dataset { return { inputs: [], targets: [] }; }

export function fitNormalization(network: Mlp, data: Dataset): void {
  if (!data.inputs.length) throw new Error('Cannot normalize an empty dataset');
  const mean = new Float64Array(network.sizes[0]), m2 = new Float64Array(mean.length);
  for (let row = 0; row < data.inputs.length; row++) for (let i = 0; i < mean.length; i++) {
    const d = data.inputs[row][i] - mean[i];
    mean[i] += d / (row + 1); m2[i] += d * (data.inputs[row][i] - mean[i]);
  }
  for (let i = 0; i < mean.length; i++) { network.mean[i] = mean[i]; network.inverseStd[i] = 1 / Math.sqrt(Math.max(0.01, m2[i] / data.inputs.length)); }
}

/** Analytic reverse pass of the shared forward implementation; finite-difference checked in tests. */
export function accumulateGradient(network: Mlp, workspace: Workspace, target: ArrayLike<number>, gradient: Float64Array, scale = 1): number {
  const a = workspace.activations, delta = workspace.deltas, last = a.length - 1;
  let loss = 0;
  for (let j = 0; j < a[last].length; j++) {
    const error = a[last][j] - target[j], weight = j === 0 ? 2 : 1;
    loss += weight * error * error;
    delta[last][j] = scale * 2 * weight * error * (1 - a[last][j] ** 2);
  }
  for (let l = last; l > 0; l--) {
    const prev = a[l - 1], width = prev.length, start = network.offsets[l - 1];
    delta[l - 1].fill(0);
    for (let j = 0; j < a[l].length; j++) {
      const row = start + j * (width + 1), d = delta[l][j];
      for (let k = 0; k < width; k++) { gradient[row + k] += d * prev[k]; delta[l - 1][k] += d * network.parameters[row + k]; }
      gradient[row + width] += d;
    }
    if (l > 1) for (let k = 0; k < width; k++) delta[l - 1][k] *= 1 - prev[k] ** 2;
  }
  return loss;
}

export interface AdamState { step: number; m: number[]; v: number[] }
export class Adam {
  step = 0;
  readonly m: Float64Array;
  readonly v: Float64Array;
  constructor(length: number, saved?: AdamState) {
    this.m = new Float64Array(length); this.v = new Float64Array(length);
    if (saved) {
      if (!Number.isSafeInteger(saved.step) || saved.step < 0 || saved.m.length !== length || saved.v.length !== length || !saved.m.every(Number.isFinite) || !saved.v.every((v) => Number.isFinite(v) && v >= 0)) throw new Error('Invalid Adam checkpoint');
      this.step = saved.step; this.m.set(saved.m); this.v.set(saved.v);
    }
  }
  update(parameters: Float32Array, gradient: Float64Array, rate: number, maxNorm = 1): void {
    let norm = 0;
    for (const g of gradient) norm += g * g;
    if (!Number.isFinite(norm)) throw new Error('Non-finite gradient');
    const clip = Math.min(1, maxNorm / (Math.sqrt(norm) + 1e-12));
    this.step++;
    const b1 = 1 - 0.9 ** this.step, b2 = 1 - 0.999 ** this.step;
    for (let i = 0; i < parameters.length; i++) {
      const g = gradient[i] * clip;
      this.m[i] = 0.9 * this.m[i] + 0.1 * g; this.v[i] = 0.999 * this.v[i] + 0.001 * g * g;
      parameters[i] -= rate * (this.m[i] / b1) / (Math.sqrt(this.v[i] / b2) + 1e-8);
    }
  }
  state(): AdamState { return { step: this.step, m: Array.from(this.m), v: Array.from(this.v) }; }
}

export function trainBatch(network: Mlp, optimizer: Adam, data: Dataset, seed: number, batchSize = 64, rate = 0.0003): number {
  if (!data.inputs.length || data.inputs.length !== data.targets.length) throw new Error('Invalid cloning dataset');
  const random = rng((seed + Math.imul(optimizer.step, 0x9e3779b1)) >>> 0), scratch = network.workspace();
  const gradient = new Float64Array(network.parameters.length);
  let loss = 0;
  for (let i = 0; i < batchSize; i++) {
    const row = Math.floor(random() * data.inputs.length);
    network.forward(data.inputs[row], scratch);
    loss += accumulateGradient(network, scratch, data.targets[row], gradient, 1 / batchSize);
  }
  optimizer.update(network.parameters, gradient, rate);
  return loss / batchSize;
}

export function cloningLoss(network: Mlp, data: Dataset, maxSamples = 2000): number | null {
  if (!data.inputs.length) return null;
  const workspace = network.workspace(), stride = Math.max(1, Math.floor(data.inputs.length / maxSamples));
  let sum = 0, count = 0;
  for (let row = 0; row < data.inputs.length; row += stride) {
    const pred = network.forward(data.inputs[row], workspace), target = data.targets[row];
    sum += 2 * (pred[0] - target[0]) ** 2 + (pred[1] - target[1]) ** 2; count++;
  }
  return sum / count;
}
