import type { RecordBook, RunResult } from '../race/records.ts';
import type { View3D } from '../render/view3d.ts';
import type { TrackLibrary } from '../track/library.ts';
import type { Track } from '../track/track.ts';
import type { Surface2D } from './surface2d.ts';

/** States of the main state machine (see main.ts). */
export type ScreenId = 'menu' | 'race' | 'editor' | 'results' | 'library' | 'preview';

/** How the race screen runs: free practice laps, or a timed race with a countdown and results. */
export type DriveMode = 'practice' | 'race';

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
