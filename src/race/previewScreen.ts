import { STR, fmt } from '../config/strings.ts';
import { TRACK } from '../config/track.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { drawTrack, fitView, toScreen, type View } from '../editor/render2d.ts';
import { Hud } from '../ui/hud.ts';

/**
 * PHASE 1 PLACEHOLDER for the RACE state: shows the current track from above
 * with a marker lapping it in the race direction. Phases 2–4 replace this with
 * the 3D race. The HUD and its "Draw your track" button are the real thing.
 */
export class PreviewRaceScreen implements Screen {
  private readonly game: GameContext;
  private readonly hud: Hud;
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private pos = 0;

  constructor(game: GameContext) {
    this.game = game;
    this.hud = new Hud({ drawTrack: () => this.game.go('editor') });
  }

  enter(): void {
    this.game.ui.append(this.hud.root);
    const t = this.game.track;
    this.hud.setTrackInfo(
      fmt(STR.race.trackInfo, {
        name: t.def.name,
        len: Math.round(t.center.length),
        mult: t.ink.multiplier.toFixed(2),
      }),
    );
    this.hud.setNote(STR.race.previewNote);
    this.pos = 0;
    this.resize();
  }

  exit(): void {
    this.hud.root.remove();
  }

  resize(): void {
    const s = this.game.surface;
    const inset = this.hud.insets();
    this.view = fitView(s.w, s.h, inset.top, inset.bottom);
  }

  frame(dt: number, time: number): void {
    const s = this.game.surface;
    const ctx = s.begin();
    ctx.fillStyle = '#5f8f4e';
    ctx.fillRect(0, 0, s.w, s.h);
    const t = this.game.track;
    drawTrack(ctx, this.view, t, { edge: '#e9e9e2', asphalt: '#3d4148' });

    // A marker lapping the centre line at ~110 km/h shows the race direction.
    const c = t.center;
    this.pos = (this.pos + dt * 30) % c.length;
    const i = Math.floor(this.pos / c.spacing) % c.points.length;
    const p = toScreen(this.view, c.points[i]);
    const r = Math.max(4, TRACK.roadWidth * 0.3 * this.view.scale);
    ctx.fillStyle = '#f2b705';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (1 + 0.08 * Math.sin(time * 8)), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
