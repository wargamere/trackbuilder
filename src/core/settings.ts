import { cleanBindings, DEFAULT_BINDINGS, type KeyBindings } from '../car/bindings.ts';
import type { PaintId } from '../config/paint.ts';
import { DEFAULT_SETUP, SETUP, type CarSetup } from '../config/race.ts';
import type { RaceSetup } from './screen.ts';
import { loadJSON, saveJSON } from '../platform/storage.ts';

/** Driving assists (see race/assists.ts). */
export interface Assists {
  /** The racing line on the road: off, only where you need to brake or lift, or all of it. */
  line: 'off' | 'brake' | 'full';
  /** Brakes for you before corners (a little early). */
  brake: boolean;
  /** Steers along the racing line while you're not steering. */
  steer: boolean;
  /** Who changes gear: the automatic (a little slower) or you. */
  gears: 'auto' | 'manual';
}

export const DEFAULT_ASSISTS: Assists = { line: 'off', brake: false, steer: false, gears: 'auto' };

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
  /** Editor: a little car laps the track on the map (the gold-medal lap). */
  editorCar: boolean;
  /** Editor sidebar section left open. */
  sidebarSection: number;
  assists: Assists;
  /** Keyboard keys for driving (see car/bindings.ts). */
  keys: KeyBindings;
  /** Your car's setup: wing, gears, brake balance (see SETUP). */
  carSetup: CarSetup;
  /** The timing tower in races with AI cars: every car, just the cars near you (and the leaders), or hidden. */
  tower: 'full' | 'compact' | 'off';
  /** Race setup choices (laps come from each track). */
  raceSetup: Omit<RaceSetup, 'laps'>;
}

const DEFAULTS: Settings = {
  muted: false,
  camera: 'chase',
  editorMode: 'dots',
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
  // Off by default for people who'd rather things on screen stayed still.
  editorCar: !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  sidebarSection: 0,
  assists: DEFAULT_ASSISTS,
  keys: DEFAULT_BINDINGS,
  tower: 'full',
  carSetup: DEFAULT_SETUP,
  raceSetup: { mode: 'race', ghost: true, opponents: 3, difficulty: 50, grid: 'pick', startSlot: 4, weather: 'dry', time: 'track', tyreWear: false, tyres: 'medium', damage: false, safetyCar: false },
};
const KEY = 'settings';

let current: Settings | null = null;

/** A saved setup, made safe: anything unknown is the standard choice. */
function cleanSetup(saved: unknown): CarSetup {
  const s = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const pick = <K extends keyof CarSetup>(k: K, options: object): CarSetup[K] => (typeof s[k] === 'string' && s[k] in options ? (s[k] as CarSetup[K]) : DEFAULT_SETUP[k]);
  return { wing: pick('wing', SETUP.wing), gears: pick('gears', SETUP.gears), brakes: pick('brakes', SETUP.brakes) };
}

export function settings(): Settings {
  if (!current) {
    const saved = loadJSON<Partial<Settings>>(KEY, {});
    current = { ...DEFAULTS, ...saved, assists: { ...DEFAULT_ASSISTS, ...saved.assists }, keys: cleanBindings(saved.keys), carSetup: cleanSetup(saved.carSetup) };
  }
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...settings(), ...patch };
  saveJSON(KEY, current);
}
