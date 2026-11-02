import { loadJSON, saveJSON } from '../platform/storage.ts';

/** Player preferences, saved between visits. */
export interface Settings {
  muted: boolean;
  camera: 'chase' | 'bonnet';
  editorMode: 'draw' | 'dots';
  smoothing: 'sharp' | 'normal' | 'smooth';
  snap: boolean;
}

const DEFAULTS: Settings = { muted: false, camera: 'chase', editorMode: 'draw', smoothing: 'normal', snap: false };
const KEY = 'settings';

let current: Settings | null = null;

export function settings(): Settings {
  current ??= { ...DEFAULTS, ...loadJSON<Partial<Settings>>(KEY, {}) };
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...settings(), ...patch };
  saveJSON(KEY, current);
}
