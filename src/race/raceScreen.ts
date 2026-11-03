import { type PerspectiveCamera, Vector3 } from 'three';
import { audio } from '../audio/audio.ts';
import { CameraRig } from '../car/camera.ts';
import { collideCars } from '../car/contact.ts';
import { InputManager, type InputAction } from '../car/input.ts';
import { CarModel } from '../car/model.ts';
import { currentPaintHex, recordFinishedRun } from '../car/paint.ts';
import { CarPhysics, CarState, lerpState, NO_INPUT, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { PAINTS } from '../config/paint.ts';
import { AI, RACE } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { FixedStep } from '../core/fixedStep.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings } from '../core/settings.ts';
import { CAPS, prefersTouchControls } from '../platform/platform.ts';
import { platform } from '../platform/services.ts';
import { writeHashCode } from '../platform/web.ts';
import { encodeTrack } from '../track/code.ts';
import { groundPose, type GroundPose } from '../track/ground.ts';
import { locatorFor } from '../track/locator.ts';
import { surfaceFor, terrainHeight } from '../track/surface.ts';
import type { Track } from '../track/track.ts';
import { h } from '../ui/dom.ts';
import { Hud } from '../ui/hud.ts';
import { PauseMenu } from '../ui/pauseMenu.ts';
import { TouchControls } from '../ui/touchControls.ts';
import { AiDriver, gridSlot } from './ai.ts';
import { GhostRecorder, ghostPose, type GhostLap } from './ghost.ts';
import { AuthorLap, medalTimes } from './medals.ts';
import { scoreFor, type RunResult } from './records.ts';
import { formatDelta, formatTime, RaceSession, type Progress, type RaceEvent } from './session.ts';

const BRAKE: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };

/** Two presses of R (or gamepad Back) this close together restart the lap in practice. */
const DOUBLE_TAP = 0.5;

/** An AI car in the race: its driver, what's drawn, and its name tag. */
interface Opponent {
  ai: AiDriver;
  model: CarModel;
  view: CarState;
  label: HTMLElement;
  prev: Progress;
}

/** A car in the race order. */
interface Entry {
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
}

const hexColour = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * RACE state: the current track, driven as the race setup says: free practice
 * laps, or a race of 1–10 laps against your ghost and up to seven AI cars.
 * Physics, lap timing and ghost recording all run on the fixed 120 Hz tick;
 * rendering interpolates between the last two ticks, so everything is identical
 * at 60, 144 or 240 Hz.
 */
export class RaceScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly hud: Hud;
  private readonly pauseMenu: PauseMenu;
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
  private lastResetPress = -Infinity;
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
      restart: () => this.startRun(),
      raceSettings: () => this.game.openSetup(),
      mainMenu: () => this.game.go('menu'),
      drawTrack: () => this.game.go('editor'),
      myTracks: () => this.game.go('library'),
      toggleSound: () => this.toggleSound(),
    });
    this.touch = new TouchControls(this.input.touch);
    this.input.onAction = (a) => this.onAction(a);
    this.model = game.view3d ? new CarModel(currentPaintHex()) : null;
    this.ghostModel = game.view3d ? new CarModel(currentPaintHex(), RACE.ghostOpacity) : null;
    this.ghostLabel = h('div', { class: 'ghost-label', text: STR.race.ghostYou });
    this.ghostLabel.hidden = true;
    this.hud.root.append(this.ghostLabel);
    // Logged-in CrazyGames players see their username on their ghost (no other login exists).
    void platform.username().then((name) => {
      if (name) this.ghostLabel.textContent = fmt(STR.race.ghostUser, { name });
    });
    if (this.model && this.ghostModel) {
      this.ghostModel.root.visible = false;
      game.view3d?.scene.add(this.model.root, this.ghostModel.root);
      for (let k = 0; k < AI.maxOpponents; k++) {
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
    this.game.ui.append(this.hud.root, this.pauseMenu.root);
    this.hud.showMinimap(settings().minimap);
    this.game.view3d?.setQuality(settings().graphics);
    this.hud.setTrackInfo(
      fmt(STR.race.trackInfo, { name: t.def.name, len: Math.round(t.center.length), mult: t.ink.multiplier.toFixed(2) }),
    );
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
    this.touch.root.remove();
    this.hud.clearFlash();
    if (this.ghostModel) this.ghostModel.root.visible = false;
    this.ghostLabel.hidden = true;
    this.clearOpponents();
    audio.setEngine(false);
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  /**
   * New run: car on the grid and a fresh session (bests carry over). A race has
   * a countdown, the setup's number of laps and its AI cars (the player starts
   * at the back of the grid); practice starts at once, alone, and never ends.
   */
  startRun(): void {
    const car = this.car;
    if (!car) return;
    const def = this.game.track.def;
    const setup = this.game.setup;
    this.applyPaint();
    if (CAPS.links) writeHashCode(encodeTrack(def.name, def.control, def.options));
    const rec = this.game.records.get(this.game.track.def.id);
    const t = this.game.track;
    const practice = setup.mode === 'practice';
    this.session = practice
      ? new RaceSession(t.center.length, rec.best, Infinity, t.center.width, 0)
      : new RaceSession(t.center.length, rec.best, setup.laps, t.center.width);
    this.startOpponents(practice ? 0 : setup.opponents);
    if (this.opponents.length) {
      const g = gridSlot(this.opponents.length);
      car.placeAt(g.s, g.lateral);
    } else car.placeAt(-8);
    this.states = [car.state, ...this.opponents.map((o) => o.ai.car.state)];
    this.position = null;
    this.hud.setPosition(null);
    this.hud.setMode(setup.mode);
    this.pauseMenu.setMode(setup.mode);
    this.ghost = setup.ghost ? rec.ghost : null;
    if (rec.author === undefined && this.author?.id !== def.id) this.author = { id: def.id, lap: new AuthorLap(this.game.track) };
    this.ghostIndex = -1;
    this.hit = 0;
    this.finishedFor = -1;
    this.fixed.reset();
    this.paused = false;
    this.pauseMenu.hide();
    this.input.clear();
    this.touch.release();
    this.rig.snap(car.state);
    this.hud.clearFlash();
    if (practice) this.hud.flash(STR.race.practiceGo, 'info', 1.8);
    if (this.ghostModel) this.ghostModel.root.visible = false;
    audio.setEngine(true);
  }

  /**
   * AI cars for a race, fastest at the front of the grid. The field spreads a
   * little below the chosen difficulty, so they don't drive nose to tail.
   */
  private startOpponents(count: number): void {
    this.clearOpponents();
    const t = this.game.track;
    const setup = this.game.setup;
    const n = Math.min(count, this.aiModels.length);
    const mine = currentPaintHex();
    const paints = PAINTS.map((p) => p.hex).filter((hex) => hex !== mine);
    const top = setup.difficulty / 100;
    for (let k = 0; k < n; k++) {
      const difficulty = Math.max(0, top - (n > 1 ? (AI.spread * k) / (n - 1) : 0));
      const paint = paints[k % paints.length];
      const name = STR.ai.names[k % STR.ai.names.length];
      const ai = new AiDriver(t, { name, paint, difficulty, laps: setup.laps, slot: k });
      const model = this.aiModels[k];
      model.setPaint(paint);
      model.root.visible = true;
      const label = this.aiLabels[k];
      label.textContent = name;
      this.opponents.push({ ai, model, view: new CarState(), label, prev: { s: 0, lateral: 0, along: 0 } });
    }
  }

  private clearOpponents(): void {
    this.opponents = [];
    for (const m of this.aiModels) m.root.visible = false;
    for (const l of this.aiLabels) l.hidden = true;
  }

  /** Puts the selected paint on the car and its ghost. */
  applyPaint(): void {
    const hex = currentPaintHex();
    this.model?.setPaint(hex);
    this.ghostModel?.setPaint(hex);
  }

  private toggleSound(): void {
    audio.toggleMute();
    this.pauseMenu.setSound(!audio.silent);
  }

  private controlsText(): string {
    const d = this.input.lastDevice;
    if (d === 'touch') return STR.race.hintTouch;
    const practice = this.game.mode === 'practice';
    if (d === 'gamepad') return STR.race.hintGamepad + (practice ? STR.race.hintRestartGamepad : '');
    return STR.race.hintKeyboard + (practice ? STR.race.hintRestartKeyboard : '');
  }

  private onAction(a: InputAction): void {
    if (a === 'pause') this.setPaused(!this.paused);
    else if (a === 'mute') this.toggleSound();
    else if (this.paused) return;
    else if (a === 'reset') this.onReset();
    else if (a === 'camera') this.rig.toggle();
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
    if (!this.car || !this.session?.canDrive) return;
    this.car.resetToRoad();
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

  /** One fixed physics tick: inputs -> cars -> contact -> race rules -> ghost recording. */
  private tick(): void {
    const car = this.car!;
    const session = this.session!;
    const inp = session.phase === 'racing' ? this.input.sample(this.tickInput) : session.phase === 'finished' ? BRAKE : NO_INPUT;
    const prev = this.progress();
    car.step(inp);
    this.hit = Math.max(this.hit, car.state.wallHit);
    for (const o of this.opponents) {
      this.progress(o.ai.car, o.prev);
      o.ai.car.step(o.ai.drive(this.states, car.dt));
    }
    // Cars bump into each other (the player is states[0]).
    const st = this.states;
    for (let i = 0; i < st.length; i++) {
      for (let j = i + 1; j < st.length; j++) {
        const hit = collideCars(st[i], st[j]);
        if (i === 0) this.hit = Math.max(this.hit, hit);
      }
    }
    this.events.length = 0;
    session.step(prev, this.progress(), this.events);
    for (const e of this.events) this.onRaceEvent(e);
    for (const o of this.opponents) {
      this.aiEvents.length = 0;
      o.ai.session.step(o.prev, this.progress(o.ai.car), this.aiEvents);
    }
    if (session.lapStart !== null && session.phase === 'racing') {
      this.recorder.push(car.state.x, car.state.z, car.state.heading);
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
          this.hud.flash(pos >= 0 ? fmt(STR.race.finishedPos, { pos: STR.results.ordinals[pos] }) : STR.race.finished, 'big', 0);
        }
        else if (e.best) this.hud.flash(STR.race.newBest, 'good');
        else if (!e.valid) this.hud.flash(fmt(STR.race.lapCut, { n: e.lap, time: formatTime(e.time) }), 'bad', 2.2);
        else this.hud.flash(fmt(STR.race.lapTime, { n: e.lap, time: formatTime(e.time) }), 'info');
        if (s.phase !== 'finished' && s.laps.length === s.lapsToRun - 1) this.hud.flash(STR.race.finalLap, e.best ? 'good' : 'info');
        if (s.phase !== 'finished') lapStarted();
        break;
      }
      case 'lapInvalid':
        this.hud.flash(STR.race.lapInvalid, 'bad', 2.2);
        audio.beep(180, 0.35, 0.25);
        lapStarted();
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
    const { avg, score } = bestOfRun === null ? { avg: 0, score: 0 } : scoreFor(t.center.length, bestOfRun, t.ink.multiplier);
    const newBestScore = score > rec.bestScore;
    if (newBestScore) {
      rec.bestScore = score;
      this.game.records.save(t.def.id);
    }
    // Celebrate a personal best, at most once per run.
    if (s.newBest || newBestScore) platform.happytime();
    const unlockedPaints = recordFinishedRun();
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
      multiplier: t.ink.multiplier,
      score,
      bestScore: rec.bestScore,
      newBestScore,
      carX: this.car!.state.x,
      carZ: this.car!.state.z,
      unlockedPaints,
      author: rec.author ?? null,
      ...this.finishingOrder(),
    };
    this.game.go('results');
  }

  /**
   * Everyone in race order: cars that have finished by when they crossed the
   * line, then the rest by how far round the race they are.
   */
  private standings(): Entry[] {
    const n = this.opponents.length;
    const you: Entry = {
      name: STR.results.you,
      you: true,
      paint: currentPaintHex(),
      session: this.session!,
      start: n ? gridSlot(n).s : -8,
      end: this.session!.runEnd,
      dist: this.session!.raceDistance(this.car!.state.s),
    };
    const ai = this.opponents.map((o, k): Entry => ({
      name: o.ai.name,
      you: false,
      paint: o.ai.paint,
      session: o.ai.session,
      start: gridSlot(k).s,
      end: o.ai.session.runEnd,
      dist: o.ai.session.raceDistance(o.ai.car.state.s),
    }));
    return [you, ...ai].sort((a, b) => (a.end !== null && b.end !== null ? a.end - b.end : a.end !== null ? -1 : b.end !== null ? 1 : b.dist - a.dist));
  }

  /**
   * The finishing order for the results (races with AI cars only). Times run
   * from GO; a car still racing when you finish gets an estimate from its
   * average speed so far.
   */
  private finishingOrder(): Pick<RunResult, 'standings' | 'position'> {
    if (!this.opponents.length) return { standings: null, position: null };
    const s = this.session!;
    const total = s.lapsToRun * s.length;
    const now = s.time();
    let last = 0;
    const standings = this.standings().map((e) => {
      let time: number;
      if (e.end !== null) time = e.end - e.session.goTime;
      else {
        const elapsed = Math.max(0.1, now - e.session.goTime);
        const speed = Math.max(1, (e.dist - e.start) / elapsed);
        time = elapsed + Math.max(0, total - e.dist) / speed;
      }
      time = Math.max(time, last + 0.01);
      last = time;
      return { name: e.name, you: e.you, paint: e.paint, time, estimated: e.end === null };
    });
    return { standings, position: standings.findIndex((x) => x.you) + 1 };
  }

  /** Keeps a name tag above a car on screen (hidden when off-screen or far away). */
  private placeLabel(el: HTMLElement, pose: { x: number; z: number } | null, y: number, cam: PerspectiveCamera): void {
    const near = pose && Math.hypot(pose.x - this.view.x, pose.z - this.view.z) < 120;
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

  /** Advances the bot's timed lap a little; when done, the medal times are saved and shown. */
  private measureAuthor(): void {
    const a = this.author;
    if (!a) return;
    if (a.id !== this.game.track.def.id) {
      this.author = null;
      return;
    }
    if (!a.lap.run(1500)) return;
    this.author = null;
    const rec = this.game.records.get(a.id);
    rec.author = a.lap.result ?? null;
    this.game.records.save(a.id);
  }

  private updateHud(alpha: number): void {
    const s = this.session!;
    const rec = this.game.records.get(this.game.track.def.id);
    this.hud.setMedals(rec.author ? medalTimes(rec.author) : null, rec.best?.time ?? null);
    if (this.game.mode === 'practice') {
      this.hud.setLap(s.lapStart === null ? STR.race.practice : fmt(STR.race.practiceLap, { n: s.laps.length + 1 }));
    } else if (s.lapStart === null && !this.opponents.length) this.hud.setLap(s.phase === 'countdown' ? '' : STR.race.warmup);
    else this.hud.setLap(fmt(STR.race.lap, { n: Math.min(s.laps.length + 1, s.lapsToRun), total: s.lapsToRun }));
    this.hud.setTime(formatTime(s.lapTime(alpha) ?? 0));
    this.hud.setCut(s.cut && s.lapStart !== null && s.phase === 'racing');
    const parts: string[] = [];
    if (s.lastLap !== null) parts.push(`${STR.race.last} ${formatTime(s.lastLap)}`);
    if (s.best) parts.push(`${STR.race.best} ${formatTime(s.best.time)}`);
    this.hud.setLastBest(parts.join(' · '));
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    const car = this.car;
    const session = this.session;
    if (!v || !car || !session || !this.model || !this.ghostModel) return;

    if (this.game.interrupted && !this.paused) this.setPaused(true);
    // Gameplay is "on" only while actually driving: not in the countdown, paused or finished.
    platform.setGameplay(session.phase === 'racing' && !this.paused && !this.game.interrupted);
    this.input.pollGamepad();
    let alpha = 1;
    if (!this.paused) alpha = this.fixed.advance(dt, () => this.tick());
    lerpState(car.prev, car.state, alpha, this.view);
    this.model.update(this.view, dt);
    for (const o of this.opponents) {
      lerpState(o.ai.car.prev, o.ai.car.state, alpha, o.view);
      o.model.update(o.view, dt);
    }
    if (!this.paused) {
      const st = car.state;
      audio.update({ speed: this.view.speed, throttle: session.phase === 'racing' ? this.tickInput.throttle : 0, slip: st.slip, grass: st.grass });
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

    this.rig.update(v.camera, this.view, dt);
    this.placeLabel(this.ghostLabel, pose, this.ghostGround.y, v.camera);
    for (const o of this.opponents) this.placeLabel(o.label, o.view, o.view.y, v.camera);
    if (this.opponents.length) {
      const order = this.standings();
      this.position = order.findIndex((e) => e.you) + 1;
      this.hud.setPosition(this.position, order.length);
    }
    if (settings().minimap) {
      const others = this.opponents.map((o) => ({ x: o.view.x, z: o.view.z, color: hexColour(o.ai.paint) }));
      this.hud.minimap.draw(this.game.track, this.view, pose, others);
    }
    this.measureAuthor();
    v.render();
    this.hud.setSpeed(this.view.speed);
    this.updateHud(alpha);
    this.hud.tick(dt);

    if (this.finishedFor >= 0 && !this.paused) {
      this.finishedFor += dt;
      if (this.finishedFor >= RACE.resultsDelay) {
        this.finishedFor = -1;
        this.showResults();
        return;
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
