import css from './ui/style.css?inline';
import ownerCss from './ui/owner.css?inline';
import campaignCss from './ui/campaign.css?inline';
import ownerSceneCss from './ui/ownerScene.css?inline';
import { installCommonFixes } from './core/browserInput.ts';
import { audio } from './audio/audio.ts';
import { STR } from './config/strings.ts';
import { CareerStore } from './career/career.ts';
import type { DriveMode, GameContext, RaceEventSpec, RaceSetup, Screen, ScreenId } from './core/screen.ts';
import { settings, updateSettings } from './core/settings.ts';
import { AI } from './config/race.ts';
import { clamp } from './core/math.ts';
import { Surface2D } from './core/surface2d.ts';
import { EditorScreen } from './editor/drawing.ts';
import { getSampleTrack, trackFromCode } from './editor/pipeline.ts';
import { PreviewScreen } from './editor/preview.ts';
import { CAPS, PLATFORM } from './platform/platform.ts';
import { platform, sdkEventLog } from './platform/services.ts';
import { loadJSON, saveJSON } from './platform/storage.ts';
import { installOrientationPrompt, readHashCode } from './platform/web.ts';
import { RaceScreen } from './race/raceScreen.ts';
import { RecordBook, type RunResult } from './race/records.ts';
import { ResultsScreen } from './race/resultsScreen.ts';
import { View3D } from './render/view3d.ts';
import { TrackLibrary } from './track/library.ts';
import type { Track } from './track/track.ts';
import { h } from './ui/dom.ts';
import { LibraryScreen } from './ui/libraryScreen.ts';
import { CareerScreen } from './ui/careerScreen.ts';
import { MenuScreen } from './ui/menuScreen.ts';
import { RaceSetupScreen } from './ui/raceSetupScreen.ts';

/**
 * Main state machine: MENU (boot) → SETUP → RACE → RESULTS, with EDITOR,
 * PREVIEW and LIBRARY reachable from most of them. SETUP (the race setup
 * menu) opens wherever you choose to race a track. CAREER (the championship's
 * paddock) hands its rounds to RACE and gets their results back.
 */

const style = document.createElement('style');
style.textContent = css + ownerCss + campaignCss + ownerSceneCss;
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
  view3d.setQuality(settings().graphics);
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
  readonly career = new CareerStore();
  /** The championship round being driven (null in a single race); cleared on leaving the race. */
  event: RaceEventSpec | null = null;
  lastResult: RunResult | null = null;
  interrupted = false;
  preview: GameContext['preview'] = null;
  /** The single race's setup (the race setup menu's choices). */
  private readonly ownSetup: RaceSetup;
  /** The track whose own lap count the setup's laps were last reset to. */
  private lapsFor = '';
  private setupBack: (() => void) | null = null;
  private readonly screens: Partial<Record<ScreenId, Screen>> = {};
  private current: Screen | null = null;
  private currentId: ScreenId | null = null;

  constructor(bootTrack: Track) {
    this.track = bootTrack;
    const saved = settings().raceSetup;
    this.ownSetup = {
      mode: saved?.mode === 'practice' ? 'practice' : 'race',
      laps: bootTrack.options.laps,
      ghost: saved?.ghost ?? true,
      opponents: clamp(Math.round(saved?.opponents ?? 3), 0, AI.maxOpponents),
      difficulty: clamp(Math.round(saved?.difficulty ?? 50), 1, 100),
      grid: saved?.grid === 'qualifying' || saved?.grid === 'random' ? saved.grid : 'pick',
      startSlot: clamp(Math.round(saved?.startSlot ?? 99), 1, AI.maxOpponents + 1),
      weather: saved?.weather === 'rain' || saved?.weather === 'changing' ? saved.weather : 'dry',
      time: saved?.time === 'day' || saved?.time === 'sunset' || saved?.time === 'night' ? saved.time : 'track',
      tyreWear: saved?.tyreWear === true,
      tyres: saved?.tyres === 'soft' || saved?.tyres === 'hard' || saved?.tyres === 'wet' ? saved.tyres : 'medium',
      damage: saved?.damage === true,
      safetyCar: saved?.safetyCar === true,
    };
    wipeOldLibraryOnce(this.library, this.records);
    this.screens.menu = new MenuScreen(this);
    this.screens.setup = new RaceSetupScreen(this);
    this.screens.race = new RaceScreen(this);
    this.screens.editor = new EditorScreen(this);
    this.screens.results = new ResultsScreen(this);
    this.screens.library = new LibraryScreen(this);
    this.screens.preview = new PreviewScreen(this);
    this.screens.career = new CareerScreen(this);
  }

  /** A championship round has its own settings; otherwise the race setup menu's. */
  get setup(): RaceSetup {
    return this.event?.setup ?? this.ownSetup;
  }

  startEvent(event: RaceEventSpec): void {
    this.event = event;
    this.setupBack = null;
    if (this.currentId === 'race') (this.screens.race as RaceScreen).startRun();
    else this.go('race');
  }

  setTrack(track: Track): void {
    this.track = track;
  }

  refreshPaint(): void {
    (this.screens.race as RaceScreen | undefined)?.applyPaint();
  }

  get mode(): DriveMode {
    return this.setup.mode;
  }

  /** A new track starts with its own number of laps (the editor's "Laps per race"). */
  private syncLaps(): void {
    if (this.lapsFor === this.track.def.id) return;
    this.lapsFor = this.track.def.id;
    this.ownSetup.laps = this.track.options.laps;
  }

  drive(mode: DriveMode): void {
    this.start({ mode });
  }

  start(patch: Partial<RaceSetup> = {}): void {
    this.event = null;
    this.syncLaps();
    Object.assign(this.ownSetup, patch);
    const { mode, ghost, opponents, difficulty, grid, startSlot, weather, time, tyreWear, tyres, damage, safetyCar } = this.ownSetup;
    updateSettings({ raceSetup: { mode, ghost, opponents, difficulty, grid, startSlot, weather, time, tyreWear, tyres, damage, safetyCar } });
    this.setupBack = null;
    if (this.currentId === 'race') (this.screens.race as RaceScreen).startRun();
    else this.go('race');
  }

  openSetup(opts: { back?: () => void; mode?: DriveMode } = {}): void {
    this.event = null;
    this.syncLaps();
    if (opts.mode) this.ownSetup.mode = opts.mode;
    const from = this.currentId;
    this.setupBack = opts.back ?? (() => this.go(from && from !== 'setup' ? from : 'menu'));
    this.go('setup');
  }

  closeSetup(): void {
    const back = this.setupBack;
    this.setupBack = null;
    if (back) back();
    else this.go('menu');
  }

  go(id: ScreenId): void {
    const next = this.screens[id];
    if (!next || id === this.currentId) return;
    this.current?.exit();
    // A championship round lasts as long as it's being driven.
    if (id !== 'race') this.event = null;
    // Menus, editor and results are breaks in gameplay; the race reports its own start.
    platform.setGameplay(false);
    canvas3d.classList.toggle('layer-hidden', next.layer !== '3d');
    canvas2d.classList.toggle('layer-hidden', next.layer !== '2d');
    surface.resize();
    this.current = next;
    this.currentId = id;
    document.documentElement.dataset.screen = id;
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

/**
 * Tracks used to be saved automatically every time you raced one. Now only
 * tracks you save yourself are kept, so the old auto-saved list (and the
 * records of those tracks) is cleared once.
 */
function wipeOldLibraryOnce(library: TrackLibrary, records: RecordBook): void {
  const FLAG = 'library.manualOnly';
  if (loadJSON<boolean>(FLAG, false)) return;
  for (const e of library.list()) records.forget(e.def.id);
  library.clear();
  saveJSON(FLAG, true);
}

/** Keys saved before the store tracked them, so the cloud save carries them too. */
function legacySaveKeys(): string[] {
  const records = loadJSON<unknown>('records.index', []);
  const ids = Array.isArray(records) ? records.filter((x): x is string => typeof x === 'string') : [];
  return ['settings', 'library', 'library.manualOnly', 'records.index', 'editor.draft.v1', 'career.v1', ...ids.map((id) => `records.${id}`)];
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

/**
 * Boot: initialise the platform (CrazyGames SDK) first, because saved data
 * lives in the SDK's data module; then the main menu over the boot track in 3D
 * (one tap or key to start driving). Loading is reported from SDK init to the
 * first rendered frame.
 */
async function boot(): Promise<void> {
  installCommonFixes();
  await platform.init();
  platform.loadingStart();
  // A newer save from the cloud (another device, a cleared browser) before anything reads storage.
  await platform.startCloud(legacySaveKeys());

  audio.installUnlock();
  audio.setPlatformMuted(platform.platformMuted());
  platform.onPlatformMuteChange((m) => audio.setPlatformMuted(m));

  const game = new Game(bootTrack());
  platform.setAdHooks({
    onAdStart: () => {
      audio.setHeld(true);
      game.interrupted = true;
    },
    onAdEnd: () => {
      audio.setHeld(false);
      game.interrupted = false;
    },
  });
  game.go('menu');

  if (CAPS.orientationPrompt) {
    const prompt = h('div', { class: 'rotate-prompt' }, h('div', { class: 'rotate-icon', text: '📱' }), h('p', { text: STR.rotate }));
    app.append(prompt);
    installOrientationPrompt(prompt, (portrait) => (game.interrupted = portrait));
  }
  // Handle for automated browser checks in dev builds; stripped from production.
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __audio: audio, __sdkEvents: sdkEventLog });

  window.addEventListener('resize', () => game.resize());

  let last = performance.now();
  let loaded = false;
  const loop = (now: number): void => {
    // The first rAF timestamp can be earlier than the performance.now() above, so clamp at 0.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    game.frame(dt, now / 1000);
    if (!loaded) {
      loaded = true;
      platform.loadingStop(); // the scene has rendered: loading is done
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void boot();
