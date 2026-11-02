import { CameraRig } from '../car/camera.ts';
import { InputManager, type InputAction } from '../car/input.ts';
import { CarModel, DEFAULT_PAINT } from '../car/model.ts';
import { CarPhysics, CarState, lerpState, NO_INPUT, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { RACE } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { FixedStep } from '../core/fixedStep.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { prefersTouchControls } from '../platform/platform.ts';
import type { Track } from '../track/track.ts';
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
    });
    this.touch = new TouchControls(this.input.touch);
    this.input.onAction = (a) => this.onAction(a);
    this.model = game.view3d ? new CarModel() : null;
    this.ghostModel = game.view3d ? new CarModel(DEFAULT_PAINT, RACE.ghostOpacity) : null;
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
    const touch = prefersTouchControls();
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
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  /** New run: car on the grid, countdown, fresh session (bests carry over). */
  private startRun(): void {
    const car = this.car;
    if (!car) return;
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
  }

  private controlsText(): string {
    const d = this.input.lastDevice;
    return d === 'touch' ? STR.race.hintTouch : d === 'gamepad' ? STR.race.hintGamepad : STR.race.hintKeyboard;
  }

  private onAction(a: InputAction): void {
    if (a === 'pause') this.setPaused(!this.paused);
    else if (this.paused) return;
    else if (a === 'reset') this.resetCar();
    else if (a === 'camera') this.rig.toggle();
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
        break;
      case 'go':
        this.hud.flash(STR.race.go, 'big', 0.8);
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
        }
        if (s.phase === 'finished') this.hud.flash(STR.race.finished, 'big', 0);
        else if (e.best) this.hud.flash(STR.race.newBest, 'good');
        else this.hud.flash(fmt(STR.race.lapTime, { n: e.lap, time: formatTime(e.time) }), 'info');
        if (s.phase !== 'finished' && s.laps.length === s.lapsToRun - 1) this.hud.flash(STR.race.finalLap, e.best ? 'good' : 'info');
        if (s.phase !== 'finished') lapStarted();
        break;
      }
      case 'lapInvalid':
        this.hud.flash(STR.race.lapInvalid, 'bad', 2.2);
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
    if (newBestScore) rec.bestScore = score;
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
    };
    this.game.go('results');
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

    this.input.pollGamepad();
    let alpha = 1;
    if (!this.paused) alpha = this.fixed.advance(dt, () => this.tick());
    lerpState(car.prev, car.state, alpha, this.view);
    this.model.update(this.view, dt);

    // Ghost: where the best lap was at this point of the current lap.
    const lapTime = session.phase === 'racing' ? session.lapTime(alpha) : null;
    const pose = this.ghost && lapTime !== null ? ghostPose(this.ghost, lapTime) : null;
    this.ghostModel.root.visible = !!pose;
    if (pose) this.ghostModel.setPose(pose.x, pose.z, pose.heading);

    this.rig.update(v.camera, this.view, dt);
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
