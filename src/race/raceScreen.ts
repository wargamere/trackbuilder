import { type Mesh, type PerspectiveCamera, Vector3 } from 'three';
import { audio } from '../audio/audio.ts';
import { CameraRig } from '../car/camera.ts';
import { collideCars } from '../car/contact.ts';
import { carriedTow, slipstream } from '../car/slipstream.ts';
import { keyboardHint } from '../car/bindings.ts';
import { InputManager, type InputAction } from '../car/input.ts';
import { CarModel } from '../car/model.ts';
import { currentPaintHex, recordFinishedRun } from '../car/paint.ts';
import { CarPhysics, CarState, lerpState, NO_INPUT, STANDARD_CAR, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { AI_PAINTS, PAINTS } from '../config/paint.ts';
import { AI, CONDITIONS, DAMAGE, PIT_LANE, RACE, SLIPSTREAM, TYRES, type Compound } from '../config/race.ts';
import { compoundLife } from '../car/tyres.ts';
import { STR, fmt } from '../config/strings.ts';
import { FixedStep } from '../core/fixedStep.ts';
import type { EventCar, GameContext, Screen } from '../core/screen.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { CAPS, prefersTouchControls } from '../platform/platform.ts';
import { platform } from '../platform/services.ts';
import { writeHashCode } from '../platform/web.ts';
import { encodeTrack } from '../track/code.ts';
import { groundPose, type GroundPose } from '../track/ground.ts';
import { locatorFor } from '../track/locator.ts';
import { surfaceFor, terrainHeight } from '../track/surface.ts';
import type { Track } from '../track/track.ts';
import { buildPitBoxMesh } from '../render/pitBoxMesh.ts';
import { RacingLineOverlay } from '../render/racingLineOverlay.ts';
import { AssistsPanel } from '../ui/assistsPanel.ts';
import { timeFor } from '../ui/conditionsPanel.ts';
import { ControlsPanel } from '../ui/controlsPanel.ts';
import { button, h } from '../ui/dom.ts';
import { Hud } from '../ui/hud.ts';
import { PauseMenu } from '../ui/pauseMenu.ts';
import { TouchControls } from '../ui/touchControls.ts';
import { GridOverlay, type GridEntry } from '../ui/gridOverlay.ts';
import { AiDriver, aiField, aiPace, gridOrder, gridPlace, qualifyingOrder, YOU } from './ai.ts';
import { RacingDriver } from './driver.ts';
import { raceOrder } from './classify.ts';
import { RaceControl, type ControlCar, type ControlEvent } from './raceControl.ts';
import { sampleAt, leftOf } from '../track/spline.ts';
import { GhostRecorder, ghostPose, type GhostLap } from './ghost.ts';
import { applyAssists, assistDriver } from './assists.ts';
import { AuthorLap, medalTimes } from './medals.ts';
import { PitCrew, pitBox } from './pitStop.ts';
import { pitLoss, suggestedSetup, trackLapTime, trackTyreLife } from './strategy.ts';
import { Weather } from './weather.ts';
import type { TimeOfDay } from '../config/track.ts';
import { formatGap, GapTracker } from './timing.ts';
import { TimingTower, type TowerRow } from '../ui/timingTower.ts';
import { scoreFor, type Standing } from './records.ts';
import { formatDelta, formatTime, RaceSession, type Progress, type RaceEvent } from './session.ts';

const BRAKE: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };
/** The pit crew holding the car still (the handbrake, as the brake would reverse it at a standstill). */
const HOLD: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: true };

/** Two presses of R (or gamepad Back) this close together restart the lap in practice. */
const DOUBLE_TAP = 0.5;

/**
 * Watching the rest of a race once yours is over (a championship round, where
 * every car's result counts): fast-forward, at most this many physics ticks a
 * frame and this long (ms) spent on them, so a slow device just watches slower.
 */
const WATCH = { ticks: 24, budget: 9 } as const;

/** An AI car in the race: its driver, what's drawn, and its name tag. */
interface Opponent {
  /** Who it is (a championship's driver id; else its number in the field). */
  id: string;
  ai: AiDriver;
  model: CarModel;
  view: CarState;
  label: HTMLElement;
  prev: Progress;
  /** A mechanical failure to come: the race distance (m) it breaks down at, or null. */
  failAt: number | null;
  /** Retired: how long it has stood where it stopped (s). */
  outFor: number;
}

/** A car of the field: an AI's name, colour and pace, and in a championship who it is, its pit box and its luck. */
type FieldCar = { name: string; paint: number; secondary?: number; difficulty: number } & Partial<Pick<EventCar, 'id' | 'box' | 'failAt' | 'tune'>>;

/** A car in the race order. */
interface Entry {
  /** 0 = you, k + 1 = AI car k. */
  idx: number;
  name: string;
  you: boolean;
  paint: number;
  session: RaceSession;
  /** Where it started (m along the track, negative = behind the line). */
  start: number;
  /** Session time it finished, or null. */
  end: number | null;
  /** How far round the race it is (see RaceSession.raceDistance). */
  dist: number;
  /** Retired (broken down): out of the race, behind everyone still in it. */
  out: boolean;
}

const hexColour = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * RACE state: the current track, driven as the race setup says: free practice
 * laps, or a race of 1–10 laps against your ghost and up to eleven AI cars.
 * With a qualifying grid, the race starts with a qualifying session alone on
 * the track (the AI cars' laps are simulated meanwhile), then shows the grid.
 * The setup's conditions apply to every car: rain (less grip and braking, a
 * wet look and sound), the time of day (at night the cars' lights come on),
 * and tyre wear, with the pit box painted on the start straight: stop in it
 * for new tyres.
 * Physics, lap timing and ghost recording all run on the fixed 120 Hz tick;
 * rendering interpolates between the last two ticks, so everything is identical
 * at 60, 144 or 240 Hz.
 */
export class RaceScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly hud: Hud;
  private readonly pauseMenu: PauseMenu;
  private readonly assistsPanel = new AssistsPanel();
  private readonly controlsPanel = new ControlsPanel();
  /** The racing line on the road (built for the track when first shown). */
  private lineOverlay: RacingLineOverlay | null = null;
  private readonly input = new InputManager();
  private readonly touch: TouchControls;
  private readonly fixed = new FixedStep(HANDLING.tickRate);
  private readonly rig = new CameraRig();
  private readonly model: CarModel | null;
  private readonly ghostModel: CarModel | null;
  /** AI cars: one model and name tag per possible opponent, reused between runs. */
  private readonly aiModels: CarModel[] = [];
  private readonly aiLabels: HTMLElement[] = [];
  private opponents: Opponent[] = [];
  /** The player's car state first, then the AI cars' (for traffic and contact). */
  private states: CarState[] = [];
  private readonly aiEvents: RaceEvent[] = [];
  /** Slipstream for each car in `states` this tick. */
  private readonly drafts = new Float32Array(AI.maxField + 1);
  /** The cars on the track, as indices (0 = you, k + 1 = AI car k), in step with `states`. */
  private live: number[] = [0];
  /** Cars taken off the track, by the same index: retired ones once the marshals have them, and yours while the rest of the race is watched. */
  private gone: boolean[] = [];
  /** The chequered flag is out: somebody has finished, so everyone else finishes at the end of the lap they're on. */
  private flagOut = false;
  /** Your race is over and the rest of it is being watched, fast-forward (championship rounds); for how long (s of race time), and the car followed. */
  private watching = false;
  private watchTime = 0;
  private watchIdx = -1;
  private readonly watchBar: HTMLElement;
  /** In practice: you've been told the car has broken down. */
  private brokenTold = false;
  private lastResetPress = -Infinity;
  /** What's being driven: qualifying (alone, for the grid), the grid on show after it, or the run itself. */
  private stage: 'qualifying' | 'grid' | 'run' = 'run';
  /** The grid this race started from (car ids by slot, pole first), reused by Restart. */
  private grid: number[] = [YOU];
  /** The AI cars' qualifying laps, simulated a slice at a time while you qualify. */
  private qualSims: AuthorLap[] = [];
  /** Where the player started (m along the track). */
  private playerStart = -8;
  private readonly gridOverlay: GridOverlay;
  /** 1-based race position (with AI cars), or null. */
  private position: number | null = null;
  private car: CarPhysics | null = null;
  private carTrack: Track | null = null;
  private session: RaceSession | null = null;
  private readonly recorder = new GhostRecorder();
  /** Ghost being replayed this lap (the best lap when the lap started). */
  private ghost: GhostLap | null = null;
  private readonly view = new CarState();
  private readonly ghostLabel: HTMLElement;
  private readonly labelPos = new Vector3();
  /** Ghost's ground pose and its last track index (a hint for the locator). */
  private readonly ghostGround: GroundPose = { y: 0, pitch: 0, roll: 0 };
  private ghostIndex = -1;
  /** Strongest barrier hit since the last frame (m/s into the wall). */
  private hit = 0;
  /** Bot lap being simulated (a few slices per frame) to set this track's medal times. */
  private author: { id: string; lap: AuthorLap } | null = null;
  private readonly tickInput: DriveInput = { ...NO_INPUT };
  private readonly events: RaceEvent[] = [];
  private paused = false;
  private finishedFor = -1;
  private abort: AbortController | null = null;
  private fpsTime = 0;
  private fpsFrames = 0;
  /** This run's conditions: rain, and tyre wear (with the player's pit crew and the box on the road). */
  private wet = false;
  private crew: PitCrew | null = null;
  private pitMesh: Mesh | null = null;
  private pitMeshTrack: Track | null = null;
  private pitMeshBox = 0;
  /** Tyre warnings shown for this set: 1 = going off soon, 2 = gone off. */
  private tyreWarned = 0;
  /** The tyres to fit at the pit stop under way (picked with 1–4 or a tap). */
  private nextTyres: Compound = 'medium';
  /** The weather the racing line was built for. */
  private lineWet = false;
  /** The weather this run (changing weather: the road gets wet and dries), the time of day, and whether it's raining (for the messages). */
  private weather = new Weather('dry', Infinity);
  private timeOfDay: TimeOfDay = 'day';
  private raining = false;
  /** The timing tower, the gaps it shows, and when it's next refreshed (s). */
  private readonly tower = new TimingTower();
  /** Yellow flags and the safety car (races only), the cars as it sees them, and what it said this tick. */
  private control: RaceControl | null = null;
  private readonly controlCars: ControlCar[] = [];
  private readonly controlEvents: ControlEvent[] = [];
  /** Each car's hardest hit this tick (the player first). */
  private hits: number[] = [];
  /** The damage warnings already given this run. */
  private damageWarned = 0;
  /** The safety car's model (drawn ahead of the leader while it's out). */
  private readonly scModel: CarModel | null;
  /** Dev builds only, with ?autopilot in the URL: the player's car drives itself (for recording trailers). */
  private autopilot: RacingDriver | null = null;
  private gaps: GapTracker | null = null;
  private towerIn = 0;

  constructor(game: GameContext) {
    this.game = game;
    this.hud = new Hud({
      drawTrack: () => this.game.go('editor'),
      pause: () => this.setPaused(true),
      startRace: () => this.game.openSetup({ mode: 'race' }),
    });
    this.pauseMenu = new PauseMenu({
      resume: () => this.setPaused(false),
      resetCar: () => {
        this.resetCar();
        this.setPaused(false);
      },
      restart: () => this.restart(),
      raceSettings: () => this.game.openSetup(),
      assists: () => this.assistsPanel.open(this.game.ui, () => this.pauseMenu.show(this.controlsText())),
      controls: () => this.controlsPanel.open(this.game.ui, () => this.pauseMenu.show(this.controlsText())),
      skipQualifying: () => this.showGrid(),
      mainMenu: () => this.game.go('menu'),
      drawTrack: () => this.game.go('editor'),
      myTracks: () => this.game.go('library'),
      toggleSound: () => this.toggleSound(),
      paddock: () => this.leaveEvent(),
    });
    this.gridOverlay = new GridOverlay({
      start: () => this.startRace(this.grid),
      settings: () => (this.game.event ? this.game.event.leave() : this.game.openSetup()),
    });
    this.watchBar = h('div', { class: 'watch-bar' }, h('span', { class: 'watch-text', text: STR.race.watching }), button(STR.race.watchSkip, () => this.endWatching(), { icon: '⏭', class: 'compact', key: 'Enter' }));
    this.watchBar.hidden = true;
    this.touch = new TouchControls(this.input.touch);
    this.input.onAction = (a) => this.onAction(a);
    this.model = game.view3d ? new CarModel(currentPaintHex()) : null;
    this.ghostModel = game.view3d ? new CarModel(currentPaintHex(), RACE.ghostOpacity) : null;
    this.scModel = game.view3d ? new CarModel(0xf4f4f0) : null;
    if (this.scModel) {
      this.scModel.root.visible = false;
      game.view3d?.scene.add(this.scModel.root);
    }
    this.ghostLabel = h('div', { class: 'ghost-label', text: STR.race.ghostYou });
    this.ghostLabel.hidden = true;
    this.hud.root.append(this.ghostLabel, this.tower.root, this.watchBar);
    this.tower.onToggle = (mode) => {
      updateSettings({ tower: mode });
      this.towerIn = 0;
    };
    // Logged-in CrazyGames players see their username on their ghost (no other login exists).
    void platform.username().then((name) => {
      if (name) this.ghostLabel.textContent = fmt(STR.race.ghostUser, { name });
    });
    this.model?.addHeadlight();
    if (this.model && this.ghostModel) {
      this.ghostModel.root.visible = false;
      game.view3d?.scene.add(this.model.root, this.ghostModel.root);
      for (let k = 0; k < AI.maxField; k++) {
        const m = new CarModel(PAINTS[(k + 1) % PAINTS.length].hex);
        m.root.visible = false;
        this.aiModels.push(m);
        game.view3d?.scene.add(m.root);
        const label = h('div', { class: 'ghost-label ai-label' });
        label.hidden = true;
        this.aiLabels.push(label);
        this.hud.root.append(label);
      }
    }
  }

  enter(): void {
    const t = this.game.track;
    this.game.ui.append(this.hud.root, this.gridOverlay.root, this.pauseMenu.root);
    this.hud.showMinimap(settings().minimap);
    this.game.view3d?.setQuality(settings().graphics);
    const ev = this.game.event;
    const info = fmt(STR.race.trackInfo, { name: t.def.name, len: Math.round(t.center.length) });
    this.hud.setTrackInfo(ev ? `${ev.title} · ${info}` : info);
    this.hud.setCareer(!!ev);
    this.pauseMenu.setCareer(!!ev);
    this.gridOverlay.setCareer(!!ev);
    const v = this.game.view3d;
    if (!v) {
      this.hud.showHint(STR.errors.webgl, 1e9);
      return;
    }
    v.setTrack(t);
    if (this.carTrack !== t) {
      this.car = new CarPhysics(t);
      this.carTrack = t;
      const terrain = surfaceFor(t).terrain;
      this.rig.groundAt = (x, z) => terrainHeight(terrain, x, z);
    }
    const touch = prefersTouchControls(platform.deviceType());
    this.hud.setTouchLayout(touch);
    if (touch) {
      this.game.ui.insertBefore(this.touch.root, this.pauseMenu.root); // pause menu stays on top
      this.input.lastDevice = 'touch';
    }
    this.input.attach();
    this.abort = new AbortController();
    document.addEventListener('visibilitychange', () => document.hidden && this.setPaused(true), {
      signal: this.abort.signal,
    });
    // In a pit stop, 1–4 pick the tyres.
    window.addEventListener(
      'keydown',
      (e) => {
        const n = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
        if (!n || !this.crew?.busy || this.paused || e.repeat) return;
        this.pickTyres(TYRES.order[Number(n[1]) - 1]);
      },
      { signal: this.abort.signal },
    );
    // Watching the rest of the race: Enter skips to the results.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.watching || this.paused || e.repeat || (e.code !== 'Enter' && e.code !== 'NumpadEnter')) return;
        e.preventDefault();
        this.endWatching();
      },
      { signal: this.abort.signal },
    );
    this.startRun();
    this.hud.showHint(this.controlsText());
  }

  exit(): void {
    this.input.detach();
    this.touch.release();
    this.abort?.abort();
    this.abort = null;
    this.hud.root.remove();
    this.pauseMenu.root.remove();
    this.gridOverlay.hide();
    this.gridOverlay.root.remove();
    this.qualSims = [];
    this.watching = false;
    this.watchBar.hidden = true;
    this.hud.root.classList.remove('watching');
    if (this.model) this.model.root.visible = true;
    this.touch.root.remove();
    this.hud.clearFlash();
    this.assistsPanel.close();
    this.controlsPanel.close();
    if (this.lineOverlay) this.lineOverlay.mesh.visible = false;
    if (this.pitMesh) this.pitMesh.visible = false;
    this.tower.hide();
    if (this.ghostModel) this.ghostModel.root.visible = false;
    this.ghostLabel.hidden = true;
    this.clearOpponents();
    audio.setEngine(false);
    audio.setRain(false);
    this.game.view3d?.setConditions(null);
  }

  /** The setup's weather and time of day on the view, the cars' lights and the sound; the pit box with tyre wear. */
  private applyConditions(): void {
    const setup = this.game.setup;
    const t = this.game.track;
    const v = this.game.view3d;
    // (Changing weather starts dry: see updateWeather().)
    this.wet = setup.weather === 'rain';
    this.raining = this.wet;
    this.timeOfDay = timeFor(setup, t.options.time);
    audio.setRain(this.wet);
    if (!v) return;
    v.setConditions({ time: this.timeOfDay, rain: this.wet });
    // (A real light costs on slow GPUs: with fast graphics only the lamps glow.)
    for (const m of [this.model, ...this.aiModels]) m?.setLights(v.night, settings().graphics === 'full');
    const pitting = setup.tyreWear || (setup.damage && setup.mode === 'race');
    const box = this.myBox;
    if (pitting && (this.pitMeshTrack !== t || this.pitMeshBox !== box)) {
      if (this.pitMesh) {
        v.scene.remove(this.pitMesh);
        this.pitMesh.geometry.dispose();
      }
      this.pitMesh = buildPitBoxMesh(t, pitBox(t, box));
      this.pitMeshTrack = t;
      this.pitMeshBox = box;
      v.scene.add(this.pitMesh);
    }
    if (this.pitMesh) this.pitMesh.visible = pitting && this.pitMeshTrack === t;
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  /**
   * New run as the setup says. Practice starts at once, alone, and never ends.
   * A race has a countdown, the setup's laps and AI cars, on a grid that is
   * picked, drawn at random, or set by a qualifying session first.
   */
  startRun(): void {
    const ev = this.game.event;
    if (ev) {
      // A championship round: practice alone, qualifying first, or (qualifying done) the race from its grid.
      if (ev.session === 'practice') this.startRace([YOU]);
      else if (ev.session === 'qualifying' && !ev.grid) this.startQualifying();
      else this.startRace(this.eventOrder(ev.grid ?? []));
      return;
    }
    const setup = this.game.setup;
    const ai = setup.mode === 'race' ? Math.min(setup.opponents, this.aiModels.length) : 0;
    if (ai > 0 && setup.grid === 'qualifying') this.startQualifying();
    else this.startRace(ai > 0 ? gridOrder(setup.grid, ai, setup.startSlot) : [YOU]);
  }

  /** A championship grid (driver ids, pole first) as car ids by slot; anyone it leaves out starts at the back, you last. */
  private eventOrder(grid: readonly string[]): number[] {
    const ev = this.game.event;
    if (!ev) return [YOU];
    const field = ev.field.slice(0, this.aiModels.length);
    const order: number[] = [];
    for (const id of grid) {
      const k = id === ev.you.id ? YOU : field.findIndex((f) => f.id === id);
      if ((k === YOU || k >= 0) && !order.includes(k)) order.push(k);
    }
    field.forEach((_, k) => !order.includes(k) && order.push(k));
    if (!order.includes(YOU)) order.push(YOU);
    return order;
  }

  /** Your colour and name: your team's in a championship, else the paint you picked and "You". */
  private get myPaint(): number {
    return this.game.event?.you.paint ?? currentPaintHex();
  }

  private get myName(): string {
    return this.game.event?.you.name ?? STR.results.you;
  }

  /** Whose pit box is yours (see pitBox). */
  private get myBox(): number {
    return this.game.event?.you.box ?? 0;
  }

  /** Leaves a championship round for the paddock: unfinished, unless the race is only being watched to its end (then it counts as it stands). */
  private leaveEvent(): void {
    const ev = this.game.event;
    if (!ev) return;
    if (this.watching) this.endWatching();
    else ev.leave();
  }

  /** Restart from the pause menu: qualifying again, or the same race from the same grid. */
  private restart(): void {
    if (this.stage === 'qualifying') this.startQualifying();
    else if (this.game.mode === 'race' && this.grid.length > 1) this.startRace(this.grid);
    else this.startRun();
  }

  /** What every new run (or qualifying session) resets. */
  private resetRun(): void {
    const def = this.game.track.def;
    this.applyPaint();
    if (CAPS.links) writeHashCode(encodeTrack(def.name, def.control, def.options, def.extras));
    const rec = this.game.records.get(def.id);
    this.ghost = this.game.setup.ghost ? rec.ghost : null;
    if (rec.author === undefined && this.author?.id !== def.id) this.author = { id: def.id, lap: new AuthorLap(this.game.track) };
    this.gridOverlay.hide();
    this.ghostIndex = -1;
    this.hit = 0;
    this.finishedFor = -1;
    this.gone = [];
    this.flagOut = false;
    this.watching = false;
    this.watchTime = 0;
    this.watchIdx = -1;
    this.watchBar.hidden = true;
    this.hud.root.classList.remove('watching');
    this.brokenTold = false;
    if (this.model) this.model.root.visible = true;
    this.fixed.reset();
    this.paused = false;
    this.pauseMenu.hide();
    this.input.clear();
    this.touch.release();
    this.hud.clearFlash();
    this.hud.setPosition(null);
    this.position = null;
    if (this.ghostModel) this.ghostModel.root.visible = false;
    audio.setEngine(true);
    this.applyConditions();
    this.tyreWarned = 0;
  }

  /** The player's car for a new run: the weather, and new tyres (worn as it goes with tyre wear on). */
  private prepareCar(car: CarPhysics, wear: boolean, damage = false): void {
    car.wet = this.wet;
    car.wear = wear;
    car.damageOn = damage;
    car.repair();
    car.failed = false;
    // (In a championship your team's car: a little down on the best one, or not.)
    car.tune = this.game.event?.car ?? STANDARD_CAR;
    this.damageWarned = 0;
    car.setup = settings().carSetup;
    car.mediumLife = this.game.event?.tyreLife ?? trackTyreLife(this.game.track);
    car.newTyres(wear ? this.game.setup.tyres : 'medium');
    // (A pit crew for new tyres, or for repairs.)
    this.crew = wear || damage ? new PitCrew(this.game.track, this.myBox) : null;
    this.crew?.reset(car.state);
    this.hud.showTyrePicker(null);
  }

  /** In a pit stop: the tyres to fit (the picker shows it). */
  private pickTyres(c: Compound): void {
    if (!this.crew?.busy) return;
    this.nextTyres = c;
    this.hud.setTyrePick(c);
  }

  /** The race (or practice) itself, from grid order `order` (car ids by slot; YOU is the player). */
  private startRace(order: number[]): void {
    const car = this.car;
    if (!car) return;
    this.stage = 'run';
    this.grid = order;
    this.resetRun();
    const setup = this.game.setup;
    const t = this.game.track;
    const rec = this.game.records.get(t.def.id);
    const practice = setup.mode === 'practice';
    this.session = practice
      ? new RaceSession(t.center.length, rec.best, Infinity, t.center.width, 0)
      : new RaceSession(t.center.length, rec.best, setup.laps, t.center.width);
    this.weather = new Weather(setup.weather, practice ? Infinity : setup.laps * trackLapTime(t));
    this.startOpponents(practice ? [YOU] : order);
    if (this.opponents.length) {
      const g = gridPlace(t, order.indexOf(YOU));
      car.placeAt(g.s, g.lateral);
      this.playerStart = g.s;
    } else {
      car.placeAt(-8);
      this.playerStart = -8;
    }
    this.prepareCar(car, setup.tyreWear, setup.damage);
    this.control = setup.mode === 'race' ? new RaceControl(t.center.length, setup.laps, setup.safetyCar) : null;
    this.hits = [];
    if (this.scModel) this.scModel.root.visible = false;
    this.hud.setFlag(null);
    this.autopilot = import.meta.env.DEV && new URLSearchParams(location.search).has('autopilot') ? new RacingDriver(t, aiPace(0.8, t)) : null;
    this.syncLive();
    this.gaps = this.opponents.length ? new GapTracker(1 + this.opponents.length) : null;
    this.tower.mode = settings().tower;
    this.tower.hide();
    this.towerIn = 0;
    this.hud.setMode(setup.mode);
    this.pauseMenu.setMode(setup.mode);
    this.rig.snap(car.state);
    if (practice) this.hud.flash(STR.race.practiceGo, 'info', 1.8);
  }

  /**
   * Qualifying: you alone on the track for a few timed laps, no countdown.
   * The AI cars' flying laps are simulated in the background at their own pace.
   */
  private startQualifying(): void {
    const car = this.car;
    if (!car) return;
    this.stage = 'qualifying';
    this.resetRun();
    this.clearOpponents();
    const setup = this.game.setup;
    const t = this.game.track;
    const rec = this.game.records.get(t.def.id);
    this.session = new RaceSession(t.center.length, rec.best, AI.qualifyingLaps, t.center.width, 0);
    car.placeAt(-8);
    this.playerStart = -8;
    // Qualifying is on new tyres (no wear), in the weather of the race's start.
    this.weather = new Weather(setup.weather === 'rain' ? 'rain' : 'dry', Infinity);
    this.prepareCar(car, false);
    this.gaps = null;
    this.tower.hide();
    this.syncLive();
    this.qualSims = this.field(setup.opponents).map((f) => new AuthorLap(t, f.difficulty, false, this.wet, suggestedSetup(t), f.tune));
    this.hud.setMode('race');
    this.pauseMenu.setMode('qualifying');
    this.rig.snap(car.state);
    this.hud.flash(fmt(STR.race.qualifyingGo, { n: AI.qualifyingLaps }), 'info', 3);
  }

  /** Qualifying is over (or skipped): the grid from everyone's best lap, and Start race. */
  private showGrid(): void {
    if (this.stage !== 'qualifying') return;
    for (const sim of this.qualSims) sim.finish();
    const field = this.field(this.qualSims.length);
    const times = new Map<number, number | null>([[YOU, this.session?.bestOfRun() ?? null]]);
    this.qualSims.forEach((sim, k) => {
      const lap = sim.result ?? null;
      times.set(k, lap === null ? null : lap * (1 + (Math.random() * 2 - 1) * AI.qualifyingNoise));
    });
    const order = qualifyingOrder(times);
    this.grid = order;
    this.stage = 'grid';
    this.qualSims = [];
    this.finishedFor = -1;
    this.paused = false;
    this.pauseMenu.hide();
    this.hud.clearFlash();
    audio.setEngine(false);
    const entries: GridEntry[] = order.map((id) =>
      id === YOU
        ? { name: this.myName, paint: this.myPaint, time: times.get(YOU) ?? null, you: true }
        : { name: field[id].name, paint: field[id].paint, time: times.get(id) ?? null, you: false },
    );
    // A championship keeps the grid (so the race can be run later, or again).
    const ev = this.game.event;
    if (ev) {
      const idOf = (k: number) => (k === YOU ? ev.you.id : (field[k].id ?? String(k)));
      ev.qualified(order.map(idOf), Object.fromEntries(order.map((k) => [idOf(k), times.get(k) ?? null])));
    }
    this.gridOverlay.show(entries);
  }

  /** Qualifying shares the frame's small background-work deadline with medal timing. */
  private runQualifyingSims(deadline: number): void {
    let budget = 3000;
    for (const sim of this.qualSims) {
      if (budget <= 0) break;
      if (sim.result !== undefined) continue;
      if (!sim.run(Math.min(budget, 1500), deadline)) break;
      budget -= 1500;
    }
  }

  /** The AI cars' names, colours and difficulties, fastest first (never your colour). */
  private field(count: number): FieldCar[] {
    // A championship round brings its own field.
    const ev = this.game.event;
    if (ev) return ev.field.slice(0, Math.min(count, this.aiModels.length));
    const mine = currentPaintHex();
    const paints = [...PAINTS.map((p) => p.hex), ...AI_PAINTS].filter((hex) => hex !== mine);
    return aiField(Math.min(count, this.aiModels.length), this.game.setup.difficulty, paints, STR.ai.names);
  }

  /** AI cars in their grid slots (from `order`; the field is listed fastest first). */
  private startOpponents(order: number[]): void {
    this.clearOpponents();
    const t = this.game.track;
    const field = this.field(order.length - 1);
    const laps = this.game.setup.laps;
    field.forEach((f, k) => {
      const ai = new AiDriver(t, { name: f.name, paint: f.paint, difficulty: f.difficulty, tune: f.tune, laps, slot: order.indexOf(k), box: f.box ?? k + 1, wet: this.wet, tyreWear: this.game.setup.tyreWear, damage: this.game.setup.damage, mediumLife: this.game.event?.tyreLife });
      const model = this.aiModels[k];
      model.setPaint(f.paint, f.secondary);
      model.root.visible = true;
      const label = this.aiLabels[k];
      label.textContent = f.name;
      const failAt = f.failAt === undefined ? null : f.failAt * laps * t.center.length;
      this.opponents.push({ id: f.id ?? String(k), ai, model, view: new CarState(), label, prev: { s: 0, lateral: 0, along: 0 }, failAt, outFor: 0 });
    });
  }

  private clearOpponents(): void {
    this.opponents = [];
    for (const m of this.aiModels) m.root.visible = false;
    for (const l of this.aiLabels) l.hidden = true;
  }

  /** The cars on the track (`live`, and their states for traffic, slipstream and contact): everyone not taken off it. */
  private syncLive(): void {
    this.live = [];
    this.states = [];
    if (!this.gone[0] && this.car) {
      this.live.push(0);
      this.states.push(this.car.state);
    }
    this.opponents.forEach((o, k) => {
      if (this.gone[k + 1]) return;
      this.live.push(k + 1);
      this.states.push(o.ai.car.state);
    });
  }

  /** Takes car `idx` (0 = you) off the track: not drawn, not driven, in nobody's way. */
  private takeOff(idx: number): void {
    if (this.gone[idx]) return;
    this.gone[idx] = true;
    const o = idx > 0 ? this.opponents[idx - 1] : null;
    if (o) {
      o.model.root.visible = false;
      o.label.hidden = true;
    } else if (this.model) this.model.root.visible = false;
    this.syncLive();
  }

  /** Puts the selected paint on the car and its ghost. */
  applyPaint(): void {
    const hex = this.myPaint;
    this.model?.setPaint(hex, this.game.event?.you.secondary);
    this.ghostModel?.setPaint(hex, this.game.event?.you.secondary);
  }

  private toggleSound(): void {
    audio.toggleMute();
    this.pauseMenu.setSound(!audio.silent);
  }

  private controlsText(): string {
    const d = this.input.lastDevice;
    const manual = settings().assists.gears === 'manual';
    if (d === 'touch') return STR.race.hintTouch + (manual ? STR.race.hintGearsTouch : '');
    const practice = this.game.mode === 'practice';
    if (d === 'gamepad') return STR.race.hintGamepad + (manual ? STR.race.hintGearsGamepad : '') + (practice ? STR.race.hintRestartGamepad : '');
    return keyboardHint(settings().keys, { manual, practice, tower: this.opponents.length > 0 });
  }

  private onAction(a: InputAction): void {
    // The assists panel (over the pause menu): Esc closes it, nothing else gets through.
    if (this.assistsPanel.isOpen) {
      if (a === 'pause') this.assistsPanel.close();
      return;
    }
    if (this.controlsPanel.isOpen) return; // it keeps the keys to itself
    if (this.stage === 'grid') {
      if (a === 'mute') this.toggleSound();
      return; // the grid overlay has its own buttons
    }
    if (a === 'pause') this.setPaused(!this.paused);
    else if (a === 'mute') this.toggleSound();
    else if (this.paused) return;
    else if (a === 'reset') this.onReset();
    else if (a === 'camera') this.rig.toggle();
    else if (a === 'tower') {
      // Full → compact → hidden → full.
      const next = ({ full: 'compact', compact: 'off', off: 'full' } as const)[this.tower.mode];
      this.tower.mode = next;
      updateSettings({ tower: next });
      this.towerIn = 0;
    }
  }

  /** R puts the car back on the road; in practice, R twice quickly restarts the lap from the grid. */
  private onReset(): void {
    const now = performance.now() / 1000;
    if (this.game.mode === 'practice' && now - this.lastResetPress < DOUBLE_TAP) {
      this.lastResetPress = -Infinity;
      this.startRun();
      this.hud.flash(STR.race.lapRestarted, 'info', 1.4);
      return;
    }
    this.lastResetPress = now;
    this.resetCar();
  }

  private resetCar(): void {
    if (!this.car || !this.session?.canDrive || this.session.retired || this.watching) return;
    // (Broken down in practice: a fresh car.)
    if (this.car.broken) {
      this.car.repair();
      this.brokenTold = false;
      this.hud.clearFlash();
    }
    this.car.resetToRoad();
    this.crew?.reset(this.car.state); // (a stop under way is off)
    this.hud.showTyrePicker(null);
    this.rig.snap(this.car.state);
  }

  private setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.input.clear();
    this.touch.release();
    audio.setEngine(!p);
    this.pauseMenu.setSound(!audio.silent);
    if (p) this.pauseMenu.show(this.controlsText());
    else {
      this.pauseMenu.hide();
      this.fixed.reset(); // don't replay the time spent paused
    }
  }

  private progress(car: CarPhysics = this.car!, out?: Progress): Progress {
    const st = car.state;
    const tan = this.game.track.center.tangents[Math.max(0, st.trackIndex)];
    const p = out ?? { s: 0, lateral: 0, along: 0 };
    p.s = st.s;
    p.lateral = st.lateral;
    p.along = st.vx * tan.x + st.vz * tan.y;
    p.offTrack = st.offTrack;
    return p;
  }

  /** One fixed physics tick: inputs -> slipstream -> cars -> contact -> race rules -> ghost recording. */
  private tick(): void {
    const car = this.car!;
    const session = this.session!;
    const dt = car.dt;
    const st = this.states;
    const live = this.live;
    /** Your car is on the track (not once your race is over and the rest is being watched). */
    const mine = !this.gone[0];
    if (st.length > 1) {
      slipstream(st, this.game.track.center.length, this.drafts);
      live.forEach((idx, i) => {
        const c = this.carAt(idx);
        if (c) c.draft = carriedTow(c.draft, this.drafts[i], dt);
      });
    } else car.draft = 0;
    if ((session.phase === 'racing' || this.watching) && this.weather.kind === 'changing') this.updateWeather(dt);
    const assists = settings().assists;
    car.gearbox = assists.gears;
    let inp = session.phase === 'racing' ? this.input.sample(this.tickInput) : session.phase === 'finished' ? BRAKE : NO_INPUT;
    if (session.phase === 'racing') inp = applyAssists(this.game.track, car.state, this.tickInput, assists, this.wet, car.tune, car.setup);
    if (this.autopilot && session.phase === 'racing') inp = this.autopilot.drive(car.state);
    // Under the safety car: no faster than it lets you (the throttle is cut, and the brakes help a little).
    const control = this.control;
    if (control && control.sc !== 'none' && session.phase === 'racing' && this.controlCars.length) {
      const cap = control.cap(0, this.controlCars);
      if (car.state.speed > cap) inp = { ...inp, throttle: 0, brake: Math.max(inp.brake, car.state.speed > cap + 3 ? 0.4 : 0) };
    }
    // The pit lane: the limiter holds you to its speed limit between the lines.
    const P = PIT_LANE;
    if (car.state.inPits && car.state.speed > P.limit) inp = { ...inp, throttle: 0, brake: Math.max(inp.brake, car.state.speed > P.limit + 2 ? 0.5 : 0) };
    // In the pit box the crew holds the car while it works.
    if (this.crew?.busy) inp = HOLD;
    const prev = this.progress();
    const hits = this.hits;
    hits.length = 1 + this.opponents.length;
    hits.fill(0);
    if (mine) {
      car.step(inp);
      this.hit = Math.max(this.hit, car.state.wallHit);
      hits[0] = car.state.wallHit;
      if (this.crew && session.phase === 'racing') this.pitTick(car);
    }
    this.opponents.forEach((o, k) => {
      if (this.gone[k + 1]) return;
      this.progress(o.ai.car, o.prev);
      o.ai.car.step(o.ai.drive(st, dt));
      hits[k + 1] = o.ai.car.state.wallHit;
    });
    // Cars bump into each other. A few times over, so a car pushed out of one car and into
    // another in a pack is pushed out of that one too.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < st.length; i++) {
        for (let j = i + 1; j < st.length; j++) {
          const hit = collideCars(st[i], st[j]);
          if (live[i] === 0) this.hit = Math.max(this.hit, hit);
          // (Damage from the first push only: the others just separate the cars.)
          if (pass === 0 && hit > 0) {
            hits[live[i]] = Math.max(hits[live[i]], hit);
            hits[live[j]] = Math.max(hits[live[j]], hit);
            this.carAt(live[i])?.addDamage(hit);
            this.carAt(live[j])?.addDamage(hit);
          }
        }
      }
    }
    this.events.length = 0;
    // (Your session's clock is the race's: it keeps running when your own race is over.)
    session.step(prev, this.progress(), this.events);
    for (const e of this.events) this.onRaceEvent(e);
    this.opponents.forEach((o, k) => {
      if (this.gone[k + 1]) return;
      this.aiEvents.length = 0;
      o.ai.session.step(o.prev, this.progress(o.ai.car), this.aiEvents);
    });
    this.retirements(dt);
    this.chequeredFlag();
    if (this.control) this.raceControl(dt);
    // Timing: when each car passes each mark of the race distance.
    const gaps = this.gaps;
    if (gaps) {
      const now = session.time();
      gaps.update(0, session.raceDistance(car.state.s), now);
      this.opponents.forEach((o, k) => gaps.update(k + 1, o.ai.session.raceDistance(o.ai.car.state.s), now));
    }
    if (mine && session.lapStart !== null && session.phase === 'racing') {
      this.recorder.push(car.state.x, car.state.z, car.state.heading);
    }
  }

  /**
   * Cars that break down (damaged all the way, or in a championship a
   * mechanical failure): in a race they have retired. Yours ends your race;
   * an AI's stands where it stopped (yellow flags, maybe the safety car) until
   * the marshals have taken it away. In practice you're told to reset.
   */
  private retirements(dt: number): void {
    const car = this.car!;
    const session = this.session!;
    const R = STR.race;
    if (car.broken && session.phase === 'racing' && !this.gone[0]) {
      if (this.stage === 'run' && this.game.mode === 'race') {
        session.retire(car.state.s);
        this.crew?.reset(car.state);
        this.hud.showTyrePicker(null);
        this.hud.flash(R.brokenDown, 'bad', 0);
        audio.beep(220, 0.5, 0.25);
        audio.beep(150, 0.6, 0.25, 0.3);
        this.finishedFor = 0;
      } else if (!this.brokenTold) {
        this.brokenTold = true;
        this.hud.flash(R.brokenPractice, 'bad', 0);
        audio.beep(220, 0.4, 0.25);
      }
    }
    this.opponents.forEach((o, k) => {
      if (this.gone[k + 1]) return;
      const s = o.ai.session;
      const c = o.ai.car;
      if (o.failAt !== null && s.phase === 'racing' && s.raceDistance(c.state.s) >= o.failAt) {
        o.failAt = null;
        c.failed = true;
      }
      if (c.broken && s.phase === 'racing') {
        s.retire(c.state.s);
        o.outFor = 0;
        if (session.phase === 'racing') this.hud.flash(fmt(R.carOut, { name: o.ai.name }), 'info', 2.5);
      }
      if (!s.retired) return;
      // (Still rolling counts a little, so one that never quite stops goes too.)
      o.outFor += Math.abs(c.state.speed) < 1 ? dt : dt / 4;
      if (o.outFor >= DAMAGE.recoverAfter) this.takeOff(k + 1);
    });
  }

  /**
   * The chequered flag: once anyone has finished the race, every other car
   * finishes the next time it crosses the line, however many laps it has done
   * (so a lapped car is classified a lap down, not left to drive them all).
   */
  private chequeredFlag(): void {
    if (this.flagOut || this.stage !== 'run' || !this.opponents.length) return;
    const s = this.session!;
    const done = (x: RaceSession) => x.phase === 'finished' && !x.retired;
    if (!done(s) && !this.opponents.some((o) => done(o.ai.session))) return;
    this.flagOut = true;
    s.flagged = true;
    for (const o of this.opponents) o.ai.session.flagged = true;
    // (Lapped: this lap is your last.)
    if (s.phase === 'racing' && s.laps.length < s.lapsToRun - 1) this.hud.flash(STR.race.flagOut, 'info', 3);
  }

  /** Car `i` of `states` (0 = you). */
  private carAt(i: number): CarPhysics | null {
    return i === 0 ? this.car : (this.opponents[i - 1]?.ai.car ?? null);
  }

  /**
   * Race control for this tick: incidents, yellow flags and the safety car
   * from every car's state, then the AI cars' caps and caution from it, and
   * what to tell you.
   */
  private raceControl(dt: number): void {
    const control = this.control!;
    const session = this.session!;
    const cars = this.controlCars;
    cars.length = 0;
    // (A retired car still standing on the track is an incident, until it's been taken away.)
    const entry = (idx: number, st: CarState, s: typeof session, pitting: boolean, hit: number): ControlCar => ({
      st,
      dist: s.raceDistance(st.s),
      racing: !this.gone[idx] && (s.retired || (s.phase === 'racing' && s.lapStart !== null && !pitting)),
      hit,
      out: s.retired || !!this.gone[idx],
    });
    // (A car in the pit lane isn't stuck on the track, however slow it goes.)
    cars.push(entry(0, this.car!.state, session, !!this.crew?.busy || this.car!.state.inPits, this.hits[0] ?? 0));
    this.opponents.forEach((o, k) => cars.push(entry(k + 1, o.ai.car.state, o.ai.session, o.ai.pitting || o.ai.car.state.inPits || (o.ai.session.phase === 'finished' && !o.ai.session.retired), this.hits[k + 1] ?? 0)));
    const ev = this.controlEvents;
    ev.length = 0;
    control.step(dt, cars, ev);
    this.opponents.forEach((o, k) => {
      o.ai.raceCap = control.cap(k + 1, cars);
      o.ai.yellow = control.yellowAt(o.ai.car.state.s);
    });
    const R = STR.race;
    for (const e of ev) {
      if (e.type === 'sc-out') {
        this.hud.flash(R.safetyCarOut, 'bad', 3);
        audio.beep(440, 0.25);
      } else if (e.type === 'sc-in') this.hud.flash(R.safetyCarIn, 'info', 3);
      else if (e.type === 'green') {
        this.hud.flash(R.greenFlag, 'good', 2.5);
        audio.beep(990, 0.15);
      }
    }
    // Your damage, as it gets worse.
    const car = this.car!;
    if (car.damageOn && !car.broken) {
      const warn = DAMAGE.warnAt.filter((x) => car.damage >= x).length;
      if (warn > this.damageWarned) {
        this.damageWarned = warn;
        this.hud.flash(warn >= 2 ? R.damageHeavy : R.damageLight, warn >= 2 ? 'bad' : 'info', 2.5);
      }
    }
  }

  /**
   * Changing weather: moves it on, and sets how wet the road is under each car
   * (the racing line dries first, so a car off it is on a wetter road).
   */
  private updateWeather(dt: number): void {
    const w = this.weather;
    w.step(dt);
    const line = assistDriver(this.game.track);
    const wetAt = (st: CarState) => w.wetnessAt(st.lateral - line.lateralAt(st.s));
    if (this.car) this.car.wetness = wetAt(this.car.state);
    for (const o of this.opponents) o.ai.car.wetness = wetAt(o.ai.car.state);
    this.wet = w.lineWet >= 0.5;
    const raining = w.rain > 0.3;
    if (raining !== this.raining) {
      this.raining = raining;
      this.hud.flash(raining ? STR.weather.started : STR.weather.stopped, 'info', 2.5);
    }
  }

  /** The weather on screen and in the speakers, and the HUD's weather line (changing weather only). */
  private showWeather(v: NonNullable<GameContext['view3d']>): void {
    const w = this.weather;
    if (w.kind !== 'changing') {
      this.hud.setWeather(null);
      return;
    }
    const q = (x: number) => Math.round(x * 20) / 20;
    v.setConditions({ time: this.timeOfDay, rain: q(w.rain), wet: q((w.lineWet + w.offWet) / 2) });
    audio.setRain(w.rain);
    const W = STR.weather;
    const now = w.rain > 0.6 ? W.rain : w.rain > 0.05 ? W.light : W.dry;
    const pct = (x: number) => Math.round(x * 100);
    let text = `${now} · ${fmt(W.track, { n: pct(w.offWet) })}`;
    if (Math.abs(w.lineWet - w.offWet) > 0.08) text += ` · ${fmt(W.line, { n: pct(w.lineWet) })}`;
    const f = w.forecast();
    if (f) text += `\n${fmt(f.to === 'rain' ? W.rainIn : W.dryIn, { s: Math.max(5, Math.round(f.in / 5) * 5) })}`;
    this.hud.setWeather(text);
  }

  /** The player's pit stop (stopped in the box: new tyres), and warnings as the tyres wear. */
  private pitTick(car: CarPhysics): void {
    const ev = this.crew?.step(car, car.dt, this.nextTyres);
    if (ev === 'start' && !car.wear) {
      this.hud.flash(STR.race.repairing, 'info', this.crew?.service ?? CONDITIONS.service);
      audio.beep(660, 0.12);
    } else if (ev === 'start') {
      // The same kind again unless you pick another (1–4, or a tap) while the crew works.
      this.nextTyres = car.compound;
      this.hud.showTyrePicker({
        choices: TYRES.order.map((c) => ({ compound: c, laps: compoundLife(c, car.wetness, car.mediumLife) })),
        selected: this.nextTyres,
        pick: (c) => this.pickTyres(c),
      });
      this.hud.flash(STR.race.pitIn, 'info', CONDITIONS.service);
      audio.beep(660, 0.12);
    } else if (ev === 'done' && !car.wear) {
      this.damageWarned = 0;
      this.hud.flash(STR.race.repaired, 'good', 1.4);
      audio.beep(990, 0.12);
    } else if (ev === 'done') {
      this.tyreWarned = 0;
      this.damageWarned = 0;
      this.hud.showTyrePicker(null);
      this.hud.flash(fmt(STR.race.pitDone, { tyres: STR.tyres.names[car.compound] }), 'good', 1.4);
      audio.beep(990, 0.12);
      audio.beep(1320, 0.16, 0.22, 0.12);
    }
    const left = car.tyreLeft;
    if (left <= 0 && this.tyreWarned < 2) {
      this.tyreWarned = 2;
      this.hud.flash(STR.race.tyresGone, 'bad', 2.5);
      audio.beep(300, 0.2);
    } else if (left < 1 - TYRES.wornAt && this.tyreWarned < 1) {
      this.tyreWarned = 1;
      this.hud.flash(STR.race.tyresWorn, 'info', 2.5);
    }
  }

  private onRaceEvent(e: RaceEvent): void {
    const s = this.session!;
    const lapStarted = () => {
      // Ghost: the best lap so far (if it's switched on); recorder: this new lap.
      this.ghost = this.game.setup.ghost ? this.game.records.get(this.game.track.def.id).ghost : null;
      this.recorder.start(s.tick * s.dt - (s.lapStart ?? 0));
    };
    switch (e.type) {
      case 'count':
        this.hud.flash(String(e.n), 'big', 1.2);
        audio.beep(520);
        break;
      case 'go':
        this.hud.flash(STR.race.go, 'big', 0.8);
        audio.beep(1040, 0.45, 0.28);
        break;
      case 'lapStart':
        lapStarted();
        break;
      case 'split':
        if (e.delta !== null) this.hud.showSplit(formatDelta(e.delta), e.delta < 0);
        break;
      case 'lap': {
        if (e.valid && this.game.event?.session === 'practice') this.game.event.practised?.(e.time);
        const rec = this.game.records.get(this.game.track.def.id);
        if (e.best) {
          rec.best = s.best;
          rec.ghost = this.recorder.take();
          this.game.records.save(this.game.track.def.id);
        }
        if (e.best) [880, 1110, 1320].forEach((f, i) => audio.beep(f, 0.16, 0.2, i * 0.11));
        else audio.beep(e.valid ? 880 : 300, 0.18);
        if (s.phase === 'finished') {
          const pos = this.opponents.length ? this.standings().findIndex((x) => x.you) : -1;
          this.hud.setFlag(null);
          if (this.stage === 'qualifying') this.hud.flash(STR.race.qualifyingDone, 'big', 0);
          else this.hud.flash(pos >= 0 ? fmt(STR.race.finishedPos, { pos: STR.results.ordinals[pos] }) : STR.race.finished, 'big', 0);
        }
        else if (e.best) this.hud.flash(STR.race.newBest, 'good');
        else if (e.missed) this.hud.flash(fmt(STR.race.lapMissed, { n: e.lap, time: formatTime(e.time) }), 'bad', 2.2);
        else if (!e.valid) this.hud.flash(fmt(STR.race.lapCut, { n: e.lap, time: formatTime(e.time) }), 'bad', 2.2);
        else this.hud.flash(fmt(STR.race.lapTime, { n: e.lap, time: formatTime(e.time) }), 'info');
        if (s.phase !== 'finished' && s.laps.length === s.lapsToRun - 1) this.hud.flash(STR.race.finalLap, e.best ? 'good' : 'info');
        if (s.phase !== 'finished') lapStarted();
        break;
      }
      case 'missedCheckpoint':
        this.hud.flash(STR.race.missedCheckpoint, 'bad', 2);
        audio.beep(220, 0.25, 0.22);
        break;
      case 'trackLimits':
        this.hud.flash(STR.race.trackLimits, 'bad', 2);
        audio.beep(220, 0.25, 0.22);
        audio.beep(180, 0.3, 0.22, 0.18);
        break;
      case 'finished':
        this.finishedFor = 0;
        break;
      case 'wrongWay':
        if (e.on) this.hud.flash(STR.race.wrongWay, 'bad', 0);
        else this.hud.clearFlash();
        break;
    }
  }

  /** Builds the result of the finished run and switches to the results screen. */
  private showResults(): void {
    const s = this.session!;
    const t = this.game.track;
    const rec = this.game.records.get(t.def.id);
    // Only clean laps score; a run with none scores nothing.
    const bestOfRun = s.bestOfRun();
    const { avg, score } = bestOfRun === null ? { avg: 0, score: 0 } : scoreFor(t.center.length, bestOfRun);
    const newBestScore = score > rec.bestScore;
    if (newBestScore) {
      rec.bestScore = score;
      this.game.records.save(t.def.id);
    }
    // Celebrate a personal best, at most once per run.
    if (s.newBest || newBestScore) platform.happytime();
    const unlockedPaints = recordFinishedRun();
    const order = this.finishingOrder();
    this.game.lastResult = {
      trackId: t.def.id,
      trackName: t.def.name,
      laps: [...s.laps],
      lapValid: [...s.lapValid],
      total: s.totalTime() ?? 0,
      bestLap: bestOfRun,
      recordLap: rec.best?.time ?? bestOfRun,
      newRecord: s.newBest,
      avgSpeedKmh: avg,
      score,
      bestScore: rec.bestScore,
      newBestScore,
      carX: this.car!.state.x,
      carZ: this.car!.state.z,
      unlockedPaints,
      author: rec.author ?? null,
      dnf: s.retired,
      standings: order.standings,
      position: order.position,
    };
    // A championship round reports to the career (which shows the result and the standings).
    const ev = this.game.event;
    if (ev && order.standings) {
      const rows = order.standings;
      const clean = rows.filter((r) => r.best !== null && r.best !== undefined);
      const fastest = clean.length ? clean.reduce((a, b) => ((b.best as number) < (a.best as number) ? b : a)) : null;
      ev.finished({
        order: rows.map((r) => r.id ?? ''),
        dnf: rows.filter((r) => r.dnf).map((r) => r.id ?? ''),
        fastest: fastest?.id ?? null,
        times: rows.map((r) => (r.dnf || r.estimated ? null : r.time)),
        laps: rows.map((r) => r.laps ?? 0),
        estimated: rows.some((r) => r.estimated),
      });
      return;
    }
    this.game.go('results');
  }

  /** Your race is over in a championship round: the rest of it runs on, fast-forward, seen from the car in front, until everyone has finished. */
  private startWatching(): void {
    this.watching = true;
    this.watchTime = 0;
    this.watchIdx = -1;
    // (Your car is cleared away: nobody is driving it.)
    this.takeOff(0);
    this.crew?.reset(this.car!.state);
    this.hud.showTyrePicker(null);
    this.input.clear();
    this.touch.release();
    audio.setEngine(false);
    this.hud.clearFlash();
    this.hud.setFlag(null);
    this.watchBar.hidden = false;
    this.hud.root.classList.add('watching');
    if (this.ghostModel) this.ghostModel.root.visible = false;
  }

  /** Stops watching and shows the results (cars still racing are placed as they stand). */
  private endWatching(): void {
    if (!this.watching) return;
    this.watching = false;
    this.watchBar.hidden = true;
    this.hud.root.classList.remove('watching');
    this.paused = false;
    this.pauseMenu.hide();
    this.showResults();
  }

  /** AI cars still racing (not finished, not retired). */
  private stillRacing(): boolean {
    return this.opponents.some((o) => o.ai.session.phase !== 'finished');
  }

  /** While watching: the car the camera follows: the first one still racing (kept until it has finished), else the winner. */
  private watched(): Opponent | null {
    const cur = this.watchIdx > 0 ? this.opponents[this.watchIdx - 1] : null;
    if (cur && !this.gone[this.watchIdx] && cur.ai.session.phase === 'racing') return cur;
    const order = this.standings().filter((e) => e.idx > 0 && !this.gone[e.idx]);
    const next = order.find((e) => e.session.phase !== 'finished') ?? order[0];
    if (!next) return null;
    if (next.idx !== this.watchIdx) {
      this.watchIdx = next.idx;
      this.rig.snap(this.opponents[next.idx - 1].ai.car.state);
    }
    return this.opponents[next.idx - 1];
  }

  /**
   * Everyone in race order: by how far round the race they are (a car that
   * has finished has done its laps; of two that finished on the same lap, the
   * one that crossed the line first), then the cars that retired, the one
   * that got furthest first.
   */
  private standings(): Entry[] {
    const you: Entry = {
      idx: 0,
      name: this.myName,
      you: true,
      paint: this.myPaint,
      session: this.session!,
      start: this.playerStart,
      end: this.session!.runEnd,
      dist: this.session!.raceDistance(this.car!.state.s),
      out: this.session!.retired,
    };
    const ai = this.opponents.map((o, k): Entry => ({
      idx: k + 1,
      name: o.ai.name,
      you: false,
      paint: o.ai.paint,
      session: o.ai.session,
      start: o.ai.start,
      end: o.ai.session.runEnd,
      dist: o.ai.session.raceDistance(o.ai.car.state.s),
      out: o.ai.session.retired,
    }));
    return raceOrder([you, ...ai]);
  }

  /**
   * The finishing order for the results (races with AI cars only). Times run
   * from GO; a car still racing when the results are shown gets an estimate
   * from its average speed so far, to the end of the lap it's on if the flag
   * is out. Retired cars have no time.
   */
  private finishingOrder(): { standings: Standing[] | null; position: number | null } {
    if (!this.opponents.length) return { standings: null, position: null };
    const s = this.session!;
    const L = s.length;
    const total = s.lapsToRun * L;
    const now = s.time();
    let last = 0;
    const order = this.standings();
    const winnerLaps = order[0].session.laps.length;
    const ev = this.game.event;
    const standings = order.map((e): Standing => {
      const laps = e.session.laps;
      const clean = laps.filter((_, i) => e.session.lapValid[i]);
      const row = { id: e.you ? (ev?.you.id ?? 'you') : (this.opponents[e.idx - 1]?.id ?? ''), name: e.name, you: e.you, paint: e.paint, laps: laps.length, best: clean.length ? Math.min(...clean) : null };
      if (e.out) return { ...row, time: 0, estimated: false, dnf: true, lapsDown: 0 };
      let time: number;
      if (e.end !== null) time = e.end - e.session.goTime;
      else {
        const elapsed = Math.max(0.1, now - e.session.goTime);
        const speed = Math.max(1, (e.dist - e.start) / elapsed);
        const to = this.flagOut ? Math.min(total, (Math.floor(Math.max(0, e.dist) / L) + 1) * L) : total;
        time = elapsed + Math.max(0, to - e.dist) / speed;
      }
      time = Math.max(time, last + 0.01);
      last = time;
      return { ...row, time, estimated: e.end === null, dnf: false, lapsDown: e.end !== null ? Math.max(0, winnerLaps - laps.length) : 0 };
    });
    const mine = standings.findIndex((x) => x.you);
    return { standings, position: standings[mine]?.dnf ? null : mine + 1 };
  }

  /** Keeps a name tag above a car on screen (hidden when off-screen or far away). */
  private placeLabel(el: HTMLElement, pose: { x: number; z: number } | null, y: number, cam: PerspectiveCamera, from: { x: number; z: number } = this.view): void {
    const near = pose && Math.hypot(pose.x - from.x, pose.z - from.z) < 120;
    if (!pose || !near) {
      el.hidden = true;
      return;
    }
    const p = this.labelPos.set(pose.x, y + 2.3, pose.z).project(cam);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    el.hidden = !visible;
    if (!visible) return;
    const s = this.game.surface;
    el.style.transform = `translate(${((p.x + 1) / 2) * s.w}px, ${((1 - p.y) / 2) * s.h}px) translate(-50%, -100%)`;
  }

  /** Shows the racing line ahead of the car (built for the track the first time it's needed). */
  private updateLine(mode: 'off' | 'brake' | 'full'): void {
    const v = this.game.view3d;
    const t = this.game.track;
    if (mode === 'off' || !v || this.stage === 'grid') {
      if (this.lineOverlay) this.lineOverlay.mesh.visible = false;
      return;
    }
    // (In the rain the line brakes earlier: it's built for the weather.)
    if (this.lineOverlay?.track !== t || this.lineWet !== this.wet) {
      if (this.lineOverlay) {
        v.scene.remove(this.lineOverlay.mesh);
        this.lineOverlay.dispose();
      }
      this.lineWet = this.wet;
      this.lineOverlay = new RacingLineOverlay(t, assistDriver(t, this.wet, this.car?.tune, this.car?.setup));
      v.scene.add(this.lineOverlay.mesh);
    }
    this.lineOverlay.mesh.visible = true;
    this.lineOverlay.update(this.view.trackIndex, this.view.speed, mode);
  }

  /**
   * The timing tower: everyone in race order with the gap to you, their tyres
   * and stops, and (with tyre wear) where you'd rejoin if you stopped now.
   */
  private updateTower(): void {
    const gaps = this.gaps;
    const s = this.session;
    const car = this.car;
    if (!gaps || !s || !car || this.stage !== 'run') {
      this.tower.hide();
      return;
    }
    const T = STR.tower;
    const order = this.standings();
    const you = order.find((e) => e.you);
    if (!you) return;
    const now = s.time();
    const L = s.length;
    // Gaps are to you; once you're out of the race (retired, or watching the rest of it), to the leader.
    const ref = you.out || this.watching ? order[0] : you;
    const gapTo = (e: Entry) => (e.end !== null && ref.end !== null ? e.end - ref.end : gaps.gap(e.idx, e.dist, ref.idx, ref.dist, now));
    const rows: TowerRow[] = order.map((e, i) => {
      const o = e.idx > 0 ? this.opponents[e.idx - 1] : null;
      const phys = o ? o.ai.car : car;
      return {
        pos: i + 1,
        name: e.name,
        paint: e.paint,
        you: e.you,
        out: e.out,
        gap: e === ref || e.out ? '' : formatGap(gapTo(e), ref.dist - e.dist, L, T.lap, T.laps),
        tyre: phys.wear ? phys.compound : null,
        tyreAge: phys.tyreAge,
        tyreLeft: phys.tyreLeft,
        stops: (o ? o.ai.crew?.stops : this.crew?.stops) ?? 0,
        pit: o ? o.ai.pitting : !!this.crew?.busy,
        finished: e.end !== null,
      };
    });
    // With tyre wear: where a stop now would put you (the cars behind you by less than a stop costs get by).
    let footer: string | null = null;
    if (car.wear && s.phase === 'racing' && s.lapStart !== null && you.end === null) {
      const loss = pitLoss(this.game.track);
      let passed = 0;
      let behind: Entry | null = null;
      let most = -1;
      for (const e of order) {
        if (e.you || e.end !== null || you.dist - e.dist >= L) continue;
        const g = gapTo(e);
        if (g === null || g < 0 || g >= loss) continue;
        passed++;
        if (g > most) {
          most = g;
          behind = e;
        }
      }
      const pos = order.indexOf(you) + 1;
      footer = behind ? fmt(T.rejoin, { pos: `P${pos + passed}`, name: behind.name }) : fmt(T.rejoinKeep, { pos: `P${pos}` });
    }
    this.tower.update(rows, footer);
  }

  /** Advances the bot's timed lap a little; when done, the medal times are saved and shown. */
  private measureAuthor(deadline: number): void {
    const a = this.author;
    if (!a) return;
    if (a.id !== this.game.track.def.id) {
      this.author = null;
      return;
    }
    if (!a.lap.run(1500, deadline)) return;
    this.author = null;
    const rec = this.game.records.get(a.id);
    rec.author = a.lap.result ?? null;
    this.game.records.save(a.id);
  }

  private updateHud(alpha: number): void {
    const s = this.session!;
    const rec = this.game.records.get(this.game.track.def.id);
    this.hud.setMedals(rec.author ? medalTimes(rec.author) : null, rec.best?.time ?? null);
    if (this.stage !== 'run') {
      this.hud.setLap(s.lapStart === null ? STR.race.qualifying : fmt(STR.race.qualifyingLap, { n: Math.min(s.laps.length + 1, s.lapsToRun), total: s.lapsToRun }));
    } else if (this.game.mode === 'practice') {
      this.hud.setLap(s.lapStart === null ? STR.race.practice : fmt(STR.race.practiceLap, { n: s.laps.length + 1 }));
    } else if (s.lapStart === null && !this.opponents.length) this.hud.setLap(s.phase === 'countdown' ? '' : STR.race.warmup);
    else {
      // (Watching: the lap the car being followed is on.)
      const ws = (this.watching ? this.watched()?.ai.session : null) ?? s;
      this.hud.setLap(fmt(STR.race.lap, { n: Math.min(ws.laps.length + 1, ws.lapsToRun), total: ws.lapsToRun }));
    }
    this.hud.setTime(formatTime(s.lapTime(alpha) ?? 0));
    this.hud.setCut(s.lapSpoilt && s.lapStart !== null && s.phase === 'racing');
    const parts: string[] = [];
    if (s.lastLap !== null) parts.push(`${STR.race.last} ${formatTime(s.lastLap)}`);
    if (s.best) parts.push(`${STR.race.best} ${formatTime(s.best.time)}`);
    this.hud.setLastBest(parts.join(' · '));
    // Flags: the safety car, the pit limiter, or yellow flags here or just ahead.
    const control = this.control;
    const car = this.car;
    if (car && (s.phase === 'racing' || this.watching)) {
      const R = STR.race;
      if (control?.sc === 'out') this.hud.setFlag('sc', R.safetyCar);
      else if (control?.sc === 'in') this.hud.setFlag('sc', R.safetyCarInBanner);
      else if (this.watching) this.hud.setFlag(null);
      else if (car.state.inPits) this.hud.setFlag('pit', fmt(R.pitLimiter, { n: Math.round(PIT_LANE.limit * 3.6) }));
      else if (control && (control.yellowAt(car.state.s) || control.yellowAhead(car.state.s, 250) !== null)) this.hud.setFlag('yellow', R.yellowFlag);
      else this.hud.setFlag(null);
    } else this.hud.setFlag(null);
    this.hud.setDamage(car?.damageOn ? car.damage : null);
  }

  /** The safety car, a little way ahead of the leader on the racing line, while it's out. */
  private placeSafetyCar(): void {
    const m = this.scModel;
    const control = this.control;
    if (!m) return;
    const show = !!control && control.sc !== 'none' && this.controlCars.length > 0;
    m.root.visible = show;
    if (!show) return;
    let lead = -1;
    this.controlCars.forEach((c, i) => {
      if (!c.out && (lead < 0 || c.dist > this.controlCars[lead].dist)) lead = i;
    });
    if (lead < 0) {
      m.root.visible = false;
      return;
    }
    const t = this.game.track;
    const c = t.center;
    const L = c.length;
    const s = (((this.controlCars[lead].st.s + 32) % L) + L) % L;
    const at = sampleAt(c, s);
    const lat = assistDriver(t).lateralAt(s);
    const l = leftOf(at.t);
    const x = at.p.x + l.x * lat;
    const z = at.p.y + l.y * lat;
    const heading = Math.atan2(at.t.y, at.t.x);
    const g = groundPose(t, surfaceFor(t), x, z, heading, { index: Math.round(s / c.spacing) % c.points.length, s, lateral: lat }, this.ghostGround);
    m.setPose(x, g.y, z, heading, g.pitch, g.roll);
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    const car = this.car;
    const session = this.session;
    if (!v || !car || !session || !this.model || !this.ghostModel) return;

    if (this.game.interrupted && !this.paused) this.setPaused(true);
    // Gameplay is "on" only while actually driving: not in the countdown, paused or finished.
    platform.setGameplay(session.phase === 'racing' && this.stage !== 'grid' && !this.paused && !this.game.interrupted);
    this.input.pollGamepad();
    let alpha = 1;
    /** Race time gone by this frame (s): more than the frame's own while fast-forwarding. */
    let raced = dt;
    if (this.watching && !this.paused) {
      // Fast-forward: as many ticks as fit in a few milliseconds.
      const t0 = performance.now();
      let n = 0;
      do {
        this.tick();
        n++;
      } while (n < WATCH.ticks && performance.now() - t0 < WATCH.budget);
      raced = n * car.dt;
      this.watchTime += raced;
      // Everyone has finished (or it has gone on far too long): the results.
      if (!this.stillRacing() || this.watchTime > this.game.setup.laps * trackLapTime(this.game.track) * 3 + 120) {
        this.endWatching();
        return;
      }
    }
    // Nothing moves while the qualifying grid is on show.
    else if (!this.paused && this.stage !== 'grid') alpha = this.fixed.advance(dt, () => this.tick());
    lerpState(car.prev, car.state, alpha, this.view);
    this.model.update(this.view, dt);
    this.opponents.forEach((o, k) => {
      if (this.gone[k + 1]) return;
      lerpState(o.ai.car.prev, o.ai.car.state, alpha, o.view);
      o.model.update(o.view, raced);
    });
    // What the camera, the minimap and the speedometer follow: your car, or the one being watched.
    const focus = (this.watching ? this.watched()?.view : null) ?? this.view;
    if (!this.paused && !this.watching) {
      const st = car.state;
      audio.update({ speed: this.view.speed, rpm: st.rpm, throttle: session.phase === 'racing' ? this.tickInput.throttle : 0, slip: st.slip, grass: st.grass });
    }

    // Ghost: where the best lap was at this point of the current lap.
    const lapTime = session.phase === 'racing' ? session.lapTime(alpha) : null;
    const pose = this.ghost && lapTime !== null ? ghostPose(this.ghost, lapTime) : null;
    this.ghostModel.root.visible = !!pose;
    if (pose) {
      const t = this.game.track;
      const at = locatorFor(t).locate({ x: pose.x, y: pose.z }, this.ghostIndex);
      this.ghostIndex = at.index;
      const g = groundPose(t, surfaceFor(t), pose.x, pose.z, pose.heading, at, this.ghostGround);
      this.ghostModel.setPose(pose.x, g.y, pose.z, pose.heading, g.pitch, g.roll);
    }

    // Barrier hits: a knock and a jolt, scaled by how hard.
    if (this.hit > 1.5) {
      const k = Math.min(1, this.hit / 18);
      audio.thud(k);
      this.rig.bump(k);
    }
    this.hit = 0;

    this.rig.update(v.camera, focus, raced);
    this.placeLabel(this.ghostLabel, pose, this.ghostGround.y, v.camera, focus);
    this.placeSafetyCar();
    this.opponents.forEach((o, k) => !this.gone[k + 1] && this.placeLabel(o.label, o.view, o.view.y, v.camera, focus));
    if (this.opponents.length) {
      const order = this.standings();
      this.position = order.findIndex((e) => e.you) + 1;
      this.hud.setPosition(this.position, order.length);
    }
    if (settings().minimap) {
      const others = this.opponents.filter((_, k) => !this.gone[k + 1]).map((o) => ({ x: o.view.x, z: o.view.z, color: hexColour(o.ai.paint) }));
      this.hud.minimap.draw(this.game.track, focus, pose, others);
    }
    v.render();
    this.hud.setSpeed(focus.speed);
    const assists = settings().assists;
    this.hud.setGear(car.state.gear, car.state.rpm, car.state.speed, assists.gears === 'manual', HANDLING.gearbox.shiftLight);
    this.touch.setManualGears(assists.gears === 'manual');
    this.updateLine(this.watching ? 'off' : assists.line);
    this.hud.setSlipstream(car.draft, SLIPSTREAM.show);
    this.showWeather(v);
    this.towerIn -= dt;
    if (this.towerIn <= 0) {
      this.towerIn = 0.25;
      this.updateTower();
    }
    this.hud.setTyres(car.wear ? car.compound : null, car.tyreLeft, this.crew?.service ?? 0);
    this.updateHud(alpha);
    this.hud.tick(dt);

    // Medal/qualifying laps used to add 1,500–4,500 extra physics ticks to
    // one frame. Keep both jobs inside one deadline, after the visible race.
    if (!this.paused && this.stage !== 'grid') {
      const deadline = performance.now() + 2;
      if (this.stage === 'qualifying') this.runQualifyingSims(deadline);
      this.measureAuthor(deadline);
    }

    if (this.finishedFor >= 0 && !this.paused) {
      this.finishedFor += dt;
      if (this.finishedFor >= (session.retired ? DAMAGE.resultsDelay : RACE.resultsDelay)) {
        this.finishedFor = -1;
        if (this.stage === 'qualifying') this.showGrid();
        // In a championship every car's result counts: the rest of the race is run to the flag.
        else if (this.game.event && this.stillRacing()) this.startWatching();
        else {
          this.showResults();
          return;
        }
      }
    }

    if (import.meta.env.DEV) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        const st = v.stats();
        this.hud.setDebug(`${Math.round(this.fpsFrames / this.fpsTime)} fps · ${st.calls} draw calls · ${st.triangles} tris`);
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
  }
}
