import { CameraRig } from '../car/camera.ts';
import { InputManager, type InputAction } from '../car/input.ts';
import { CarModel } from '../car/model.ts';
import { CarPhysics, CarState, lerpState, NO_INPUT, type DriveInput } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { STR, fmt } from '../config/strings.ts';
import { FixedStep } from '../core/fixedStep.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { prefersTouchControls } from '../platform/platform.ts';
import type { Track } from '../track/track.ts';
import { Hud } from '../ui/hud.ts';
import { PauseMenu } from '../ui/pauseMenu.ts';
import { TouchControls } from '../ui/touchControls.ts';

/**
 * RACE state: the player drives the current track.
 * Physics runs at a fixed HANDLING.tickRate through an accumulator; rendering
 * interpolates between the last two physics states, so driving is identical at
 * 60, 144 or 240 Hz. Lap timing and the countdown arrive in Phase 4.
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
  private car: CarPhysics | null = null;
  private carTrack: Track | null = null;
  private readonly view = new CarState();
  private readonly tickInput: DriveInput = { ...NO_INPUT };
  private paused = false;
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
      drawTrack: () => this.game.go('editor'),
    });
    this.touch = new TouchControls(this.input.touch);
    this.input.onAction = (a) => this.onAction(a);
    this.model = game.view3d ? new CarModel() : null;
    if (this.model) game.view3d?.scene.add(this.model.root);
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
    } else {
      this.car?.placeAt(-8);
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
    this.fixed.reset();
    this.paused = false;
    this.pauseMenu.hide();
    if (this.car) this.rig.snap(this.car.state);
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
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
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
    if (!this.car) return;
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

  frame(dt: number): void {
    const v = this.game.view3d;
    const car = this.car;
    if (!v || !car || !this.model) return;

    this.input.pollGamepad();
    let alpha = 1;
    if (!this.paused) {
      alpha = this.fixed.advance(dt, () => car.step(this.input.sample(this.tickInput)));
    }
    lerpState(car.prev, car.state, alpha, this.view);
    this.model.update(this.view, dt);
    this.rig.update(v.camera, this.view, dt);
    v.render();
    this.hud.setSpeed(this.view.speed);
    this.hud.tick(dt);

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
