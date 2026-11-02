import { type PerspectiveCamera, Vector3 } from 'three';
import { audio } from '../audio/audio.ts';
import { CameraRig } from '../car/camera.ts';
import { InputManager, type InputAction } from '../car/input.ts';
import { CarModel } from '../car/model.ts';
import { currentPaintHex, recordFinishedRun } from '../car/paint.ts';
import { CarPhysics, CarState, lerpState, NO_INPUT, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { RACE } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { FixedStep } from '../core/fixedStep.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { CAPS, prefersTouchControls } from '../platform/platform.ts';
import { platform } from '../platform/services.ts';
import { writeHashCode } from '../platform/web.ts';
import { encodeTrack } from '../track/code.ts';
import type { Track } from '../track/track.ts';
import { h } from '../ui/dom.ts';
import { Hud } from '../ui/hud.ts';
import { PauseMenu } from '../ui/pauseMenu.ts';
import { TouchControls } from '../ui/touchControls.ts';
import { GhostRecorder, ghostPose, type GhostLap } from './ghost.ts';
import { scoreFor } from './records.ts';
import { formatDelta, formatTime, RaceSession, type Progress, type RaceEvent } from './session.ts';

const BRAKE: DriveInput = { throttle: 0, brake: 1, steer: 0, handbrake: false };

/**
 * RACE state: a time trial on the current track.
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
  private car: CarPhysics | null = null;
  private carTrack: Track | null = null;
  private session: RaceSession | null = null;
  private readonly recorder = new GhostRecorder();
  /** Ghost being replayed this lap (the best lap when the lap started). */
  private ghost: GhostLap | null = null;
  private readonly view = new CarState();
  private readonly ghostLabel: HTMLElement;
  private readonly labelPos = new Vector3();
  private readonly tickInput: DriveInput = { ...NO_INPUT };
  private readonly events: RaceEvent[] = [];
  private paused = false;
  private finishedFor = -1;
  private abort: AbortController | null = null;
  private fpsTime = 0;
  private fpsFrames = 0;

  constructor(game: GameContext) {
    this.game = game;
    this.hud = new Hud({ drawTrack: () => this.game.go('editor'), pause: () => this.setPaused(true) });
    this.pauseMenu = new PauseMenu({
      resume: () => this.setPaused(false),
      resetCar: () => {
        this.resetCar();
        this.setPaused(false);
      },
      restart: () => this.startRun(),
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
    }
  }

  enter(): void {
    const t = this.game.track;
    this.game.ui.append(this.hud.root, this.pauseMenu.root);
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
    audio.setEngine(false);
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  /** New run: car on the grid, countdown, fresh session (bests carry over). */
  private startRun(): void {
    const car = this.car;
    if (!car) return;
    const def = this.game.track.def;
    this.applyPaint();
    this.game.library.save(def); // built-in samples are skipped
    if (CAPS.links) writeHashCode(encodeTrack(def.name, def.control));
    car.placeAt(-8);
    const rec = this.game.records.get(this.game.track.def.id);
    this.session = new RaceSession(this.game.track.center.length, rec.best);
    this.ghost = rec.ghost;
    this.finishedFor = -1;
    this.fixed.reset();
    this.paused = false;
    this.pauseMenu.hide();
    this.input.clear();
    this.touch.release();
    this.rig.snap(car.state);
    this.hud.clearFlash();
    if (this.ghostModel) this.ghostModel.root.visible = false;
    audio.setEngine(true);
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
    return d === 'touch' ? STR.race.hintTouch : d === 'gamepad' ? STR.race.hintGamepad : STR.race.hintKeyboard;
  }

  private onAction(a: InputAction): void {
    if (a === 'pause') this.setPaused(!this.paused);
    else if (a === 'mute') this.toggleSound();
    else if (this.paused) return;
    else if (a === 'reset') this.resetCar();
    else if (a === 'camera') this.rig.toggle();
    else if (a === 'mute') this.toggleSound();
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

  private progress(): Progress {
    const st = this.car!.state;
    const tan = this.game.track.center.tangents[Math.max(0, st.trackIndex)];
    return { s: st.s, lateral: st.lateral, along: st.vx * tan.x + st.vz * tan.y };
  }

  /** One fixed physics tick: input -> car -> race rules -> ghost recording. */
  private tick(): void {
    const car = this.car!;
    const session = this.session!;
    const inp = session.phase === 'racing' ? this.input.sample(this.tickInput) : session.phase === 'finished' ? BRAKE : NO_INPUT;
    const prev = this.progress();
    car.step(inp);
    this.events.length = 0;
    session.step(prev, this.progress(), this.events);
    for (const e of this.events) this.onRaceEvent(e);
    if (session.lapStart !== null && session.phase === 'racing') {
      this.recorder.push(car.state.x, car.state.z, car.state.heading);
    }
  }

  private onRaceEvent(e: RaceEvent): void {
    const s = this.session!;
    const lapStarted = () => {
      // Ghost: the best lap so far; recorder: this new lap.
      this.ghost = this.game.records.get(this.game.track.def.id).ghost;
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
        else audio.beep(880, 0.18);
        if (s.phase === 'finished') this.hud.flash(STR.race.finished, 'big', 0);
        else if (e.best) this.hud.flash(STR.race.newBest, 'good');
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
    const bestOfRun = Math.min(...s.laps);
    const { avg, score } = scoreFor(t.center.length, bestOfRun, t.ink.multiplier);
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
    };
    this.game.go('results');
  }

  /** Keeps the ghost's name tag above it on screen (hidden when off-screen or far away). */
  private placeGhostLabel(pose: { x: number; z: number } | null, cam: PerspectiveCamera): void {
    const near = pose && Math.hypot(pose.x - this.view.x, pose.z - this.view.z) < 120;
    if (!pose || !near) {
      this.ghostLabel.hidden = true;
      return;
    }
    const p = this.labelPos.set(pose.x, 2.3, pose.z).project(cam);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    this.ghostLabel.hidden = !visible;
    if (!visible) return;
    const s = this.game.surface;
    this.ghostLabel.style.transform = `translate(${((p.x + 1) / 2) * s.w}px, ${((1 - p.y) / 2) * s.h}px) translate(-50%, -100%)`;
  }

  private updateHud(alpha: number): void {
    const s = this.session!;
    if (s.lapStart === null) this.hud.setLap(s.phase === 'countdown' ? '' : STR.race.warmup);
    else this.hud.setLap(fmt(STR.race.lap, { n: Math.min(s.laps.length + 1, s.lapsToRun), total: s.lapsToRun }));
    this.hud.setTime(formatTime(s.lapTime(alpha) ?? 0));
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
    if (!this.paused) {
      const st = car.state;
      audio.update({ speed: this.view.speed, throttle: session.phase === 'racing' ? this.tickInput.throttle : 0, slip: st.slip, grass: st.grass });
    }

    // Ghost: where the best lap was at this point of the current lap.
    const lapTime = session.phase === 'racing' ? session.lapTime(alpha) : null;
    const pose = this.ghost && lapTime !== null ? ghostPose(this.ghost, lapTime) : null;
    this.ghostModel.root.visible = !!pose;
    if (pose) this.ghostModel.setPose(pose.x, pose.z, pose.heading);

    this.rig.update(v.camera, this.view, dt);
    this.placeGhostLabel(pose, v.camera);
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
