import { GEN_STYLES, generateTrack, type GenStyle } from '../src/editor/generate.ts';
import { builtInTracks, trackFromControl } from '../src/editor/pipeline.ts';
import { hashString } from '../src/core/random.ts';
import type { Track } from '../src/track/track.ts';

export const CORPUS_VERSION = 'driving-corpus-1';
export type Split = 'train' | 'validation' | 'acceptance' | 'diagnostic';
export interface TrackCase {
  key: string;
  split: Split;
  source: 'procedural' | 'game' | 'world';
  style?: GenStyle;
  seed?: number;
  build: () => Track;
}

/** Disjoint seed namespaces, independent of the training run seed. Geometry is built lazily. */
export function procedural(split: Exclude<Split, 'diagnostic'>, index: number): TrackCase {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 1_000_000) throw new Error('Invalid corpus index');
  const style = GEN_STYLES[index % GEN_STYLES.length];
  const namespace = { train: 0x10000000, validation: 0x20000000, acceptance: 0x30000000 }[split];
  const seed = namespace + index;
  const key = `${CORPUS_VERSION}/${split}/${style}/${seed}`;
  return { key, split, source: 'procedural', style, seed, build: () => {
    const def = generateTrack(style, seed, key);
    if (!def) throw new Error(`Generator exhausted retries: ${key}`);
    const result = trackFromControl(def);
    if (!result.ok) throw new Error(`Invalid corpus track ${key}: ${result.issue}`);
    return result.track;
  } };
}

export function corpus(split: Split, proceduralCount = split === 'train' ? 3000 : split === 'validation' ? 60 : 50): TrackCase[] {
  const built = builtInTracks().filter((b) => {
    if (split === 'train') return b.group === 'builtIn';
    const australia = /melbourne|australia/i.test(`${b.def.name} ${b.def.place ?? ''}`);
    return b.group === 'world' && (split === 'diagnostic' ? australia : split === 'acceptance' && !australia);
  }).map((b): TrackCase => ({ key: `${CORPUS_VERSION}/${split}/${b.def.id}`, split, source: b.group === 'world' ? 'world' : 'game', build: b.track }));
  if (split !== 'diagnostic') for (let i = 0; i < proceduralCount; i++) built.push(procedural(split, i));
  return built;
}

/** Refuse holdouts at the data collection boundary, not just in CLI argument parsing. */
export function requireTrainingTrack(t: TrackCase): void {
  if (t.split !== 'train' || t.source === 'world') throw new Error(`Training on held-out track is forbidden: ${t.key}`);
}

export function corpusSignature(cases: readonly TrackCase[]): string {
  return hashString(cases.map((c) => c.key).join('\n')).toString(16).padStart(8, '0');
}
