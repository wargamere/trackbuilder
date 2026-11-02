import { Vector3 } from 'three';
import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { sampleAt } from '../track/spline.ts';
import { Hud } from '../ui/hud.ts';

/** Speed of the preview camera along the centre line, m/s. */
const FLY_SPEED = 24;

/**
 * RACE state. Phase 2: the 3D track with a camera flying a lap of it. The car
 * and fixed-step physics arrive in Phase 3, lap timing in Phase 4.
 */
export class RaceScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly hud: Hud;
  private s = 0;
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private readonly tmp = new Vector3();
  private fpsTime = 0;
  private fpsFrames = 0;

  constructor(game: GameContext) {
    this.game = game;
    this.hud = new Hud({ drawTrack: () => this.game.go('editor') });
  }

  enter(): void {
    const t = this.game.track;
    this.game.ui.append(this.hud.root);
    this.hud.setTrackInfo(
      fmt(STR.race.trackInfo, { name: t.def.name, len: Math.round(t.center.length), mult: t.ink.multiplier.toFixed(2) }),
    );
    if (!this.game.view3d) {
      this.hud.setNote(STR.errors.webgl);
      return;
    }
    this.hud.setNote(STR.race.previewNote);
    this.game.view3d.setTrack(t);
    this.s = 0;
    this.placeCamera(1);
  }

  exit(): void {
    this.hud.root.remove();
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  /** Moves the camera towards its spot behind and above the flying point; k=1 snaps. */
  private placeCamera(k: number): void {
    const c = this.game.track.center;
    const behind = sampleAt(c, this.s - 14);
    const ahead = sampleAt(c, this.s + 24);
    this.tmp.set(behind.p.x, 6.5, behind.p.y);
    this.camPos.lerp(this.tmp, k);
    this.tmp.set(ahead.p.x, 1.2, ahead.p.y);
    this.camLook.lerp(this.tmp, k);
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    if (!v) return;
    this.s = (this.s + dt * FLY_SPEED) % this.game.track.center.length;
    this.placeCamera(1 - Math.exp(-dt * 3));
    v.camera.position.copy(this.camPos);
    v.camera.lookAt(this.camLook);
    v.render();

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
