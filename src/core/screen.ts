import type { Track } from '../track/track.ts';
import type { Surface2D } from './surface2d.ts';

/** States of the main state machine (see main.ts). */
export type ScreenId = 'race' | 'editor' | 'results' | 'library';

export interface Screen {
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
  /** Overlay element that screens put their DOM UI into. */
  readonly ui: HTMLElement;
  go(id: ScreenId): void;
}
