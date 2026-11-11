import { rng } from '../core/random.ts';
import { OBSERVATION_HASH, OBSERVATION_SIZE } from './observe.ts';
import { POLICY } from './config.ts';

export interface PolicyArtifact {
  version: 1;
  observationHash: string;
  sizes: number[];
  parameters: number[];
  mean: number[];
  inverseStd: number[];
  metadata: { algorithm: string; seed: number; samples: number; updates: number; promotion: 'experimental'; corpus: string };
}
export interface Workspace { activations: Float32Array[]; deltas: Float64Array[] }

/** Dense tanh MLP. Inference performs no allocation; training and the browser share exactly this forward pass. */
export class Mlp {
  readonly sizes: readonly number[];
  readonly parameters: Float32Array;
  readonly offsets: number[] = [];
  readonly mean: Float32Array;
  readonly inverseStd: Float32Array;

  constructor(sizes: readonly number[], seed = 1) {
    if (sizes.length < 2 || sizes.length > 5 || sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 1024)) throw new Error('Invalid MLP shape');
    this.sizes = [...sizes];
    let length = 0;
    for (let l = 1; l < sizes.length; l++) { this.offsets.push(length); length += (sizes[l - 1] + 1) * sizes[l]; }
    this.parameters = new Float32Array(length);
    this.mean = new Float32Array(sizes[0]);
    this.inverseStd = new Float32Array(sizes[0]).fill(1);
    const random = rng(seed);
    for (let l = 1; l < sizes.length; l++) {
      const fanIn = sizes[l - 1], scale = Math.sqrt(6 / (fanIn + sizes[l]));
      for (let j = 0; j < sizes[l]; j++) for (let k = 0; k < fanIn; k++) this.parameters[this.offsets[l - 1] + j * (fanIn + 1) + k] = (random() * 2 - 1) * scale;
    }
  }

  workspace(): Workspace {
    return { activations: this.sizes.map((n) => new Float32Array(n)), deltas: this.sizes.map((n) => new Float64Array(n)) };
  }

  forward(input: ArrayLike<number>, workspace: Workspace): Float32Array {
    const activations = workspace.activations;
    for (let i = 0; i < this.sizes[0]; i++) activations[0][i] = Math.max(-5, Math.min(5, (input[i] - this.mean[i]) * this.inverseStd[i]));
    const p = this.parameters;
    for (let l = 1; l < this.sizes.length; l++) {
      const prev = activations[l - 1], next = activations[l], n = prev.length, start = this.offsets[l - 1];
      for (let j = 0; j < next.length; j++) {
        const row = start + j * (n + 1);
        let sum = p[row + n];
        for (let k = 0; k < n; k++) sum += p[row + k] * prev[k];
        next[j] = Math.tanh(sum);
      }
    }
    return activations[activations.length - 1];
  }

  /** Caller owns the observation/output storage and workspaces. Useful for one shared policy across a field. */
  forwardBatch(inputs: readonly Float32Array[], workspaces: readonly Workspace[], outputs: readonly Float32Array[]): void {
    for (let i = 0; i < inputs.length; i++) outputs[i].set(this.forward(inputs[i], workspaces[i]));
  }

  artifact(metadata: PolicyArtifact['metadata']): PolicyArtifact {
    return { version: 1, observationHash: OBSERVATION_HASH, sizes: [...this.sizes], parameters: Array.from(this.parameters), mean: Array.from(this.mean), inverseStd: Array.from(this.inverseStd), metadata };
  }
}

export function newDrivingPolicy(seed = 1): Mlp { return new Mlp([OBSERVATION_SIZE, ...POLICY.hidden, POLICY.actionSize], seed); }

/** Fail closed. Evaluation may never substitute a classic lap when this validation fails. */
export function loadPolicy(value: unknown): { network: Mlp; artifact: PolicyArtifact } {
  const p = value as PolicyArtifact | null;
  if (!p || p.version !== 1 || p.observationHash !== OBSERVATION_HASH || !Array.isArray(p.sizes) || p.sizes.length !== 4 || p.sizes[0] !== OBSERVATION_SIZE || p.sizes[1] !== 128 || p.sizes[2] !== 128 || p.sizes[3] !== POLICY.actionSize) throw new Error('Incompatible learned policy or observation specification');
  const network = new Mlp(p.sizes);
  if (!Array.isArray(p.parameters) || p.parameters.length !== network.parameters.length || !p.parameters.every((x) => Number.isFinite(x) && Math.abs(x) <= 100)) throw new Error('Invalid learned policy weights');
  if (!Array.isArray(p.mean) || p.mean.length !== OBSERVATION_SIZE || !p.mean.every(Number.isFinite) || !Array.isArray(p.inverseStd) || p.inverseStd.length !== OBSERVATION_SIZE || !p.inverseStd.every((x) => Number.isFinite(x) && x > 0 && x <= 100)) throw new Error('Invalid observation normalization');
  if (p.metadata?.promotion !== 'experimental' || !Number.isSafeInteger(p.metadata.seed)) throw new Error('Missing policy provenance');
  network.parameters.set(p.parameters); network.mean.set(p.mean); network.inverseStd.set(p.inverseStd);
  return { network, artifact: p };
}
