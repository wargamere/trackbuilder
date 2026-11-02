import css from './ui/style.css?inline';
import type { GameContext, Screen, ScreenId } from './core/screen.ts';
import { Surface2D } from './core/surface2d.ts';
import { EditorScreen } from './editor/drawing.ts';
import { getSampleTrack } from './editor/pipeline.ts';
import { PLATFORM } from './platform/platform.ts';
import { PreviewRaceScreen } from './race/previewScreen.ts';
import type { Track } from './track/track.ts';

/**
 * Main state machine:  RACE (boot) ⇄ EDITOR ⇄ RESULTS ⇄ LIBRARY
 * Phase 1 implements RACE (as a 2D placeholder) and EDITOR.
 */

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
document.documentElement.dataset.platform = PLATFORM;

const app = document.getElementById('app') ?? document.body;
const canvas2d = document.createElement('canvas');
const ui = document.createElement('div');
ui.id = 'ui';
app.append(canvas2d, ui);
canvas2d.addEventListener('contextmenu', (e) => e.preventDefault());

const surface = new Surface2D(canvas2d);

class Game implements GameContext {
  track: Track;
  readonly surface = surface;
  readonly ui = ui;
  private readonly screens: Partial<Record<ScreenId, Screen>> = {};
  private current: Screen | null = null;
  private currentId: ScreenId | null = null;

  constructor(bootTrack: Track) {
    this.track = bootTrack;
    this.screens.race = new PreviewRaceScreen(this);
    this.screens.editor = new EditorScreen(this);
  }

  setTrack(track: Track): void {
    this.track = track;
  }

  go(id: ScreenId): void {
    const next = this.screens[id];
    if (!next || id === this.currentId) return;
    this.current?.exit();
    this.current = next;
    this.currentId = id;
    next.enter();
  }

  frame(dt: number, time: number): void {
    this.current?.frame(dt, time);
  }

  resize(): void {
    surface.resize();
    this.current?.resize();
  }
}

// Boot straight into the race on the first sample track.
const game = new Game(getSampleTrack(0));
game.go('race');

window.addEventListener('resize', () => game.resize());

let last = performance.now();
function loop(now: number): void {
  // The first rAF timestamp can be earlier than the performance.now() above, so clamp at 0.
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  game.frame(dt, now / 1000);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
