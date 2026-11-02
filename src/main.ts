import css from './ui/style.css?inline';
import { audio } from './audio/audio.ts';
import { STR } from './config/strings.ts';
import type { GameContext, Screen, ScreenId } from './core/screen.ts';
import { Surface2D } from './core/surface2d.ts';
import { EditorScreen } from './editor/drawing.ts';
import { getSampleTrack, trackFromCode } from './editor/pipeline.ts';
import { CAPS, PLATFORM } from './platform/platform.ts';
import { installOrientationPrompt, readHashCode } from './platform/web.ts';
import { RaceScreen } from './race/raceScreen.ts';
import { RecordBook, type RunResult } from './race/records.ts';
import { ResultsScreen } from './race/resultsScreen.ts';
import { View3D } from './render/view3d.ts';
import { TrackLibrary } from './track/library.ts';
import type { Track } from './track/track.ts';
import { h } from './ui/dom.ts';
import { LibraryScreen } from './ui/libraryScreen.ts';

/**
 * Main state machine:  RACE (boot) ⇄ EDITOR ⇄ RESULTS ⇄ LIBRARY
 */

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
document.documentElement.dataset.platform = PLATFORM;
document.title = STR.gameName;

const app = document.getElementById('app') ?? document.body;
const canvas3d = document.createElement('canvas');
const canvas2d = document.createElement('canvas');
const ui = document.createElement('div');
ui.id = 'ui';
app.append(canvas3d, canvas2d, ui);
for (const c of [canvas3d, canvas2d]) c.addEventListener('contextmenu', (e) => e.preventDefault());

const surface = new Surface2D(canvas2d);
let view3d: View3D | null = null;
try {
  view3d = new View3D(canvas3d);
} catch (err) {
  console.error('WebGL unavailable', err);
}

class Game implements GameContext {
  track: Track;
  readonly surface = surface;
  readonly view3d = view3d;
  readonly ui = ui;
  readonly records = new RecordBook();
  readonly library = new TrackLibrary();
  lastResult: RunResult | null = null;
  interrupted = false;
  private readonly screens: Partial<Record<ScreenId, Screen>> = {};
  private current: Screen | null = null;
  private currentId: ScreenId | null = null;

  constructor(bootTrack: Track) {
    this.track = bootTrack;
    this.screens.race = new RaceScreen(this);
    this.screens.editor = new EditorScreen(this);
    this.screens.results = new ResultsScreen(this);
    this.screens.library = new LibraryScreen(this);
  }

  setTrack(track: Track): void {
    this.track = track;
  }

  go(id: ScreenId): void {
    const next = this.screens[id];
    if (!next || id === this.currentId) return;
    this.current?.exit();
    canvas3d.classList.toggle('layer-hidden', next.layer !== '3d');
    canvas2d.classList.toggle('layer-hidden', next.layer !== '2d');
    surface.resize();
    this.current = next;
    this.currentId = id;
    next.enter();
    next.resize();
  }

  frame(dt: number, time: number): void {
    this.current?.frame(dt, time);
  }

  resize(): void {
    surface.resize();
    this.current?.resize();
  }
}

/** Web build: a share link (#track=…) boots straight into that track. */
function bootTrack(): Track {
  const code = CAPS.links ? readHashCode() : null;
  if (code) {
    const res = trackFromCode(code);
    if (res.ok) return res.track;
  }
  return getSampleTrack(0);
}

audio.installUnlock();

// Boot straight into the race: no clicks needed.
const game = new Game(bootTrack());
game.go('race');

if (CAPS.orientationPrompt) {
  const prompt = h('div', { class: 'rotate-prompt' }, h('div', { class: 'rotate-icon', text: '📱' }), h('p', { text: STR.rotate }));
  app.append(prompt);
  installOrientationPrompt(prompt, (portrait) => (game.interrupted = portrait));
}
// Handle for automated browser checks in dev builds; stripped from production.
if (import.meta.env.DEV) Object.assign(window, { __game: game, __audio: audio });

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
