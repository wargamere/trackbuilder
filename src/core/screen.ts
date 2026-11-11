import type { CareerStore } from '../career/career.ts';
import type { Compound } from '../config/race.ts';
import type { TimeOfDay } from '../config/track.ts';
import type { RecordBook, RunResult } from '../race/records.ts';
import type { View3D } from '../render/view3d.ts';
import type { TrackLibrary } from '../track/library.ts';
import type { Track } from '../track/track.ts';
import type { Surface2D } from './surface2d.ts';

/** States of the main state machine (see main.ts). */
export type ScreenId = 'menu' | 'setup' | 'race' | 'editor' | 'results' | 'library' | 'preview' | 'career';

/** How the race screen runs: free practice laps, or a timed race with a countdown and results. */
export type DriveMode = 'practice' | 'race';

/** The weather for a run: dry, rain (less grip and weaker brakes, for everyone), or changing (rain comes and goes; see race/weather.ts). */
export type Weather = 'dry' | 'rain' | 'changing';

/** What the race setup menu chooses for the next run. */
export interface RaceSetup {
  mode: DriveMode;
  /** Laps in a race, 1–50 (practice laps never end). */
  laps: number;
  /** Show your best lap on the track as a see-through ghost car. */
  ghost: boolean;
  /** AI cars in a race, 0–11 (never in practice). */
  opponents: number;
  /** How fast the AI cars are, 1–100 (%). */
  difficulty: number;
  /** How the grid is decided: a qualifying session, a random draw, or the slot you pick. */
  grid: 'qualifying' | 'random' | 'pick';
  /** Your grid slot when picking (1 = pole). */
  startSlot: number;
  weather: Weather;
  /** Time of day: the track's own, or day, sunset or night for this run. */
  time: 'track' | TimeOfDay;
  /** Tyres lose grip as they wear (stop in the pit box for new ones). */
  tyreWear: boolean;
  /** The tyres you start on (with tyre wear on). */
  tyres: Compound;
  /** Hits damage the cars (mended in a pit stop). */
  damage: boolean;
  /** A stuck car brings out the safety car (yellow flags are always on in a race). */
  safetyCar: boolean;
}

/** An AI car in a championship round. */
export interface EventCar {
  /** Who it is (in grids and results). */
  id: string;
  name: string;
  paint: number;
  secondary?: number;
  /** How hard it drives, 0..1 (see aiPace). */
  difficulty: number;
  /** Its pit box (teammates share one; see pitBox). */
  box: number;
  /** A mechanical failure this race: it breaks down this far through the distance (a share), if at all. */
  failAt?: number;
}

/** How a championship race ended, for the standings. */
export interface EventResult {
  /** Everyone in finishing order (ids): the cars that retired last. */
  order: string[];
  /** Who retired. */
  dnf: string[];
  /** Who set the fastest lap (null: nobody set a clean one). */
  fastest: string | null;
  /** Each car's race time from the start (s) and laps completed, in `order`'s order; the time is null for a car that didn't finish. */
  times: (number | null)[];
  laps: number[];
  /** True if the race was cut short (skipped to the results while cars were still racing): the order is as it stood. */
  estimated: boolean;
}

/**
 * A round of a championship (the career), driven by the race screen in place
 * of a single race: a fixed field of named cars instead of the setup's AI
 * cars, your name and colours, and somewhere to report to. `session` is what
 * to drive: free practice, qualifying then the race, or (with a `grid`) the
 * race itself.
 */
export interface RaceEventSpec {
  /** The race's settings (laps, weather, tyres, damage, …): used instead of the game's setup, which it never changes. */
  setup: RaceSetup;
  session: 'practice' | 'qualifying' | 'race';
  /** "Round 3 of 16", for the HUD. */
  title: string;
  you: { id: string; name: string; paint: number; secondary?: number; box: number };
  /** Your car against the standard one: grip, engine pull and top speed (shares of it). */
  car: { grip: number; pull: number; top: number };
  /** Laps medium tyres last in this race (the other kinds in proportion). */
  tyreLife: number;
  /** The AI cars. */
  field: EventCar[];
  /** The grid (ids, pole first) when qualifying has been run. */
  grid: string[] | null;
  /** Qualifying is over: the grid, and each car's best lap (null: no time). */
  qualified(order: string[], times: Record<string, number | null>): void;
  /** The race is over. */
  finished(result: EventResult): void;
  /** Leave the session without finishing it (back to the paddock). */
  leave(): void;
}

export interface Screen {
  /** Which canvas the screen draws on; main.ts shows that one and hides the other. */
  readonly layer: '2d' | '3d';
  enter(): void;
  exit(): void;
  /** Called once per animation frame while the screen is active. */
  frame(dt: number, time: number): void;
  resize(): void;
}

/** What screens can see and do. Implemented by main.ts. */
export interface GameContext {
  /** The track that is (or will be) raced. */
  readonly track: Track;
  setTrack(track: Track): void;
  readonly surface: Surface2D;
  /** The 3D view, or null if WebGL is unavailable. */
  readonly view3d: View3D | null;
  /** Overlay element that screens put their DOM UI into. */
  readonly ui: HTMLElement;
  go(id: ScreenId): void;
  /** Drives the current track in practice or race mode (restarting the run if already driving). */
  drive(mode: DriveMode): void;
  /** Drives the current track with the setup, changed by `patch` (restarting the run if already driving). */
  start(patch?: Partial<RaceSetup>): void;
  /**
   * Opens the race setup menu for the current track. Back returns to the
   * screen it was opened from, or calls `back`; `mode` preselects a mode.
   */
  openSetup(opts?: { back?: () => void; mode?: DriveMode }): void;
  /** Leaves the setup menu the way it was opened. */
  closeSetup(): void;
  /** The settings for the run being driven (or the next one): a championship round's own while one is driven. */
  readonly setup: Readonly<RaceSetup>;
  /** The championship round being driven (set by the career), or null in a single race. */
  readonly event: RaceEventSpec | null;
  /** Drives a championship round on the current track (see RaceEventSpec). */
  startEvent(event: RaceEventSpec): void;
  /** The saved career. */
  readonly career: CareerStore;
  /** The mode the race screen runs in. */
  readonly mode: DriveMode;
  /** Personal bests and ghosts per track. */
  readonly records: RecordBook;
  /** Saved tracks ("My tracks"). */
  readonly library: TrackLibrary;
  /** The run the results screen shows. */
  lastResult: RunResult | null;
  /** True while something outside the game needs it paused (portrait prompt, video ads). */
  interrupted: boolean;
  /** Re-applies the selected paint to the car. */
  refreshPaint(): void;
  /** What the 3D preview shows (set by the editor), and how to race it from there. */
  preview: { track: Track; race(): void; back(): void } | null;
}
