import type { PaintId } from '../config/paint.ts';
import type { RaceSetup } from './screen.ts';
import { loadJSON, saveJSON } from '../platform/storage.ts';

/** Player preferences, saved between visits. */
export interface Settings {
  muted: boolean;
  camera: 'chase' | 'bonnet';
  editorMode: 'draw' | 'dots' | 'height';
  /** Dragging a dot also moves its neighbours. */
  softEdit: boolean;
  smoothing: 'sharp' | 'normal' | 'smooth';
  snap: boolean;
  /** Selected car paint. */
  paint: PaintId;
  /** Paints unlocked by watching a rewarded ad. */
  adPaints: PaintId[];
  /** Finished runs (paints unlock as this grows). */
  runs: number;
  /** Display: graphics quality, speed units, minimap in the race, corner numbers in the editor. */
  graphics: 'full' | 'fast';
  units: 'kmh' | 'mph';
  minimap: boolean;
  cornerLabels: boolean;
  /** Editor sidebar section left open. */
  sidebarSection: number;
  /** Race setup choices (laps come from each track). */
  raceSetup: Omit<RaceSetup, 'laps'>;
}

const DEFAULTS: Settings = {
  muted: false,
  camera: 'chase',
  editorMode: 'draw',
  softEdit: true,
  smoothing: 'normal',
  snap: false,
  paint: 'yellow',
  adPaints: [],
  runs: 0,
  graphics: 'full',
  units: 'kmh',
  minimap: true,
  cornerLabels: true,
  sidebarSection: 0,
  raceSetup: { mode: 'race', ghost: true, opponents: 3, difficulty: 50 },
};
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
