import { WORLD } from '../config/track.ts';
import type { Vec2 } from '../core/math.ts';
import { fitView, type View } from './render2d.ts';

export const ZOOM = { min: 1, max: 8, step: 1.4 } as const;

/**
 * Zoom and pan over the editor's paper. Zoom 1 fits the whole drawable area in
 * the free part of the screen; panning moves the world point shown at the
 * centre of that area, and is kept so the drawable area never leaves the screen.
 */
export class Viewport {
  private fit: View = { scale: 1, ox: 0, oy: 0 };
  private w = 1;
  private h = 1;
  zoom = 1;
  /** World point shown at the fit centre. */
  private cx = 0;
  private cy = 0;
  view: View = { scale: 1, ox: 0, oy: 0 };

  /** Sets the screen size and the space taken by bars at the top and bottom. */
  setScreen(w: number, h: number, top: number, bottom: number): void {
    this.w = w;
    this.h = h;
    this.fit = fitView(w, h, top, bottom);
    this.update();
  }

  reset(): void {
    this.zoom = 1;
    this.cx = 0;
    this.cy = 0;
    this.update();
  }

  /** Zooms by `factor`, keeping the world point under screen (sx, sy) where it is. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, this.zoom * factor));
    this.update();
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.update();
  }

  /** Zooms about the middle of the free area (buttons, keys). */
  zoomCentre(factor: number): void {
    this.zoomAt(this.fit.ox, this.fit.oy, factor);
  }

  /** Moves the paper with the pointer by (dx, dy) screen pixels. */
  panBy(dx: number, dy: number): void {
    this.cx -= dx / this.view.scale;
    this.cy -= dy / this.view.scale;
    this.update();
  }

  toWorld(sx: number, sy: number): Vec2 {
    const v = this.view;
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
  }

  private update(): void {
    const scale = this.fit.scale * this.zoom;
    // Keep the centre inside the world, with the edges no further in than half the view.
    const halfW = this.w / 2 / scale;
    const halfH = this.h / 2 / scale;
    const limX = Math.max(0, WORLD.width / 2 - halfW * 0.5);
    const limY = Math.max(0, WORLD.height / 2 - halfH * 0.5);
    if (this.zoom <= 1.0001) {
      this.cx = 0;
      this.cy = 0;
    }
    this.cx = Math.max(-limX, Math.min(limX, this.cx));
    this.cy = Math.max(-limY, Math.min(limY, this.cy));
    this.view = { scale, ox: this.fit.ox - this.cx * scale, oy: this.fit.oy - this.cy * scale };
  }
}
